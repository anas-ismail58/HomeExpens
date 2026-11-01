import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { actor, requireAdmin, requireAuth, requirePermission } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { getDashboard } from '../services/dashboard.service';
import { addIncome, deleteIncome, getIncomeSummary, incomeCountry, removeSalary, setSalary } from '../services/income.service';
import { addSalaryTransfer, deleteSalaryTransfer, setPersonalLimit, updateSalaryTransfer } from '../services/personal.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { formatDateOnly, monthRange } from '../utils/dates';
import { idParamSchema, monthQuerySchema } from '../validators/finance.validator';

const currency = z.enum(['SAR', 'EGP', 'USD', 'EUR', 'AED', 'KWD', 'QAR', 'BHD']);

const incomeSchema = z.object({
  currency: currency.optional(),
  /** What kind of money: SALARY, PERSONAL, HOUSEHOLD, FROM_PERSON, BORROWED or OTHER (default). */
  kind: z.enum(['SALARY', 'PERSONAL', 'HOUSEHOLD', 'FROM_PERSON', 'BORROWED', 'OTHER']).optional(),
  /** Borrowed money: the person (an existing one, or a new name). */
  contactId: z.string().uuid().optional(),
  contactName: z.string().trim().min(1).max(100).optional(),
  amount: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero'),
  source: z.string().trim().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(240).optional(),
});

function incomeDto(row: { id: string; amount: { toString(): string }; currency: string | null; source: string; kind: string; description: string | null; date: Date; createdBy: { id: string; name: string } | null }) {
  return { id: row.id, amount: row.amount.toString(), currency: row.currency, source: row.source, kind: row.kind, description: row.description, date: formatDateOnly(row.date), createdBy: row.createdBy };
}

const salarySchema = z.object({
  amount: incomeSchema.shape.amount,
  payDay: z.number().int().min(1).max(31),
  currency: currency.optional(),
  description: z.string().trim().max(120).optional(),
});

const transferSchema = z.object({ amount: incomeSchema.shape.amount, note: z.string().trim().max(200).optional() });
const transferUpdateSchema = transferSchema.partial().refine((value) => Object.keys(value).length > 0, 'Nothing to update');
const limitSchema = z.object({ amount: incomeSchema.shape.amount, currency: currency.optional() });

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
// Personal money (the father's own): moved in from the salary, and its monthly limit. Each returns the summary.
incomesRouter.post(
  '/personal/transfers',
  validate({ body: transferSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await addSalaryTransfer(actor(req), req.body), 'Moved', 201)),
);
incomesRouter.put(
  '/personal/transfers/:id',
  validate({ params: idParamSchema, body: transferUpdateSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await updateSalaryTransfer(actor(req), String(req.params.id), req.body), 'Saved')),
);
incomesRouter.delete(
  '/personal/transfers/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await deleteSalaryTransfer(actor(req), String(req.params.id)), 'Removed')),
);
incomesRouter.put(
  '/personal/limit',
  validate({ body: limitSchema }),
  asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await setPersonalLimit(actor(req), req.body), 'Saved')),
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
      where: { familyId: me.familyId, ...incomeCountry(me), deletedAt: null, ...(range ? { date: { gte: range.start, lt: range.end } } : {}) },
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
    const row = await addIncome(actor(req), req.body);
    sendSuccess(res, incomeDto(row), 'Income added', 201);
  }),
);
incomesRouter.delete(
  '/:id',
  requireAdmin,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteIncome(actor(req), String(req.params.id));
    sendSuccess(res, null, 'Income deleted');
  }),
);

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.get('/', validate({ query: monthQuerySchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await getDashboard(actor(req), res.locals.query.month))));
