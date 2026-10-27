import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { vaultLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { addVaultEntry, assertUnlocked, deleteVaultEntry, forgetDevice, getVault, trustDevice, unlockVault } from '../services/vault.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema } from '../validators/finance.validator';

const unlockSchema = z.union([z.object({ password: z.string().min(1).max(200) }), z.object({ deviceKey: z.string().min(20).max(200) })]);
const entrySchema = z.object({
  direction: z.enum(['DEPOSIT', 'WITHDRAW']),
  amount: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero'),
  currency: z.enum(['SAR', 'EGP', 'USD', 'EUR', 'AED', 'KWD', 'QAR', 'BHD']),
  /** Where the money comes from / goes back to: SALARY, PRIVATE (father) or OTHER (default). */
  source: z.enum(['SALARY', 'PRIVATE', 'OTHER']).optional(),
  note: z.string().trim().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const deviceSchema = z.object({ label: z.string().trim().max(60).optional() });

/** The caller's own savings vault. Everything but unlocking needs the unlock token (X-Vault-Token). */
export const vaultRouter = Router();
vaultRouter.use(requireAuth, (_req, res, next) => {
  // Never cached by browsers or proxies.
  res.setHeader('Cache-Control', 'no-store');
  next();
});
vaultRouter.post('/unlock', vaultLimiter, validate({ body: unlockSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await unlockVault(actor(req), req.body))));

const unlocked = (req: Request, _res: Response, next: (error?: unknown) => void) => {
  try {
    assertUnlocked(actor(req), req.header('x-vault-token'));
    next();
  } catch (error) {
    next(error);
  }
};
vaultRouter.get('/', unlocked, asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getVault(actor(req)))));
vaultRouter.post('/entries', unlocked, validate({ body: entrySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await addVaultEntry(actor(req), req.body), 'Saved', 201)));
vaultRouter.delete('/entries/:id', unlocked, validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await deleteVaultEntry(actor(req), String(req.params.id)), 'Removed')));
vaultRouter.post('/devices', unlocked, validate({ body: deviceSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await trustDevice(actor(req), req.body.label), 'Trusted', 201)));
vaultRouter.delete(
  '/devices/:id',
  unlocked,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await forgetDevice(actor(req), String(req.params.id));
    sendSuccess(res, null, 'Removed');
  }),
);
