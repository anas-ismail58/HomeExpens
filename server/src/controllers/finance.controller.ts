import type { Request, Response } from 'express';
import {
  createHouseholdSection,
  getChildDetails,
  listHouseholdSections,
  listRecurringTuition,
  removeChild,
  removeHouseholdSection,
  stopRecurring,
  updateExpense,
  createChild,
  deleteExpense,
  getExpense,
  createHomeLesson,
  createHouseholdExpense,
  createRecurringHomeTuition,
  createRecurringHousehold,
  getMonthlyFinance,
  listChildren,
} from '../services/finance.service';
import { actor } from '../middleware/requireAuth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';

export const getChildren = asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listChildren(actor(req))));

export const postChild = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await createChild(actor(req), req.body), 'Child added', 201),
);

export const getMonthlyReport = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await getMonthlyFinance(actor(req), res.locals.query.month)),
);

export const postHomeLesson = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await createHomeLesson(actor(req), req.body), 'Lesson recorded', 201),
);

export const postRecurringHomeTuition = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await createRecurringHomeTuition(actor(req), req.body), 'Monthly tuition scheduled', 201),
);

export const postRecurringHousehold = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await createRecurringHousehold(actor(req), req.body), 'Recurring household expense scheduled', 201),
);

export const postHouseholdExpense = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await createHouseholdExpense(actor(req), req.body), 'Household expense recorded', 201),
);

export const getExpenseById = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await getExpense(actor(req), String(req.params.id))),
);

export const putExpense = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await updateExpense(actor(req), String(req.params.id), req.body), 'Expense updated'),
);

export const removeExpense = asyncHandler(async (req: Request, res: Response) => {
  await deleteExpense(actor(req), String(req.params.id));
  sendSuccess(res, null, 'Expense deleted');
});

export const getChild = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await getChildDetails(actor(req), String(req.params.id))),
);

export const deleteChild = asyncHandler(async (req: Request, res: Response) => {
  await removeChild(actor(req), String(req.params.id));
  sendSuccess(res, null, 'Child removed');
});

export const getRecurring = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await listRecurringTuition(actor(req), res.locals.query.childId)),
);

export const deleteRecurring = asyncHandler(async (req: Request, res: Response) => {
  await stopRecurring(actor(req), String(req.params.id));
  sendSuccess(res, null, 'Monthly fee stopped');
});

export const getHouseholdSections = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await listHouseholdSections(actor(req))),
);

export const postHouseholdSection = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await createHouseholdSection(actor(req), req.body), 'Section added', 201),
);

export const deleteHouseholdSection = asyncHandler(async (req: Request, res: Response) => {
  await removeHouseholdSection(actor(req), String(req.params.id));
  sendSuccess(res, null, 'Section removed');
});
