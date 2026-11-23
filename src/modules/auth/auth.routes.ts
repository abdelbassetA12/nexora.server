import { Router, type Request } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../../shared/index';
import { authenticate } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { User } from '../../database/models/User';
import { notFound } from '../../utils/errors';
import { asyncHandler, ok } from '../../utils/http';
import { toPrivateUser } from '../users/user.mapper';
import * as auth from './auth.service';

const meta = (req: Request) => ({ userAgent: req.header('user-agent'), ip: req.ip });
const router = Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), asyncHandler(async (req, res) => {
  ok(res, await auth.register(req.body, meta(req)), 201);
}));

router.post('/login', authLimiter, validate({ body: loginSchema }), asyncHandler(async (req, res) => {
  ok(res, await auth.login(req.body, meta(req)));
}));

router.post('/refresh', validate({ body: refreshSchema }), asyncHandler(async (req, res) => {
  ok(res, await auth.refresh(req.body.refreshToken, meta(req)));
}));

router.post('/logout', validate({ body: refreshSchema }), asyncHandler(async (req, res) => {
  await auth.logout(req.body.refreshToken);
  ok(res, { loggedOut: true });
}));

router.post('/verify-email', authLimiter, validate({ body: verifyEmailSchema }), asyncHandler(async (req, res) => {
  await auth.verifyEmail(req.body.token);
  ok(res, { verified: true });
}));

router.post('/resend-verification', authLimiter, validate({ body: resendVerificationSchema }), asyncHandler(async (req, res) => {
  await auth.resendVerification(req.body.email);
  ok(res, { message: 'If the account exists and is unverified, an email has been sent.' }, 202);
}));

router.post('/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), asyncHandler(async (req, res) => {
  await auth.forgotPassword(req.body.email);
  ok(res, { message: 'If an account exists for this email, a reset link has been sent.' }, 202);
}));

router.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), asyncHandler(async (req, res) => {
  await auth.resetPassword(req.body.token, req.body.password);
  ok(res, { reset: true });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) throw notFound('Account not found');
  ok(res, toPrivateUser(user));
}));

export default router;
