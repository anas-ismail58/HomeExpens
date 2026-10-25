import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { addBankEntry, createBankAccount, deleteBankAccount, deleteBankEntry, getBankAccount, listBankAccounts, setBankBalance, updateBankAccount } from '../services/bank.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema } from '../validators/finance.validator';

const currency = z.enum(['SAR', 'EGP', 'USD', 'EUR', 'AED', 'KWD', 'QAR', 'BHD']);
const money = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/);
const positive = money.refine((value) => Number(value) > 0, 'Amount must be greater than zero');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const accountSchema = z.object({
  bankName: z.string().trim().min(1).max(80),
  accountName: z.string().trim().min(1).max(80),
  countryId: z.string().uuid().nullable().optional(),
  currency,
  balance: money.optional(),
});
const accountUpdateSchema = z.object({
  bankName: z.string().trim().min(1).max(80).optional(),
  accountName: z.string().trim().min(1).max(80).optional(),
  countryId: z.string().uuid().nullable().optional(),
  currency: currency.optional(),
});
const entrySchema = z.object({ kind: z.enum(['DEPOSIT', 'WITHDRAW']), amount: positive, note: z.string().trim().max(200).optional(), date: date.optional() });
const balanceSchema = z.object({ balance: money, note: z.string().trim().max(200).optional() });

/** Bank savings: the caller's own accounts only. */
export const bankRouter = Router();
bankRouter.use(requireAuth, (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
bankRouter.get('/', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listBankAccounts(actor(req)))));
bankRouter.post('/', validate({ body: accountSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createBankAccount(actor(req), req.body), 'Account added', 201)));
bankRouter.delete('/entries/:id', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await deleteBankEntry(actor(req), String(req.params.id)), 'Removed')));
bankRouter.get('/:id', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getBankAccount(actor(req), String(req.params.id)))));
bankRouter.put('/:id', validate({ params: idParamSchema, body: accountUpdateSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateBankAccount(actor(req), String(req.params.id), req.body), 'Saved')));
bankRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteBankAccount(actor(req), String(req.params.id));
    sendSuccess(res, null, 'Removed');
  }),
);
bankRouter.post('/:id/entries', validate({ params: idParamSchema, body: entrySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await addBankEntry(actor(req), String(req.params.id), req.body), 'Saved', 201)));
bankRouter.put('/:id/balance', validate({ params: idParamSchema, body: balanceSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await setBankBalance(actor(req), String(req.params.id), req.body), 'Balance updated')));
