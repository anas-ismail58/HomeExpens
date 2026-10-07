import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { env } from '../config/env';
import { processDueNotifications } from '../services/scheduler.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

function authorized(req: Request) {
  const expected = env.CRON_SECRET;
  const given = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Server-side reminder processing: called by Vercel Cron and the GitHub Actions schedule. */
export const cronRouter = Router();
const run = asyncHandler(async (req: Request, res: Response) => {
  if (!authorized(req)) throw AppError.unauthorized('Invalid cron secret');
  sendSuccess(res, await processDueNotifications());
});
cronRouter.get('/reminders', run);
cronRouter.post('/reminders', run);
