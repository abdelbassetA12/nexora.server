import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';

/**
 * In-memory store: correct for a single instance only. Behind multiple instances
 * switch to a shared store (e.g. Redis) — see docs/ARCHITECTURE.md.
 */
export const authLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest && process.env.ENABLE_RATE_LIMIT_IN_TEST !== '1',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a while and try again.', requestId: req.id },
    });
  },
});

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and retry shortly.', requestId: req.id },
    });
  },
});
