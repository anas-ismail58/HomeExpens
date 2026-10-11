import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import {
  approveTask,
  awardPoints,
  completeTask,
  convertPoints,
  createRule,
  createTask,
  deleteRule,
  deleteTask,
  getKidBoard,
  getKidReport,
  getSettings,
  listAudit,
  listKids,
  payChild,
  penalize,
  redeemReward,
  returnTask,
  updateRule,
  updateSettings,
  updateTask,
  voidEntry,
} from '../services/kids.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema } from '../validators/finance.validator';

const money = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero');
const wholePoints = z.number().int().min(1).max(10_000);
const reason = z.string().trim().min(1).max(200);
const note = z.string().trim().max(200).optional();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const childParams = z.object({ childId: z.string().uuid() });

const awardSchema = z
  .object({ ruleId: z.string().uuid().optional(), points: wholePoints.optional(), reason: reason.optional() })
  .refine((v) => Boolean(v.ruleId) !== (v.points !== undefined), 'Choose a behavior or enter points')
  .refine((v) => Boolean(v.ruleId) || Boolean(v.reason), { message: 'Write a reason', path: ['reason'] });

const penaltySchema = z
  .object({ ruleId: z.string().uuid().optional(), points: wholePoints.optional(), amount: money.optional(), reason: reason.optional() })
  .refine((v) => [v.ruleId, v.points, v.amount].filter((x) => x !== undefined).length === 1, 'Choose one: a penalty rule, points or an amount')
  .refine((v) => Boolean(v.ruleId) || Boolean(v.reason), { message: 'Write the reason for the penalty', path: ['reason'] });

const taskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  dueDate: dateOnly.nullable().optional(),
  points: wholePoints,
});
const taskUpdateSchema = taskSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const settingsSchema = z
  .object({
    pointValue: z.string().regex(/^\d{1,8}(\.\d{1,3})?$/).refine((v) => Number(v) > 0, 'Must be greater than zero'),
    maxAwardPoints: z.number().int().min(1).max(10_000),
    maxPenaltyPoints: z.number().int().min(1).max(10_000),
    dailyPenaltyLimit: z.number().int().min(1).max(100_000),
    maxPenaltyAmount: money,
    allowNegativePoints: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const ruleSchema = z.object({ kind: z.enum(['BEHAVIOR', 'PENALTY', 'REWARD']), name: z.string().trim().min(1).max(80), points: wholePoints });
const ruleUpdateSchema = z
  .object({ name: z.string().trim().min(1).max(80), points: wholePoints, isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const reportQuery = z.object({ period: z.enum(['week', 'month']).default('week'), date: dateOnly.optional() });
const auditQuery = z.object({ childId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).optional() });

const id = (req: Request) => String(req.params.id);
const childId = (req: Request) => String(req.params.childId);

/** Children's points, tasks, penalties and rewards. Every rule is enforced in the service layer. */
export const kidsRouter = Router();
kidsRouter.use(requireAuth);

// Father's settings, rules and audit log (static paths first so they don't match /:childId).
kidsRouter.get('/settings', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getSettings(actor(req)))));
kidsRouter.put('/settings', validate({ body: settingsSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateSettings(actor(req), req.body), 'Settings saved')));
kidsRouter.post('/rules', validate({ body: ruleSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createRule(actor(req), req.body), 'Rule added', 201)));
kidsRouter.put('/rules/:id', validate({ params: idParamSchema, body: ruleUpdateSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateRule(actor(req), id(req), req.body), 'Rule updated')));
kidsRouter.delete('/rules/:id', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await deleteRule(actor(req), id(req)), 'Rule switched off')));
kidsRouter.get('/audit', validate({ query: auditQuery }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listAudit(actor(req), res.locals.query))));

// Entries and tasks by their own id.
kidsRouter.post('/entries/:id/void', validate({ params: idParamSchema, body: z.object({ reason: note }).default({}) }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await voidEntry(actor(req), id(req), req.body), 'Undone')));
kidsRouter.put('/tasks/:id', validate({ params: idParamSchema, body: taskUpdateSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateTask(actor(req), id(req), req.body), 'Task updated')));
kidsRouter.delete('/tasks/:id', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await deleteTask(actor(req), id(req)), 'Task deleted')));
kidsRouter.post('/tasks/:id/complete', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await completeTask(actor(req), id(req)), 'Marked done')));
kidsRouter.post('/tasks/:id/approve', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await approveTask(actor(req), id(req)), 'Approved')));
kidsRouter.post('/tasks/:id/return', validate({ params: idParamSchema, body: z.object({ note }).default({}) }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await returnTask(actor(req), id(req), req.body), 'Sent back')));

// One child.
kidsRouter.get('/', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listKids(actor(req)))));
kidsRouter.get('/:childId', validate({ params: childParams }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getKidBoard(actor(req), childId(req)))));
kidsRouter.get('/:childId/report', validate({ params: childParams, query: reportQuery }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getKidReport(actor(req), childId(req), res.locals.query))));
kidsRouter.post('/:childId/points', validate({ params: childParams, body: awardSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await awardPoints(actor(req), childId(req), req.body), 'Points added', 201)));
kidsRouter.post('/:childId/penalties', validate({ params: childParams, body: penaltySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await penalize(actor(req), childId(req), req.body), 'Penalty recorded', 201)));
kidsRouter.post('/:childId/rewards', validate({ params: childParams, body: z.object({ ruleId: z.string().uuid() }) }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await redeemReward(actor(req), childId(req), req.body), 'Reward given', 201)));
kidsRouter.post('/:childId/convert', validate({ params: childParams, body: z.object({ points: wholePoints }) }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await convertPoints(actor(req), childId(req), req.body), 'Points converted', 201)));
kidsRouter.post('/:childId/payouts', validate({ params: childParams, body: z.object({ amount: money, note }) }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await payChild(actor(req), childId(req), 'PAYOUT', req.body), 'Paid', 201)));
kidsRouter.post('/:childId/allowances', validate({ params: childParams, body: z.object({ amount: money, note }) }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await payChild(actor(req), childId(req), 'ALLOWANCE', req.body), 'Allowance recorded', 201)));
kidsRouter.post('/:childId/tasks', validate({ params: childParams, body: taskSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await createTask(actor(req), childId(req), req.body), 'Task added', 201)));
