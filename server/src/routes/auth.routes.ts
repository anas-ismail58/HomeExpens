import { Router } from 'express';
import { login, logout, me, patchMe, refresh, register } from '../controllers/auth.controller';
import { authLimiter } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { loginSchema, profileSchema, refreshSchema, registerSchema } from '../validators/auth.validator';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), login);
authRouter.post('/refresh', authLimiter, validate({ body: refreshSchema }), refresh);
authRouter.post('/logout', validate({ body: refreshSchema }), logout);
authRouter.get('/me', requireAuth, me);
authRouter.put('/me', requireAuth, validate({ body: profileSchema }), patchMe);
