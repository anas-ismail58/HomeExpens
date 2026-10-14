import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { getInsights } from '../services/insights.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z
  .object({ period: z.enum(['today', 'week', 'month', 'custom']).default('month'), from: dateOnly.optional(), to: dateOnly.optional() })
  .refine((q) => q.period !== 'custom' || (q.from && q.to), 'A custom range needs from and to')
  .refine((q) => !q.from || !q.to || Math.abs(Date.parse(q.to) - Date.parse(q.from)) <= 366 * 864e5, 'At most one year');

/** Dashboard and analytics numbers for a period (today, this week, this month or a custom range). */
export const insightsRouter = Router();
insightsRouter.use(requireAuth);
insightsRouter.get('/', validate({ query }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getInsights(actor(req), res.locals.query))));
