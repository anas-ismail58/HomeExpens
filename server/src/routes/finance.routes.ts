import { Router } from 'express';
import {
  getChildren,
  getMonthlyReport,
  postChild,
  postHomeLesson,
  postHouseholdExpense,
  postRecurringHomeTuition,
} from '../controllers/finance.controller';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { childSchema, householdExpenseSchema, lessonExpenseSchema, monthQuerySchema, recurringLessonSchema } from '../validators/finance.validator';

export const membersRouter = Router();
membersRouter.use(requireAuth);
membersRouter.get('/children', getChildren);
membersRouter.post('/children', validate({ body: childSchema }), postChild);

export const expensesRouter = Router();
expensesRouter.use(requireAuth);
expensesRouter.get('/', validate({ query: monthQuerySchema }), getMonthlyReport);
expensesRouter.post('/home-lessons', validate({ body: lessonExpenseSchema }), postHomeLesson);
expensesRouter.post('/recurring-home-lessons', validate({ body: recurringLessonSchema }), postRecurringHomeTuition);
expensesRouter.post('/household', validate({ body: householdExpenseSchema }), postHouseholdExpense);

export const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.get('/monthly', validate({ query: monthQuerySchema }), getMonthlyReport);