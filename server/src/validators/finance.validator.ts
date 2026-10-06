import { z } from 'zod';

const amount = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional();
const occurredAt = z.string().datetime({ offset: true });

export const monthQuerySchema = z.object({ month });

export const childSchema = z.object({
  name: z.string().trim().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  school: z.string().trim().max(120).optional(),
  grade: z.string().trim().max(80).optional(),
});

export const lessonExpenseSchema = z.object({
  childId: z.string().uuid(),
  amount,
  description: z.string().trim().max(240).optional(),
  occurredAt,
});

export const recurringLessonSchema = z.object({
  childId: z.string().uuid(),
  amount,
  description: z.string().trim().min(1).max(240),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const householdExpenseSchema = z.object({
  amount,
  subcategoryKey: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(240).optional(),
  occurredAt,
});

export type LessonExpenseInput = z.infer<typeof lessonExpenseSchema>;
export type RecurringLessonInput = z.infer<typeof recurringLessonSchema>;
export type HouseholdExpenseInput = z.infer<typeof householdExpenseSchema>;
export type ChildInput = z.infer<typeof childSchema>;