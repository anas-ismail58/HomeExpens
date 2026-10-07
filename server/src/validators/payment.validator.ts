import { z } from 'zod';

const amount = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const PAYMENT_CATEGORIES = ['BILL', 'TUITION', 'COURSE', 'SUBSCRIPTION', 'RENT', 'INTERNET', 'MOBILE', 'INSURANCE', 'INSTALLMENT', 'LOAN', 'OTHER'] as const;
export const PAYMENT_FREQUENCIES = ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'YEARLY', 'CUSTOM'] as const;
export const CURRENCIES = ['SAR', 'EGP', 'USD', 'EUR', 'AED', 'KWD', 'QAR', 'BHD'] as const;
export const REMINDER_PRESETS = [0, 1, 3, 7] as const;

const fields = {
  name: z.string().trim().min(1).max(120),
  description: optionalText(500),
  notes: optionalText(1000),
  amount,
  currency: z.enum(CURRENCIES).optional(),
  category: z.enum(PAYMENT_CATEGORIES),
  frequency: z.enum(PAYMENT_FREQUENCIES),
  customIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  startDate: date.optional(),
  dueDate: date,
  dueTime: time,
  /** Family user who receives the notifications (defaults to the creator). */
  assigneeId: z.string().uuid().optional(),
  /** Optional child this payment is for. */
  memberId: z.string().uuid().nullable().optional(),
  reminderEnabled: z.boolean().default(false),
  /** Preset: 0 = on the due date, 1/3/7 days before — at reminderTime (defaults to the due time). */
  reminderDaysBefore: z.number().int().refine((value) => (REMINDER_PRESETS as readonly number[]).includes(value), 'Use 0, 1, 3 or 7').nullable().optional(),
  reminderTime: time.nullable().optional(),
  /** Custom reminder instant (ISO 8601 with offset). Used when reminderDaysBefore is null. */
  reminderAt: z.string().datetime({ offset: true }).nullable().optional(),
};

type Shape = { frequency?: string; customIntervalDays?: number | null; reminderEnabled?: boolean; reminderDaysBefore?: number | null; reminderAt?: string | null };

function checkRules(value: Shape, ctx: z.RefinementCtx) {
  if (value.frequency === 'CUSTOM' && !value.customIntervalDays) {
    ctx.addIssue({ code: 'custom', path: ['customIntervalDays'], message: 'Custom frequency needs an interval in days' });
  }
  if (value.reminderEnabled && value.reminderDaysBefore == null && !value.reminderAt) {
    ctx.addIssue({ code: 'custom', path: ['reminderDaysBefore'], message: 'Choose when to be reminded' });
  }
}

export const paymentSchema = z.object(fields).superRefine(checkRules);
export const paymentUpdateSchema = z
  .object(fields)
  .partial()
  .superRefine(checkRules)
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export const paymentListQuerySchema = z.object({
  status: z.enum(['UPCOMING', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'PAID', 'CANCELLED', 'OPEN']).optional(),
});

export type PaymentInput = z.infer<typeof paymentSchema>;
export type PaymentUpdateInput = z.infer<typeof paymentUpdateSchema>;
