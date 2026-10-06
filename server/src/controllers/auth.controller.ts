import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { getAccount, loginAccount, registerAccount, revokeRefreshToken, rotateRefreshToken } from '../services/auth.service';

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

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw AppError.unauthorized();
  return sendSuccess(res, await getAccount(req.auth.userId, req.auth.familyId));
});