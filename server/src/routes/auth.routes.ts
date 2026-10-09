import { Router } from 'express';
import { login, loginTwoFactor, logout, me, patchMe, refresh, register } from '../controllers/auth.controller';
import { authLimiter } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { forgotPasswordSchema, loginSchema, profileSchema, resetPasswordSchema, twoFactorSchema, refreshSchema, registerSchema } from '../validators/auth.validator';
import { requestPasswordReset, resetPasswordWithCode } from '../services/passwordReset.service';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), login);
authRouter.post('/login/2fa', authLimiter, validate({ body: twoFactorSchema }), loginTwoFactor);
authRouter.post('/refresh', authLimiter, validate({ body: refreshSchema }), refresh);
authRouter.post('/logout', validate({ body: refreshSchema }), logout);
authRouter.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    await requestPasswordReset(req.body.login);
    // Same answer whether or not the account exists.
    sendSuccess(res, null, 'If this account exists, a code was sent to its email or the family admin was asked to reset it.');
  }),
);
authRouter.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    await resetPasswordWithCode(req.body.login, req.body.code, req.body.password);
    sendSuccess(res, null, 'Password changed. Sign in with the new password.');
  }),
);
authRouter.get('/me', requireAuth, me);
authRouter.put('/me', requireAuth, validate({ body: profileSchema }), patchMe);
