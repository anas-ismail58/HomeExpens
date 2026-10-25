import { Router } from 'express';
import { login, loginTwoFactor, logout, me, patchMe, refresh, register } from '../controllers/auth.controller';
import { forgotLimiter, loginLimiters, refreshLimiter, registerLimiter, resetLimiter } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { forgotPasswordSchema, loginSchema, profileSchema, resetPasswordLinkSchema, resetPasswordSchema, twoFactorSchema, refreshSchema, registerSchema } from '../validators/auth.validator';
import { requestPasswordReset, resetPasswordWithCode, resetPasswordWithLink } from '../services/passwordReset.service';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';

export const authRouter = Router();

authRouter.post('/register', registerLimiter, validate({ body: registerSchema }), register);
authRouter.post('/login', ...loginLimiters, validate({ body: loginSchema }), login);
authRouter.post('/login/2fa', ...loginLimiters, validate({ body: twoFactorSchema }), loginTwoFactor);
authRouter.post('/refresh', refreshLimiter, validate({ body: refreshSchema }), refresh);
authRouter.post('/logout', validate({ body: refreshSchema }), logout);
authRouter.post(
  '/forgot-password',
  forgotLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    const method = await requestPasswordReset(req.body.login);
    const messages = { link: 'A reset link was sent to the account email.', code: 'A code was sent to the account email.', father: 'The family admin was asked to reset it.', admin: 'Contact the app admin to reset this account.' };
    sendSuccess(res, { method }, messages[method]);
  }),
);
authRouter.post(
  '/reset-password',
  resetLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    await resetPasswordWithCode(req.body.login, req.body.code, req.body.password);
    sendSuccess(res, null, 'Password changed. Sign in with the new password.');
  }),
);
authRouter.post(
  '/reset-password-link',
  resetLimiter,
  validate({ body: resetPasswordLinkSchema }),
  asyncHandler(async (req, res) => {
    const email = await resetPasswordWithLink(req.body.oobCode, req.body.password);
    sendSuccess(res, { email }, 'Password changed. Sign in with the new password.');
  }),
);
authRouter.get('/me', requireAuth, me);
authRouter.put('/me', requireAuth, validate({ body: profileSchema }), patchMe);
