import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { createSubject, deleteSubject, listSubjects, updateSubject } from '../services/subject.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema } from '../validators/finance.validator';

const name = z.string().trim().min(1).max(60);
const id = (req: Request) => String(req.params.id);

/** The family's lesson subjects: chosen on lessons and fees, managed on their own page. */
export const subjectsRouter = Router();
subjectsRouter.use(requireAuth);
subjectsRouter.get('/', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listSubjects(actor(req)))));
subjectsRouter.post('/', validate({ body: z.object({ name }) }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createSubject(actor(req), req.body), 'Subject added', 201)));
subjectsRouter.put(
  '/:id',
  validate({ params: idParamSchema, body: z.object({ name: name.optional(), isActive: z.boolean().optional() }).refine((v) => Object.keys(v).length > 0, 'Nothing to update') }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateSubject(actor(req), id(req), req.body), 'Subject updated')),
);
subjectsRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteSubject(actor(req), id(req));
    sendSuccess(res, null, 'Subject removed');
  }),
);
