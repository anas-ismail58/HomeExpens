import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { actor, requireAdmin, requireAuth, requirePermission } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { getDashboard } from '../services/dashboard.service';
import { getIncomeSummary, removeSalary, setSalary } from '../services/income.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { formatDateOnly, monthRange, parseDateOnly } from '../utils/dates';
import { idParamSchema, monthQuerySchema } from '../validators/finance.validator';

const currency = z.enum(['SAR', 'EGP', 'USD', 'EUR', 'AED', 'KWD', 'QAR', 'BHD']);

const incomeSchema = z.object({
  currency: currency.optional(),
  amount: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero'),
  source: z.string().trim().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(240).optional(),
});

function incomeDto(row: { id: string; amount: { toString(): string }; currency: string | null; source: string; description: string | null; date: Date; createdBy: { id: string; name: string } | null }) {
  return { id: row.id, amount: row.amount.toString(), currency: row.currency, source: row.source, description: row.description, date: formatDateOnly(row.date), createdBy: row.createdBy };
}

const salarySchema = z.object({
  amount: incomeSchema.shape.amount,
  payDay: z.number().int().min(1).max(31),
  currency: currency.optional(),
  description: z.string().trim().max(120).optional(),
});

/** Family income: visible with VIEW_INCOME (never to children), managed by the admin. */
export const incomesRouter = Router();
incomesRouter.use(requireAuth);
incomesRouter.get(
  '/summary',
  validate({ query: monthQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getIncomeSummary(actor(req), res.locals.query.month))),
);
incomesRouter.put(
  '/salary',
  requireAdmin,
  validate({ body: salarySchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await setSalary(actor(req), req.body), 'Salary saved')),
);
incomesRouter.delete(
  '/salary',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    await removeSalary(actor(req));
    sendSuccess(res, null, 'Salary removed');
  }),
);
incomesRouter.get(
  '/',
  requirePermission('VIEW_INCOME'),
  validate({ query: monthQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const me = actor(req);
    if (me.role === 'CHILD') throw AppError.forbidden();
    const month = res.locals.query.month as string | undefined;
    const range = month ? monthRange(...(month.split('-').map(Number) as [number, number])) : null;
    const rows = await prisma.income.findMany({
      where: { familyId: me.familyId, deletedAt: null, ...(range ? { date: { gte: range.start, lt: range.end } } : {}) },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
      take: 200,
    });
    sendSuccess(res, rows.map(incomeDto));
  }),
);
incomesRouter.post(
  '/',
  requireAdmin,
  validate({ body: incomeSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const me = actor(req);
    const row = await prisma.income.create({
      data: { familyId: me.familyId, amount: req.body.amount, currency: req.body.currency ?? null, source: req.body.source, description: req.body.description, date: parseDateOnly(req.body.date), createdById: me.userId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    sendSuccess(res, incomeDto(row), 'Income added', 201);
  }),
);
incomesRouter.delete(
  '/:id',
  requireAdmin,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { count } = await prisma.income.updateMany({ where: { id: String(req.params.id), familyId: actor(req).familyId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!count) throw AppError.notFound('Income not found');
    sendSuccess(res, null, 'Income deleted');
  }),
);

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.get('/', validate({ query: monthQuerySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getDashboard(actor(req), res.locals.query.month))));
