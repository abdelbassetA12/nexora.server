import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Privacy-aware logging: never log credentials or tokens.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.refreshToken',
      'req.body.token',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[redacted]',
  },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});
