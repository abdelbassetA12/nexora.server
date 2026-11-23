import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { AuthTokens } from '../../shared/index';
import { env } from '../../config/env';
import { RefreshSession } from '../../database/models/RefreshSession';
import { generateOpaqueToken, hashToken } from '../../utils/crypto';

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export function signAccessToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + env.ACCESS_TOKEN_TTL_SECONDS * 1000);
  const token = jwt.sign({}, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: 'nexora',
    audience: 'nexora-mobile',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
  return { token, expiresAt };
}

export async function issueTokens(userId: string, meta: SessionMeta, familyId?: string): Promise<AuthTokens> {
  const access = signAccessToken(userId);
  const refreshToken = generateOpaqueToken();
  await RefreshSession.create({
    user: userId,
    familyId: familyId ?? crypto.randomUUID(),
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    userAgent: meta.userAgent?.slice(0, 300),
    ip: meta.ip?.slice(0, 64),
  });
  return { accessToken: access.token, refreshToken, accessTokenExpiresAt: access.expiresAt.toISOString() };
}

export const revokeFamily = (familyId: string, reason: 'reuse_detected' | 'logout') =>
  RefreshSession.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date(), revokedReason: reason });

export const revokeAllForUser = (userId: string, reason: 'password_reset') =>
  RefreshSession.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date(), revokedReason: reason });
