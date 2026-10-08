import { Router, type Request, type Response } from 'express';
import { actor, requireAuth, requirePermission } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { cancelPayment, createPayment, deletePayment, getPayment, listPayments, paymentTotals, paymentsForMonth, payPayment, unpayPayment, updatePayment } from '../services/payment.service';
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
paymentsRouter.post(
  '/:id/pay',
  requirePermission('EDIT_PAYMENT'),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await payPayment(actor(req), id(req)), 'Payment marked as paid')),
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
