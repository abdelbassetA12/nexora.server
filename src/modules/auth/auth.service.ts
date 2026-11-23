import argon2 from 'argon2';
import type { AuthResult, LoginInput, RegisterInput } from '../../shared/index';
import { EmailToken } from '../../database/models/EmailToken';
import { RefreshSession } from '../../database/models/RefreshSession';
import { User } from '../../database/models/User';
import { getEmailProvider } from '../../integrations/email';
import { generateOpaqueToken, hashToken } from '../../utils/crypto';
import { AppError, conflict, unauthorized } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { toPrivateUser } from '../users/user.mapper';
import { issueTokens, revokeAllForUser, revokeFamily, type SessionMeta } from './token.service';

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const VERIFY_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 3_600_000;

let dummyHash: string | undefined;
async function getDummyHash() {
  dummyHash ??= await argon2.hash('nexora-dummy-password', ARGON_OPTS);
  return dummyHash;
}

async function createEmailToken(userId: string, type: 'verify_email' | 'reset_password', ttlMs: number) {
  // Invalidate any outstanding tokens of the same type.
  await EmailToken.deleteMany({ user: userId, type, usedAt: null });
  const token = generateOpaqueToken(32);
  await EmailToken.create({ user: userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

async function sendVerificationEmail(user: { _id: unknown; email: string; displayName: string }) {
  const token = await createEmailToken(String(user._id), 'verify_email', VERIFY_TTL_MS);
  await getEmailProvider().send({
    to: user.email,
    subject: 'Verify your NEXORA email',
    text: `Hi ${user.displayName},\n\nOpen this link on your phone to verify your email:\nnexora://verify-email?token=${token}\n\nOr paste this code into the app: ${token}\n\nThis expires in 24 hours. If you did not create an account, ignore this email.`,
  });
}

export async function register(input: RegisterInput, meta: SessionMeta): Promise<AuthResult> {
  const emailNormalized = input.email.toLowerCase();
  const usernameNormalized = input.username.toLowerCase();

  const existing = await User.findOne({ $or: [{ emailNormalized }, { usernameNormalized }] })
    .select('emailNormalized usernameNormalized')
    .lean();
  if (existing) {
    if (existing.emailNormalized === emailNormalized) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
    throw conflict('This username is taken', 'USERNAME_TAKEN');
  }

  const passwordHash = await argon2.hash(input.password, ARGON_OPTS);
  let user;
  try {
    user = await User.create({
      email: input.email,
      emailNormalized,
      username: input.username,
      usernameNormalized,
      displayName: input.displayName,
      passwordHash,
    });
  } catch (e) {
    // Lost a race against a concurrent registration; the unique indexes are the source of truth.
    if ((e as { code?: number }).code === 11000) throw conflict('Email or username is already in use', 'DUPLICATE');
    throw e;
  }

  try {
    await sendVerificationEmail(user);
  } catch (err) {
    // Registration succeeded; the user can request another email.
    logger.error({ err, userId: String(user._id) }, 'Failed to send verification email');
  }

  const tokens = await issueTokens(String(user._id), meta);
  return { user: toPrivateUser(user), tokens };
}

export async function login(input: LoginInput, meta: SessionMeta): Promise<AuthResult> {
  const user = await User.findOne({ emailNormalized: input.email.toLowerCase() }).select('+passwordHash');
  // Always perform one verification to keep timing similar for unknown emails.
  const valid = await argon2.verify(user?.passwordHash ?? (await getDummyHash()), input.password).catch(() => false);
  if (!user || !valid) throw unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
  if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_RESTRICTED', 'This account is not available');

  user.lastLoginAt = new Date();
  await user.save();
  const tokens = await issueTokens(String(user._id), meta);
  return { user: toPrivateUser(user), tokens };
}

export async function refresh(refreshToken: string, meta: SessionMeta) {
  const session = await RefreshSession.findOne({ tokenHash: hashToken(refreshToken) });
  if (!session) throw unauthorized('Session is no longer valid', 'INVALID_REFRESH_TOKEN');

  if (session.revokedAt) {
    // A rotated/revoked token was presented again: assume theft and kill the whole family.
    await revokeFamily(session.familyId, 'reuse_detected');
    throw unauthorized('Session is no longer valid', 'REFRESH_TOKEN_REUSED');
  }
  if (session.expiresAt.getTime() <= Date.now()) throw unauthorized('Session has expired', 'REFRESH_TOKEN_EXPIRED');

  // Atomic claim: only one concurrent request can rotate this token.
  const claimed = await RefreshSession.findOneAndUpdate(
    { _id: session._id, revokedAt: null },
    { revokedAt: new Date(), revokedReason: 'rotated' },
  );
  if (!claimed) {
    await revokeFamily(session.familyId, 'reuse_detected');
    throw unauthorized('Session is no longer valid', 'REFRESH_TOKEN_REUSED');
  }

  const user = await User.findById(session.user);
  if (!user || user.status !== 'active') throw unauthorized('Account is not available', 'ACCOUNT_UNAVAILABLE');
  return { user: toPrivateUser(user), tokens: await issueTokens(String(user._id), meta, session.familyId) };
}

export async function logout(refreshToken: string) {
  const session = await RefreshSession.findOne({ tokenHash: hashToken(refreshToken) }).select('familyId');
  if (session) await revokeFamily(session.familyId, 'logout');
  // Idempotent: unknown tokens are treated as already signed out.
}

export async function verifyEmail(token: string) {
  const record = await EmailToken.findOneAndUpdate(
    { tokenHash: hashToken(token), type: 'verify_email', usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
  );
  if (!record) throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This verification link is invalid or has expired');
  await User.updateOne({ _id: record.user, emailVerifiedAt: null }, { emailVerifiedAt: new Date() });
}

export async function resendVerification(email: string) {
  const user = await User.findOne({ emailNormalized: email.toLowerCase(), status: 'active' });
  if (user && !user.emailVerifiedAt) {
    await sendVerificationEmail(user).catch((err) => logger.error({ err }, 'Failed to send verification email'));
  }
  // Caller always returns the same response to avoid account enumeration.
}

export async function forgotPassword(email: string) {
  const user = await User.findOne({ emailNormalized: email.toLowerCase(), status: 'active' });
  if (!user) return;
  const token = await createEmailToken(String(user._id), 'reset_password', RESET_TTL_MS);
  await getEmailProvider()
    .send({
      to: user.email,
      subject: 'Reset your NEXORA password',
      text: `Open this link to choose a new password:\nnexora://reset-password?token=${token}\n\nOr paste this code into the app: ${token}\n\nThis expires in 1 hour. If you did not request this, you can ignore this email.`,
    })
    .catch((err) => logger.error({ err }, 'Failed to send reset email'));
}

export async function resetPassword(token: string, password: string) {
  const record = await EmailToken.findOneAndUpdate(
    { tokenHash: hashToken(token), type: 'reset_password', usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
  );
  if (!record) throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This reset link is invalid or has expired');
  await User.updateOne({ _id: record.user }, { passwordHash: await argon2.hash(password, ARGON_OPTS) });
  // Sign out everywhere.
  await revokeAllForUser(String(record.user), 'password_reset');
}
