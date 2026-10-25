import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { addEntry, createContact, deleteContact, deleteEntry, getContact, listDebts, updateContact, updateEntry } from '../services/debt.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema } from '../validators/finance.validator';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(500).optional(),
});
const contactUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
const entrySchema = z.object({
  kind: z.enum(['LEND', 'BORROW', 'RECEIVE', 'PAY']),
  amount: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero'),
  currency: z.enum(['SAR', 'EGP', 'USD', 'EUR', 'AED', 'KWD', 'QAR', 'BHD']),
  note: z.string().trim().max(200).optional(),
  date: date.optional(),
  dueDate: date.nullable().optional(),
  remind: z.object({ daysBefore: z.number().int().min(0).max(30), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).nullable().optional(),
  recordExpense: z.boolean().optional(),
});

/** Pay to other wallet: the caller's own debts with other people (never anyone else's). */
export const debtsRouter = Router();
debtsRouter.use(requireAuth, (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
debtsRouter.get('/', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listDebts(actor(req)))));
debtsRouter.post('/', validate({ body: contactSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createContact(actor(req), req.body), 'Person added', 201)));
debtsRouter.put('/entries/:id', validate({ params: idParamSchema, body: entrySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateEntry(actor(req), String(req.params.id), req.body), 'Saved')));
debtsRouter.delete('/entries/:id', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await deleteEntry(actor(req), String(req.params.id)), 'Removed')));
debtsRouter.get('/:id', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getContact(actor(req), String(req.params.id)))));
debtsRouter.put('/:id', validate({ params: idParamSchema, body: contactUpdateSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateContact(actor(req), String(req.params.id), req.body), 'Saved')));
debtsRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteContact(actor(req), String(req.params.id));
    sendSuccess(res, null, 'Removed');
  }),
);
debtsRouter.post('/:id/entries', validate({ params: idParamSchema, body: entrySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await addEntry(actor(req), String(req.params.id), req.body), 'Saved', 201)));
