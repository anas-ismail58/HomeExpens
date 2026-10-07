import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { assertSuperAdmin } from '../services/access.service';
import { listAllFamilies, listAllUsers } from '../services/admin.service';
import { switchFamily } from '../services/auth.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';

const switchSchema = z.object({ familyId: z.string().uuid(), refreshToken: z.string().min(1).optional() });

/** Platform-wide views and family switching for the super admin only. */
export const adminRouter = Router();
adminRouter.use(requireAuth, (req, res, next) => {
  try {
    assertSuperAdmin(actor(req));
    res.setHeader('Cache-Control', 'no-store');
    next();
  } catch (error) {
    next(error);
  }
});
adminRouter.get('/families', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listAllFamilies(actor(req)))));
adminRouter.get('/users', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listAllUsers(actor(req)))));
adminRouter.post(
  '/switch-family',
  validate({ body: switchSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await switchFamily(actor(req), req.body.familyId, req.body.refreshToken), 'Switched family')),
);
