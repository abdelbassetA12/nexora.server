import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} does not exist`));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side. Please try again.';
  let details: unknown;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err?.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'Request body is not valid JSON';
  } else if (err?.code === 11000) {
    // Mongo duplicate key that escaped explicit handling.
    status = 409; code = 'DUPLICATE'; message = 'This value is already in use';
  }

  if (status >= 500) {
    logger.error({ err, requestId: req.id }, 'Unhandled error');
  }

  res.status(status).json({
    success: false,
    error: { code, message, ...(details !== undefined ? { details } : {}), requestId: req.id },
  });
};
