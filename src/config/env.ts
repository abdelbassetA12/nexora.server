import 'dotenv/config';
import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    MONGODB_URI: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    CLIENT_ORIGINS: z.string().default(''),
    APP_URL: z.string().url().default('http://localhost:8081'),
    EMAIL_PROVIDER: z.enum(['dev', 'resend']).default('dev'),
    EMAIL_FROM: z.string().default('NEXORA <no-reply@example.com>'),
    RESEND_API_KEY: z.string().optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(900),
  })
  .superRefine((v, ctx) => {
    if (v.JWT_ACCESS_SECRET === v.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: 'custom', message: 'JWT secrets must differ', path: ['JWT_REFRESH_SECRET'] });
    }
    if (v.NODE_ENV === 'production' && v.EMAIL_PROVIDER === 'dev') {
      ctx.addIssue({ code: 'custom', message: 'EMAIL_PROVIDER=dev is not allowed in production', path: ['EMAIL_PROVIDER'] });
    }
    if (v.EMAIL_PROVIDER === 'resend' && !v.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', message: 'RESEND_API_KEY is required for resend', path: ['RESEND_API_KEY'] });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = {
  ...parsed.data,
  clientOrigins: parsed.data.CLIENT_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
};
export type Env = typeof env;
