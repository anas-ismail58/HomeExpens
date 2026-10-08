import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { createAttachment, deleteAttachment, getAttachment, listAttachments } from '../services/attachment.service';
import { createTeacher, deleteTeacher, listTeachers, updateTeacher } from '../services/teacher.service';
import { listUsedSubjects } from '../services/finance.service';
import { getTeacherProfile } from '../services/teacherProfile.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema } from '../validators/finance.validator';
import { teacherSchema, teacherUpdateSchema } from '../validators/teacher.validator';

const target = {
  expenseId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  paymentRecordId: z.string().uuid().optional(),
};
const oneTarget = (value: Record<string, unknown>) => ['expenseId', 'paymentId', 'paymentRecordId'].filter((key) => value[key]).length === 1;

const listQuerySchema = z.object(target).refine(oneTarget, 'Pass exactly one of expenseId, paymentId, paymentRecordId');
const uploadSchema = z
  .object({
    ...target,
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    // Base64 of at most 1.5 MB decoded.
    data: z.string().min(100).max(2_100_000),
    width: z.number().int().positive().max(20000).optional(),
    height: z.number().int().positive().max(20000).optional(),
  })
  .refine(oneTarget, 'Pass exactly one of expenseId, paymentId, paymentRecordId');

/** Payment screenshots and receipt photos for expenses and payments. */
export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth);
attachmentsRouter.get('/', validate({ query: listQuerySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listAttachments(actor(req), res.locals.query))));
attachmentsRouter.post('/', validate({ body: uploadSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createAttachment(actor(req), req.body), 'Image saved', 201)));
attachmentsRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, max-age=86400');
    sendSuccess(res, await getAttachment(actor(req), String(req.params.id)));
  }),
);
attachmentsRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteAttachment(actor(req), String(req.params.id));
    sendSuccess(res, null, 'Image deleted');
  }),
);

export const teachersRouter = Router();
teachersRouter.use(requireAuth);
teachersRouter.get('/subjects', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listUsedSubjects(actor(req)))));
teachersRouter.get('/', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listTeachers(actor(req)))));
teachersRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getTeacherProfile(actor(req), String(req.params.id)))),
);
teachersRouter.post('/', validate({ body: teacherSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createTeacher(actor(req), req.body), 'Teacher added', 201)));
teachersRouter.put(
  '/:id',
  validate({ params: idParamSchema, body: teacherUpdateSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateTeacher(actor(req), String(req.params.id), req.body), 'Teacher updated')),
);
teachersRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteTeacher(actor(req), String(req.params.id));
    sendSuccess(res, null, 'Teacher removed');
  }),
);
