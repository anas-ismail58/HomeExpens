import { Router, type Request, type Response } from 'express';
import { actor, requireAuth } from '../middleware/requireAuth';
import { authLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import {
  changeRole,
  createInvitation,
  createMemberAccount,
  resetMemberPassword,
  getFamily,
  getPermissions,
  listInvitations,
  listMembers,
  previewInvitation,
  rejectInvitation,
  removeMember,
  revokeInvitation,
  setPermissions,
  updateFamily,
} from '../services/family.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import {
  familyIdParamSchema,
  familyInvitationParamSchema,
  familyMemberParamSchema,
  familyUpdateSchema,
  invitationSchema,
  memberAccountSchema,
  passwordResetSchema,
  inviteCodeParamSchema,
  permissionsSchema,
  roleSchema,
} from '../validators/family.validator';

const id = (req: Request) => String(req.params.id);
const userId = (req: Request) => String(req.params.userId);

export const familiesRouter = Router();
familiesRouter.use(requireAuth);

familiesRouter.get('/:id', validate({ params: familyIdParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getFamily(actor(req), id(req)))));
familiesRouter.put(
  '/:id',
  validate({ params: familyIdParamSchema, body: familyUpdateSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateFamily(actor(req), id(req), req.body), 'Family updated')),
);
familiesRouter.get('/:id/members', validate({ params: familyIdParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listMembers(actor(req), id(req)))));
familiesRouter.post(
  '/:id/members',
  validate({ params: familyIdParamSchema, body: memberAccountSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createMemberAccount(actor(req), id(req), req.body), 'Account created', 201)),
);
familiesRouter.put(
  '/:id/members/:userId/password',
  validate({ params: familyMemberParamSchema, body: passwordResetSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await resetMemberPassword(actor(req), id(req), userId(req), req.body.password);
    sendSuccess(res, null, 'Password updated');
  }),
);
familiesRouter.delete(
  '/:id/members/:userId',
  validate({ params: familyMemberParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await removeMember(actor(req), id(req), userId(req));
    sendSuccess(res, null, 'Member removed');
  }),
);
familiesRouter.put(
  '/:id/members/:userId/role',
  validate({ params: familyMemberParamSchema, body: roleSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await changeRole(actor(req), id(req), userId(req), req.body), 'Role updated')),
);
familiesRouter.get('/:id/permissions', validate({ params: familyIdParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getPermissions(actor(req), id(req)))));
familiesRouter.put(
  '/:id/members/:userId/permissions',
  validate({ params: familyMemberParamSchema, body: permissionsSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await setPermissions(actor(req), id(req), userId(req), req.body), 'Permissions updated')),
);
familiesRouter.get('/:id/invitations', validate({ params: familyIdParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listInvitations(actor(req), id(req)))));
familiesRouter.post(
  '/:id/invitations',
  validate({ params: familyIdParamSchema, body: invitationSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createInvitation(actor(req), id(req), req.body), 'Invitation created', 201)),
);
familiesRouter.delete(
  '/:id/invitations/:invitationId',
  validate({ params: familyInvitationParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await revokeInvitation(actor(req), id(req), String(req.params.invitationId));
    sendSuccess(res, null, 'Invitation revoked');
  }),
);

/** Public: lets an invitee preview or decline before creating an account. Rate limited against code guessing. */
export const invitationsRouter = Router();
invitationsRouter.get(
  '/:code',
  authLimiter,
  validate({ params: inviteCodeParamSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await previewInvitation(String(req.params.code)))),
);
invitationsRouter.post(
  '/:code/reject',
  authLimiter,
  validate({ params: inviteCodeParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await rejectInvitation(String(req.params.code));
    sendSuccess(res, null, 'Invitation declined');
  }),
);
