import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PageMeta } from '../shared/index';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function ok<T>(res: Response, data: T, status = 200, meta?: PageMeta) {
  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}
