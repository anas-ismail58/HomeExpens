import { Router } from 'express';
import { authRouter } from './auth.routes';
import { expensesRouter, membersRouter, reportsRouter } from './finance.routes';
import { healthRouter } from './health.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/members', membersRouter);
apiRouter.use('/expenses', expensesRouter);
apiRouter.use('/reports', reportsRouter);
