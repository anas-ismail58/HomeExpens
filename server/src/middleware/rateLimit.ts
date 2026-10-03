import rateLimit from 'express-rate-limit';
import { sendError } from '../utils/apiResponse';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) =>
    sendError(res, 429, 'Too many requests, please try again later', [], 'RATE_LIMITED'),
});

/** Stricter limiter for login / forgot-password (wired in Phase 6). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) =>
    sendError(res, 429, 'Too many attempts, please try again in 15 minutes', [], 'RATE_LIMITED'),
});
