import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { createWallet, deleteWallet, deleteWalletEntry, getWallet, listWallets, spendFromWallet, topUpWallet, updateWallet } from '../services/wallet.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema } from '../validators/finance.validator';

const amount = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero');
const note = z.string().trim().max(200).optional();
const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  holderId: z.string().uuid(),
  amount: amount.optional(),
  note,
  spenderIds: z.array(z.string().uuid()).max(20).optional(),
});
const updateSchema = z
  .object({ name: z.string().trim().min(1).max(80).optional(), holderId: z.string().uuid().optional(), spenderIds: z.array(z.string().uuid()).min(1).max(20).optional() })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
const entryParams = z.object({ id: z.string().uuid(), entryId: z.string().uuid() });
const id = (req: Request) => String(req.params.id);

/** Allowances (عهدة): money the father gives a member; chosen members deduct from it. */
export const walletsRouter = Router();
walletsRouter.use(requireAuth);
walletsRouter.get('/', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listWallets(actor(req)))));
walletsRouter.post('/', validate({ body: createSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createWallet(actor(req), req.body), 'Allowance created', 201)));
walletsRouter.get('/:id', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getWallet(actor(req), id(req)))));
walletsRouter.put('/:id', validate({ params: idParamSchema, body: updateSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateWallet(actor(req), id(req), req.body), 'Allowance updated')));
walletsRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteWallet(actor(req), id(req));
    sendSuccess(res, null, 'Allowance closed');
  }),
);
walletsRouter.post(
  '/:id/topup',
  validate({ params: idParamSchema, body: z.object({ amount, note }) }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await topUpWallet(actor(req), id(req), req.body), 'Added')),
);
walletsRouter.post(
  '/:id/spend',
  validate({ params: idParamSchema, body: z.object({ amount, note, sectionKey: z.string().trim().max(60).optional() }) }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await spendFromWallet(actor(req), id(req), req.body), 'Deducted')),
);
walletsRouter.delete(
  '/:id/entries/:entryId',
  validate({ params: entryParams }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await deleteWalletEntry(actor(req), id(req), String(req.params.entryId)), 'Removed')),
);
