import type { Request, Response } from 'express';
import { createChild, createHomeLesson, createHouseholdExpense, createRecurringHomeTuition, getMonthlyFinance, listChildren } from '../services/finance.service';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';

function familyId(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth.familyId;
}

export const getChildren = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await listChildren(familyId(req))),
);

export const postChild = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await createChild(familyId(req), req.body), 'Child added', 201),
);

export const getMonthlyReport = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await getMonthlyFinance(familyId(req), res.locals.query.month)),
);

export const postHomeLesson = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await createHomeLesson(familyId(req), req.body), 'Lesson recorded', 201),
);

export const postRecurringHomeTuition = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await createRecurringHomeTuition(familyId(req), req.body), 'Monthly tuition scheduled', 201),
);

export const postHouseholdExpense = asyncHandler(async (req: Request, res: Response) =>
  sendSuccess(res, await createHouseholdExpense(familyId(req), req.body), 'Household expense recorded', 201),
);