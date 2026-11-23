import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

// Letters, digits, underscore, dot; 3-30 chars; no leading/trailing dot/underscore.
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(30)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._]*[A-Za-z0-9])?$/, 'Use letters, numbers, dots and underscores');

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(60),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(512) });
export type RefreshInput = z.infer<typeof refreshSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(256) });
export const resendVerificationSchema = z.object({ email: emailSchema });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(256),
  password: passwordSchema,
});

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

export interface PrivateUser {
  id: string;
  email: string;
  emailVerified: boolean;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  country: string | null;
  languages: string[];
  locale: 'en' | 'ar';
  interests: string[];
  goals: string[];
  onboarding: { step: number; completed: boolean };
  role: 'user' | 'moderator' | 'admin';
  createdAt: string;
}

export interface AuthResult {
  user: PrivateUser;
  tokens: AuthTokens;
}
