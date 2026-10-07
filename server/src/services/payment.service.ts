import type { Payment, PaymentFrequency, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, parseDateOnly } from '../utils/dates';
import { addDays, localDate, nextDueDate, paymentStatus, zonedToUtc, type PaymentStatus } from '../utils/time';
import type { PaymentInput, PaymentUpdateInput } from '../validators/payment.validator';
import { assertCan, assertOwnChild, paymentScope, type Actor } from './access.service';

const person = { select: { id: true, name: true } } as const;
const include = { createdBy: person, assignee: person, lastPaidBy: person, member: person } satisfies Prisma.PaymentInclude;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof include }>;

const STATUS_ORDER: Record<PaymentStatus, number> = { OVERDUE: 0, DUE_TODAY: 1, DUE_SOON: 2, UPCOMING: 3, PAID: 4, CANCELLED: 5 };

export function paymentDto(payment: PaymentRow, now = new Date()) {
  const dueDate = formatDateOnly(payment.dueDate);
  return {
    id: payment.id,
    name: payment.name,
    description: payment.description,
    notes: payment.notes,
    amount: payment.amount.toString(),
    currency: payment.currency,
    category: payment.category,
    frequency: payment.frequency,
    customIntervalDays: payment.customIntervalDays,
    isRecurring: payment.frequency !== 'ONCE',
    startDate: formatDateOnly(payment.startDate),
    dueDate,
    dueTime: payment.dueTime,
    timezone: payment.timezone,
    dueAt: payment.dueAt.toISOString(),
    nextDueDate: payment.state === 'ACTIVE' ? nextDueDate(dueDate, payment.frequency, formatDateOnly(payment.startDate), payment.customIntervalDays) : null,
    state: payment.state,
    status: paymentStatus(payment, now),
    reminderEnabled: payment.reminderEnabled,
    reminderDaysBefore: payment.reminderDaysBefore,
    reminderTime: payment.reminderTime,
    reminderAt: payment.reminderAt?.toISOString() ?? null,
    lastPaidAt: payment.lastPaidAt?.toISOString() ?? null,
    lastPaidBy: payment.lastPaidBy,
    createdBy: payment.createdBy,
    assignee: payment.assignee,
    member: payment.member,
    createdAt: payment.createdAt.toISOString(),
  };
}

type Timing = Pick<Payment, 'dueTime' | 'timezone' | 'reminderEnabled' | 'reminderDaysBefore' | 'reminderTime'> & { dueDate: string };

/** Reminder instant for the cycle due on `dueDate`. Presets are relative to the due date in the payment's zone. */
function presetReminderAt(timing: Timing) {
  if (!timing.reminderEnabled || timing.reminderDaysBefore == null) return null;
  return zonedToUtc(addDays(timing.dueDate, -timing.reminderDaysBefore), timing.reminderTime ?? timing.dueTime, timing.timezone);
}

async function familyUser(familyId: string, userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, familyId, isActive: true }, select: { id: true, timezone: true } });
  if (!user) throw AppError.notFound('Family member not found');
  return user;
}

async function familyChild(familyId: string, memberId: string) {
  const child = await prisma.familyMember.findFirst({ where: { id: memberId, familyId, deletedAt: null } });
  if (!child) throw AppError.notFound('Child not found in this family');
}

/** Loads a payment the actor can see, or 404 (never reveals other families' ids). */
async function visiblePayment(actor: Actor, id: string) {
  const payment = await prisma.payment.findFirst({ where: { AND: [paymentScope(actor), { id, deletedAt: null }] }, include });
  if (!payment) throw AppError.notFound('Payment not found');
  return payment;
}

export async function listPayments(actor: Actor, status?: PaymentStatus | 'OPEN') {
  const rows = await prisma.payment.findMany({
    where: { AND: [paymentScope(actor), { deletedAt: null }] },
    include,
    orderBy: { dueAt: 'asc' },
    take: 500,
  });
  const now = new Date();
  return rows
    .map((row) => paymentDto(row, now))
    // OPEN = still has a cycle to pay (includes recurring payments whose last cycle shows PAID).
    .filter((payment) => !status || (status === 'OPEN' ? payment.state === 'ACTIVE' : payment.status === status))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.dueAt.localeCompare(b.dueAt));
}

export async function getPayment(actor: Actor, id: string) {
  const payment = await visiblePayment(actor, id);
  const history = await prisma.paymentRecord.findMany({
    where: { paymentId: id },
    include: { paidBy: person },
    orderBy: { paidAt: 'desc' },
    take: 60,
  });
  return {
    ...paymentDto(payment),
    history: history.map((record) => ({
      id: record.id,
      dueDate: formatDateOnly(record.dueDate),
      amount: record.amount.toString(),
      paidAt: record.paidAt.toISOString(),
      paidBy: record.paidBy,
      status: 'PAID' as const,
    })),
  };
}

export async function createPayment(actor: Actor, input: PaymentInput, links: { expenseId?: string; recurringExpenseId?: string } = {}) {
  assertCan(actor, 'ADD_PAYMENT');
  const assigneeId = input.assigneeId ?? actor.userId;
  // Children may only create payments for themselves.
  if (actor.role === 'CHILD' && assigneeId !== actor.userId) throw AppError.forbidden('Children can only create their own payments');
  if (input.memberId) {
    assertOwnChild(actor, input.memberId);
    await familyChild(actor.familyId, input.memberId);
  }
  const [assignee, family] = await Promise.all([
    familyUser(actor.familyId, assigneeId),
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
  ]);

  const timing: Timing = {
    dueDate: input.dueDate,
    dueTime: input.dueTime,
    timezone: assignee.timezone,
    reminderEnabled: input.reminderEnabled,
    reminderDaysBefore: input.reminderDaysBefore ?? null,
    reminderTime: input.reminderTime ?? null,
  };
  const payment = await prisma.payment.create({
    data: {
      familyId: actor.familyId,
      createdById: actor.userId,
      assigneeId,
      memberId: input.memberId ?? null,
      expenseId: links.expenseId ?? null,
      recurringExpenseId: links.recurringExpenseId ?? null,
      name: input.name,
      description: input.description ?? null,
      notes: input.notes ?? null,
      amount: input.amount,
      currency: input.currency ?? family.currency,
      category: input.category,
      frequency: input.frequency,
      customIntervalDays: input.frequency === 'CUSTOM' ? input.customIntervalDays : null,
      startDate: parseDateOnly(input.startDate ?? input.dueDate),
      dueDate: parseDateOnly(input.dueDate),
      dueTime: input.dueTime,
      timezone: assignee.timezone,
      dueAt: zonedToUtc(input.dueDate, input.dueTime, assignee.timezone),
      reminderEnabled: input.reminderEnabled,
      reminderDaysBefore: input.reminderEnabled ? input.reminderDaysBefore ?? null : null,
      reminderTime: input.reminderEnabled ? input.reminderTime ?? null : null,
      reminderAt: !input.reminderEnabled ? null : input.reminderDaysBefore != null ? presetReminderAt(timing) : new Date(input.reminderAt!),
    },
    include,
  });
  return paymentDto(payment);
}

export async function updatePayment(actor: Actor, id: string, input: PaymentUpdateInput) {
  assertCan(actor, 'EDIT_PAYMENT');
  const current = await visiblePayment(actor, id);
  if (input.memberId) {
    assertOwnChild(actor, input.memberId);
    await familyChild(actor.familyId, input.memberId);
  }
  if (input.assigneeId && actor.role === 'CHILD' && input.assigneeId !== actor.userId) throw AppError.forbidden('Children can only assign payments to themselves');
  const assignee = input.assigneeId ? await familyUser(actor.familyId, input.assigneeId) : null;

  const frequency = input.frequency ?? current.frequency;
  const dueDate = input.dueDate ?? formatDateOnly(current.dueDate);
  const dueTime = input.dueTime ?? current.dueTime;
  const timezone = assignee?.timezone ?? current.timezone;
  const reminderEnabled = input.reminderEnabled ?? current.reminderEnabled;
  const reminderDaysBefore = input.reminderDaysBefore !== undefined ? input.reminderDaysBefore : input.reminderAt ? null : current.reminderDaysBefore;
  const reminderTime = input.reminderTime !== undefined ? input.reminderTime : current.reminderTime;
  const timing: Timing = { dueDate, dueTime, timezone, reminderEnabled, reminderDaysBefore, reminderTime };
  const reminderAt = !reminderEnabled
    ? null
    : reminderDaysBefore != null
      ? presetReminderAt(timing)
      : input.reminderAt
        ? new Date(input.reminderAt)
        : current.reminderAt;
  if (reminderEnabled && !reminderAt) throw AppError.validation([{ field: 'reminderDaysBefore', message: 'Choose when to be reminded' }]);
  const dueAt = zonedToUtc(dueDate, dueTime, timezone);

  const updated = await prisma.$transaction(async (tx) => {
    // A changed schedule may fire again for the same cycle.
    if (reminderAt?.getTime() !== current.reminderAt?.getTime()) {
      await tx.paymentReminder.deleteMany({ where: { paymentId: id, kind: 'REMINDER', dueDate: parseDateOnly(dueDate) } });
    }
    if (dueAt.getTime() !== current.dueAt.getTime()) {
      await tx.paymentReminder.deleteMany({ where: { paymentId: id, kind: 'OVERDUE', dueDate: parseDateOnly(dueDate) } });
    }
    return tx.payment.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        notes: input.notes,
        amount: input.amount,
        currency: input.currency,
        category: input.category,
        frequency,
        customIntervalDays: frequency === 'CUSTOM' ? input.customIntervalDays ?? current.customIntervalDays : null,
        startDate: input.startDate ? parseDateOnly(input.startDate) : undefined,
        dueDate: parseDateOnly(dueDate),
        dueTime,
        timezone,
        dueAt,
        assigneeId: assignee?.id,
        memberId: input.memberId,
        reminderEnabled,
        reminderDaysBefore: reminderEnabled ? reminderDaysBefore : null,
        reminderTime: reminderEnabled ? reminderTime : null,
        reminderAt,
      },
      include,
    });
  });
  return paymentDto(updated);
}

/**
 * Marks the current cycle as paid. One-time payments become PAID; recurring ones record the cycle in
 * the history and roll forward to the next due date (the reminder moves with it).
 */
export async function payPayment(actor: Actor, id: string) {
  assertCan(actor, 'EDIT_PAYMENT');
  const current = await visiblePayment(actor, id);
  if (current.state !== 'ACTIVE') throw AppError.conflict(current.state === 'PAID' ? 'This payment is already paid' : 'This payment is cancelled');

  const dueDate = formatDateOnly(current.dueDate);
  const next = nextDueDate(dueDate, current.frequency, formatDateOnly(current.startDate), current.customIntervalDays);
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    // Optimistic guard: a double tap (or two family members) can't pay the same cycle twice.
    const data: Prisma.PaymentUncheckedUpdateManyInput = { lastPaidAt: now, lastPaidById: actor.userId };
    if (next) {
      const nextDueAt = zonedToUtc(next, current.dueTime, current.timezone);
      data.dueDate = parseDateOnly(next);
      data.dueAt = nextDueAt;
      data.reminderAt = current.reminderDaysBefore != null
        ? presetReminderAt({ ...current, dueDate: next })
        : current.reminderAt
          ? new Date(current.reminderAt.getTime() + (nextDueAt.getTime() - current.dueAt.getTime()))
          : null;
    } else {
      data.state = 'PAID';
    }
    const { count } = await tx.payment.updateMany({ where: { id, state: 'ACTIVE', dueDate: current.dueDate }, data });
    if (!count) throw AppError.conflict('This payment was just updated. Refresh and try again.');
    await tx.paymentRecord.create({
      data: { paymentId: id, familyId: current.familyId, dueDate: current.dueDate, amount: current.amount, paidAt: now, paidById: actor.userId },
    });
    return tx.payment.findUniqueOrThrow({ where: { id }, include });
  });
  return { ...paymentDto(updated), paidCycle: { dueDate, paidAt: now.toISOString(), status: 'PAID' as const } };
}

export async function cancelPayment(actor: Actor, id: string) {
  assertCan(actor, 'EDIT_PAYMENT');
  const current = await visiblePayment(actor, id);
  if (current.state === 'CANCELLED') return paymentDto(current);
  const updated = await prisma.payment.update({ where: { id }, data: { state: 'CANCELLED', cancelledAt: new Date() }, include });
  return paymentDto(updated);
}

export async function deletePayment(actor: Actor, id: string) {
  assertCan(actor, 'DELETE_PAYMENT');
  await visiblePayment(actor, id);
  await prisma.payment.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** First due date on or after `today` for a schedule starting at `startDate`. */
export function firstDueOnOrAfter(startDate: string, frequency: PaymentFrequency, today: string) {
  let due = startDate;
  for (let i = 0; due < today && i < 1000; i += 1) {
    const next = nextDueDate(due, frequency, startDate);
    if (!next) break;
    due = next;
  }
  return due;
}

/** Cancels the open reminders created together with an expense or recurring expense. */
export async function cancelLinkedPayments(where: { expenseId?: string; recurringExpenseId?: string | { in: string[] } }) {
  await prisma.payment.updateMany({ where: { ...where, state: 'ACTIVE', deletedAt: null }, data: { state: 'CANCELLED', cancelledAt: new Date() } });
}

/** Re-anchors a user's open payments after they change time zone (due times are local wall-clock times). */
export async function retimePaymentsForUser(userId: string, timezone: string) {
  const payments = await prisma.payment.findMany({ where: { assigneeId: userId, state: 'ACTIVE', deletedAt: null } });
  for (const payment of payments) {
    const dueDate = formatDateOnly(payment.dueDate);
    const timing = { ...payment, dueDate, timezone };
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        timezone,
        dueAt: zonedToUtc(dueDate, payment.dueTime, timezone),
        reminderAt: payment.reminderDaysBefore != null ? presetReminderAt(timing) : payment.reminderAt,
      },
    });
  }
}

/** Open payments for the dashboard, already sorted by urgency. */
export async function paymentSummary(actor: Actor) {
  const open = await listPayments(actor, 'OPEN');
  const today = localDate(new Date(), actor.timezone);
  return {
    today,
    overdue: open.filter((p) => p.status === 'OVERDUE'),
    dueToday: open.filter((p) => p.status === 'DUE_TODAY'),
    upcoming: open.filter((p) => p.status !== 'OVERDUE' && p.status !== 'DUE_TODAY').slice(0, 10),
  };
}
