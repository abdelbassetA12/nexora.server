import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { User } from '../database/models/User';
import { forbidden, unauthorized } from '../utils/errors';

interface AccessClaims extends jwt.JwtPayload {
  sub: string;
}

/** Shared by HTTP and Socket.IO: verifies a bearer token and loads authorization data from the database. */
export async function authenticateToken(token: string) {
  let claims: AccessClaims;
  try {
    claims = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'nexora',
      audience: 'nexora-mobile',
    }) as AccessClaims;
  } catch (e) {
    const expired = e instanceof jwt.TokenExpiredError;
    throw unauthorized(expired ? 'Your session has expired' : 'Invalid credentials', expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
  }
  // Authorization data comes from the database, never from the token or client.
  const user = await User.findById(claims.sub).select('role status emailVerifiedAt').lean();
  if (!user || user.status !== 'active') throw unauthorized('Account is not available', 'ACCOUNT_UNAVAILABLE');
  return { userId: String(user._id), role: user.role, emailVerified: Boolean(user.emailVerifiedAt) };
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    req.auth = await authenticateToken(header.slice(7));
    next();
  } catch (err) {
    next(err);
  }
};

export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.auth?.emailVerified) return next(forbidden('Verify your email to use this feature', 'EMAIL_NOT_VERIFIED'));
  next();
};

export const requireRole =
  (...roles: Array<'moderator' | 'admin'>): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role as 'moderator' | 'admin')) return next(forbidden());
    next();
  };
