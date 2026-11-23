import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';
import { requestId } from './middleware/requestId';
import { apiV1 } from './routes';
import { logger } from './utils/logger';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  if (!env.isTest) {
    app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).id ?? '' }));
  }
  app.use(helmet());
  app.use(
    cors({
      // Native apps send no Origin header and are not subject to CORS; this protects browser clients (admin web).
      origin: (origin, cb) => cb(null, !origin || env.clientOrigins.includes(origin)),
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down' });
  });

  app.use('/api/v1', apiLimiter, apiV1);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
