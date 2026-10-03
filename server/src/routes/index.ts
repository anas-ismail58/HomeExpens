import { Router } from 'express';
import { healthRouter } from './health.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);

// Phase 6+:
// apiRouter.use('/auth', authRouter);
// apiRouter.use('/members', requireAuth, membersRouter);
// apiRouter.use('/categories', requireAuth, categoriesRouter);
// apiRouter.use('/payment-methods', requireAuth, paymentMethodsRouter);
// apiRouter.use('/expenses', requireAuth, expensesRouter);
// apiRouter.use('/dashboard', requireAuth, dashboardRouter);
