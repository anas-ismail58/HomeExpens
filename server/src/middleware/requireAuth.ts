import type { RequestHandler } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export const requireAuth: RequestHandler = (req, _res, next) => {
  const [scheme, token] = req.header('authorization')?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) return next(AppError.unauthorized());

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (typeof payload.sub !== 'string' || typeof payload.familyId !== 'string') {
      return next(AppError.unauthorized());
    }
    req.auth = { userId: payload.sub, familyId: payload.familyId };
    return next();
  } catch {
    return next(AppError.unauthorized('Invalid or expired access token'));
  }
};