import type { Request, Response } from 'express';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { sendError } from '../utils/apiResponse';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  // The test suite sends more than 500 requests from one address; sign-in limits are still tested.
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) =>
    sendError(res, 429, 'Too many requests, please try again later', [], 'RATE_LIMITED'),
});

const WINDOW = 15 * 60 * 1000;
const blocked = (_req: Request, res: Response) => sendError(res, 429, 'Too many attempts, please try again in 15 minutes', [], 'RATE_LIMITED');

/** Only a wrong password / code (401) counts; choosing the wrong sign-in type or a typo in the form doesn't. */
const onlyWrongCredentials = (_req: Request, res: Response) => res.statusCode !== 401;

/** The account being tried, so one person's mistakes don't block everyone on the same Wi-Fi. */
function accountKey(req: Request) {
  const login = String(req.body?.email ?? req.body?.login ?? '').trim().toLowerCase();
  return `${req.ip}|${login}`;
}

const stores: MemoryStore[] = [];
function limiter(options: { limit: number; key?: (req: Request) => string; countAll?: boolean; anyFailure?: boolean }) {
  const store = new MemoryStore();
  stores.push(store);
  return rateLimit({
    windowMs: WINDOW,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store,
    ...(options.key ? { keyGenerator: options.key } : {}),
    ...(options.countAll ? {} : { skipSuccessfulRequests: true, ...(options.anyFailure ? {} : { requestWasSuccessful: onlyWrongCredentials }) }),
    handler: blocked,
  });
}

/** Login and 2FA: 10 wrong passwords per account, and 50 per network so guessing many accounts is still stopped. */
export const loginLimiters = [limiter({ limit: 10, key: accountKey }), limiter({ limit: 50 })];
/** Staying signed in: a stale session failing to refresh never blocks signing in again. */
export const refreshLimiter = limiter({ limit: 60 });
export const registerLimiter = limiter({ limit: 10 });
/** Each forgot-password request can send an email, so every request counts (per account). */
export const forgotLimiter = limiter({ limit: 5, key: accountKey, countAll: true });
export const resetLimiter = limiter({ limit: 10, key: accountKey, anyFailure: true });

/** Savings vault unlock: 10 wrong passwords (or unknown phone keys) per account. */
export const vaultLimiter = limiter({ limit: 10, key: (req) => `${req.ip}|${req.auth?.userId ?? ''}` });

/** Invitation codes: any failed lookup (wrong code) counts, against guessing codes. */
export const inviteLimiter = limiter({ limit: 10, anyFailure: true });

/** Tests: start each scenario with clean sign-in counters. */
export function resetAuthLimits() {
  for (const store of stores) store.resetAll();
}
