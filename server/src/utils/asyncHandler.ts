import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 already forwards rejected promises to the error handler.
 * This wrapper keeps controller signatures explicit and typed.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
