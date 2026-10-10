import { z } from 'zod';
import { CURRENCIES } from './payment.validator';
import { teacherRefSchema } from './teacher.validator';

const amount = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional();
const occurredAt = z.string().datetime({ offset: true });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Currency the amount was entered in; left out = the family currency. */
const currency = z.enum(CURRENCIES).optional();
/** Lesson subject: a list key ("math") or the family's own text. */
const subject = z.string().trim().min(1).max(60);

/** Optional reminder created together with an expense: N days before the due date, at `time`. */
export const reminderOptionSchema = z.object({
  daysBefore: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(7)]),
  time,
});

/** Frequencies offered for recurring expenses. */
export const recurringFrequency = z.enum(['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'YEARLY']).default('MONTHLY');

export const monthQuerySchema = z.object({ month });

export const idParamSchema = z.object({ id: z.string().uuid() });

export const recurringQuerySchema = z.object({ childId: z.string().uuid().optional() });

export const sectionSchema = z.object({ name: z.string().trim().min(1).max(60) });

export const childSchema = z.object({
  name: z.string().trim().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  school: z.string().trim().max(120).optional(),
  grade: z.string().trim().max(80).optional(),
});

export const lessonExpenseSchema = z.object({
  childId: z.string().uuid(),
  amount,
  currency,
  description: z.string().trim().max(240).optional(),
  occurredAt,
  reminder: reminderOptionSchema.optional(),
  subject: subject.optional(),
  ...teacherRefSchema,
});

export const recurringLessonSchema = z.object({
  ...teacherRefSchema,
  subject: subject.optional(),
  childId: z.string().uuid(),
  amount,
  currency,
  description: z.string().trim().min(1).max(240),
  frequency: recurringFrequency,
  /** First due date. */
  startDate: date.optional(),
  dueTime: time.default('10:00'),
  reminder: reminderOptionSchema.optional(),
});

export const householdExpenseSchema = z.object({
  amount,
  currency,
  subcategoryKey: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(240).optional(),
  occurredAt,
  reminder: reminderOptionSchema.optional(),
});

export const recurringHouseholdSchema = z.object({
  amount,
  currency,
  subcategoryKey: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().min(1).max(240),
  frequency: recurringFrequency,
  startDate: date.optional(),
  dueTime: time.default('10:00'),
  reminder: reminderOptionSchema.optional(),
});

export type LessonExpenseInput = z.infer<typeof lessonExpenseSchema>;
export type RecurringLessonInput = z.infer<typeof recurringLessonSchema>;
export type HouseholdExpenseInput = z.infer<typeof householdExpenseSchema>;
export type RecurringHouseholdInput = z.infer<typeof recurringHouseholdSchema>;
export type ReminderOption = z.infer<typeof reminderOptionSchema>;
export type ChildInput = z.infer<typeof childSchema>;export type SectionInput = z.infer<typeof sectionSchema>;

export const expenseUpdateSchema = z
  .object({
    amount: amount.optional(),
    currency,
    description: z.string().trim().max(240).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    occurredAt: occurredAt.optional(),
    /** Lessons only: move the lesson to another child. */
    childId: z.string().uuid().optional(),
    ...teacherRefSchema,
    subject: subject.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;
