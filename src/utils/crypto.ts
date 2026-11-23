import crypto from 'node:crypto';
import { env } from '../config/env';

/** Opaque random token for the client; only a keyed hash is stored. */
export function generateOpaqueToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** HMAC-SHA256 so a database leak alone cannot be used to mint valid tokens. */
export function hashToken(token: string): string {
  return crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}
