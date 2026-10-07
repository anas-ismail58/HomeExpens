import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { addPrivateEntry, deletePrivateEntry, getPrivateSummary } from '../services/private.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema, monthQuerySchema } from '../validators/finance.validator';

const entrySchema = z.object({
  direction: z.enum(['IN', 'OUT']),
  amount: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero'),
  note: z.string().trim().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** The father's private money — only ever the caller's own entries. */
export const privateRouter = Router();
privateRouter.use(requireAuth, (_req, res, next) => {
  // Never cached by browsers or proxies.
  res.setHeader('Cache-Control', 'no-store');
  next();
});
privateRouter.get('/', validate({ query: monthQuerySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getPrivateSummary(actor(req), res.locals.query.month))));
privateRouter.post('/', validate({ body: entrySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await addPrivateEntry(actor(req), req.body), 'Saved', 201)));
privateRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await deletePrivateEntry(actor(req), String(req.params.id));
    sendSuccess(res, null, 'Deleted');
  }),
);
