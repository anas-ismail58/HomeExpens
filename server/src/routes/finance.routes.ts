import { Router } from 'express';
import {
  deleteChild,
  deleteHouseholdSection,
  deleteRecurring,
  getChild,
  getHouseholdSections,
  getRecurring,
  postHouseholdSection,
  getChildren,
  getExpenseById,
  getMonthlyReport,
  postChild,
  postHomeLesson,
  postHouseholdExpense,
  postRecurringHomeTuition,
  postRecurringHousehold,
  removeExpense,
  putExpense,
} from '../controllers/finance.controller';
import { requireAuth, requirePermission } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { childSchema, expenseUpdateSchema, householdExpenseSchema, idParamSchema, recurringQuerySchema, sectionSchema, lessonExpenseSchema, monthQuerySchema, recurringLessonSchema, recurringHouseholdSchema } from '../validators/finance.validator';

export const membersRouter = Router();
membersRouter.use(requireAuth);
membersRouter.get('/children', getChildren);
membersRouter.post('/children', validate({ body: childSchema }), postChild);
membersRouter.get('/children/:id', validate({ params: idParamSchema }), getChild);
membersRouter.delete('/children/:id', validate({ params: idParamSchema }), deleteChild);

export const expensesRouter = Router();
expensesRouter.use(requireAuth);
expensesRouter.get('/', validate({ query: monthQuerySchema }), getMonthlyReport);
expensesRouter.post('/home-lessons', validate({ body: lessonExpenseSchema }), postHomeLesson);
expensesRouter.post('/recurring-home-lessons', validate({ body: recurringLessonSchema }), postRecurringHomeTuition);
expensesRouter.post('/household', validate({ body: householdExpenseSchema }), postHouseholdExpense);
expensesRouter.post('/recurring-household', validate({ body: recurringHouseholdSchema }), postRecurringHousehold);
expensesRouter.get('/:id', validate({ params: idParamSchema }), getExpenseById);
expensesRouter.put('/:id', validate({ params: idParamSchema, body: expenseUpdateSchema }), putExpense);
expensesRouter.delete('/:id', validate({ params: idParamSchema }), removeExpense);

export const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.get('/monthly', requirePermission('VIEW_REPORTS'), validate({ query: monthQuerySchema }), getMonthlyReport);
export const recurringRouter = Router();
recurringRouter.use(requireAuth);
recurringRouter.get('/', validate({ query: recurringQuerySchema }), getRecurring);
recurringRouter.delete('/:id', validate({ params: idParamSchema }), deleteRecurring);

export const sectionsRouter = Router();
sectionsRouter.use(requireAuth);
sectionsRouter.get('/', getHouseholdSections);
sectionsRouter.post('/', validate({ body: sectionSchema }), postHouseholdSection);
sectionsRouter.delete('/:id', validate({ params: idParamSchema }), deleteHouseholdSection);
