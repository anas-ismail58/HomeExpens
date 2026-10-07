import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { deleteNotification, listNotifications, markAllRead, markRead, registerPushToken, unregisterPushToken } from '../services/notification.service';
import { processDueNotifications } from '../services/scheduler.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema } from '../validators/finance.validator';

const pushTokenSchema = z.object({ token: z.string().trim().min(10).max(200), platform: z.enum(['ios', 'android', 'web']).default('ios') });
const pushTokenDeleteSchema = z.object({ token: z.string().trim().min(10).max(200) });

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    // Opening the app also catches up on anything due for this family (cron does the rest).
    await processDueNotifications({ familyId: actor(req).familyId }).catch(() => undefined);
    sendSuccess(res, await listNotifications(actor(req)));
  }),
);
notificationsRouter.put('/read-all', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await markAllRead(actor(req)))));
notificationsRouter.put(
  '/:id/read',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await markRead(actor(req), String(req.params.id));
    sendSuccess(res, null, 'Marked as read');
  }),
);
notificationsRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteNotification(actor(req), String(req.params.id));
    sendSuccess(res, null, 'Notification deleted');
  }),
);

export const pushTokensRouter = Router();
pushTokensRouter.use(requireAuth);
pushTokensRouter.post(
  '/',
  validate({ body: pushTokenSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await registerPushToken(actor(req), req.body.token, req.body.platform);
    sendSuccess(res, null, 'Device registered', 201);
  }),
);
pushTokensRouter.delete(
  '/',
  validate({ body: pushTokenDeleteSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await unregisterPushToken(actor(req), req.body.token);
    sendSuccess(res, null, 'Device removed');
  }),
);
