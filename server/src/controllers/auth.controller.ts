import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';
import { actor } from '../middleware/requireAuth';
import { getAccount, loginAccount, registerAccount, revokeRefreshToken, rotateRefreshToken, updateProfile } from '../services/auth.service';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const session = await registerAccount(req.body);
  return sendSuccess(res, session, 'Account created', 201);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const session = await loginAccount(req.body);
  return sendSuccess(res, session, 'Signed in');
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const session = await rotateRefreshToken(req.body.refreshToken);
  return sendSuccess(res, session, 'Session refreshed');
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await revokeRefreshToken(req.body.refreshToken);
  return sendSuccess(res, null, 'Signed out');
});

export const me = asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getAccount(actor(req))));

export const patchMe = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await updateProfile(actor(req), req.body), 'Profile updated'),
);
