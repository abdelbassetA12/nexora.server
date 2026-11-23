import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../utils/errors';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Validates and replaces body/query/params with parsed (stripped, coerced) values. */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        return next(
          new AppError(422, 'VALIDATION_ERROR', 'Some fields are invalid', {
            location: key,
            fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          }),
        );
      }
      (req as unknown as Record<string, unknown>)[key] = result.data;
    }
    next();
  };
