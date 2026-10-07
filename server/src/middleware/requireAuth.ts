import type { PermissionKey } from '@prisma/client';
import type { Request, RequestHandler } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { assertAdmin, assertCan, loadActor, type Actor } from '../services/access.service';
import { AppError } from '../utils/AppError';

/**
 * Verifies the access token, then loads the caller's family, role and permissions from the database
 * on every request, so removals and permission changes apply immediately.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const [scheme, token] = req.header('authorization')?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) return next(AppError.unauthorized());

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    return next(AppError.unauthorized('Invalid or expired access token'));
  }
  if (typeof payload.sub !== 'string' || typeof payload.familyId !== 'string') return next(AppError.unauthorized());

  try {
    req.auth = await loadActor(payload.sub, payload.familyId);
    return next();
  } catch (error) {
    return next(error);
  }
};

export function actor(req: Request): Actor {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

/** Route guard: the caller needs every listed permission (the admin always passes). */
export const requirePermission =
  (...keys: PermissionKey[]): RequestHandler =>
  (req, _res, next) => {
    try {
      for (const key of keys) assertCan(actor(req), key);
      next();
    } catch (error) {
      next(error);
    }
  };

export const requireAdmin: RequestHandler = (req, _res, next) => {
  try {
    assertAdmin(actor(req));
    next();
  } catch (error) {
    next(error);
  }
};
