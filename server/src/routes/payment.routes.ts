import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth, requirePermission } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { cancelPayment, createPayment, deletePayment, getPayment, listPayments, paymentTotals, paymentsForMonth, payPayment, unpayPayment, updatePayment } from '../services/payment.service';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema, monthQuerySchema } from '../validators/finance.validator';
import { paymentListQuerySchema, paymentSchema, paymentUpdateSchema } from '../validators/payment.validator';

const id = (req: Request) => String(req.params.id);

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

// Listing is scoped in the service: without VIEW_PAYMENTS a member only sees their own payments.
paymentsRouter.get('/', validate({ query: paymentListQuerySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listPayments(actor(req), res.locals.query.status))));
paymentsRouter.post(
  '/',
  requirePermission('ADD_PAYMENT'),
  validate({ body: paymentSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createPayment(actor(req), req.body), 'Payment created', 201)),
);
paymentsRouter.get(
  '/month',
  validate({ query: monthQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await paymentsForMonth(actor(req), res.locals.query.month))),
);
paymentsRouter.get('/summary', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await paymentTotals(actor(req)))));
paymentsRouter.get('/:id', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getPayment(actor(req), id(req)))));
paymentsRouter.put(
  '/:id',
  requirePermission('EDIT_PAYMENT'),
  validate({ params: idParamSchema, body: paymentUpdateSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updatePayment(actor(req), id(req), req.body), 'Payment updated')),
);
paymentsRouter.delete(
  '/:id',
  requirePermission('DELETE_PAYMENT'),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await deletePayment(actor(req), id(req));
    sendSuccess(res, null, 'Payment deleted');
  }),
);
// No body at all is treated like an empty one, so the missing receipt gets its own message.
const paySchema = z.preprocess((value) => value ?? {}, z.object({
  receipt: z
    .object({
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      // Base64 of at most 1.5 MB decoded.
      data: z.string().min(100).max(2_100_000),
      width: z.number().int().positive().max(20000).optional(),
      height: z.number().int().positive().max(20000).optional(),
    })
    .optional(),
}));
paymentsRouter.post(
  '/:id/pay',
  requirePermission('EDIT_PAYMENT'),
  validate({ params: idParamSchema, body: paySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    // Paying needs proof: a screenshot of the transfer or a photo of the receipt.
    if (!req.body.receipt) throw new AppError(422, 'Attach a screenshot of the payment to mark it as paid', [], 'RECEIPT_REQUIRED');
    sendSuccess(res, await payPayment(actor(req), id(req), req.body.receipt), 'Payment marked as paid');
  }),
);
paymentsRouter.post(
  '/:id/unpay',
  requirePermission('EDIT_PAYMENT'),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await unpayPayment(actor(req), id(req)), 'Payment marked as unpaid')),
);
paymentsRouter.post(
  '/:id/cancel',
  requirePermission('EDIT_PAYMENT'),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await cancelPayment(actor(req), id(req)), 'Payment cancelled')),
);
