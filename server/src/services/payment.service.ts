import type { Payment, PaymentCategory, PaymentFrequency, Prisma } from '@prisma/client';
import { Decimal, toMoneyString } from '../utils/money';
import { convertAmount, getExchangeRates } from './rates.service';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, parseDateOnly } from '../utils/dates';
import { addDays, localDate, nextDueDate, paymentStatus, zonedToUtc, type PaymentStatus } from '../utils/time';
import type { PaymentInput, PaymentUpdateInput } from '../validators/payment.validator';
import { assertCan, assertOwnChild, familyStandIn, paymentScope, type Actor } from './access.service';

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
  const assigneeId = input.assigneeId ?? (await familyStandIn(actor));
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

/** Where a paid bill lands in the expenses: category key + optional section key (default categories). */
const EXPENSE_TARGET: Record<PaymentCategory, [string, string | null]> = {
  RENT: ['household', 'rent'],
  INTERNET: ['household', 'internet'],
  BILL: ['household', null],
  MOBILE: ['household', null],
  TUITION: ['education', 'school_fees'],
  COURSE: ['education', 'courses'],
  SUBSCRIPTION: ['entertainment', 'subscriptions'],
  INSURANCE: ['health', 'insurance'],
  INSTALLMENT: ['other', null],
  LOAN: ['other', null],
  OTHER: ['other', null],
};

/**
 * The expense a paid cycle adds to the family's spending (in the family currency), or null when
 * the payment already has its own expense (a lesson saved with its date) or the cycle was already posted.
 */
async function expenseForPaidCycle(
  tx: Prisma.TransactionClient,
  actor: Actor,
  payment: PaymentRow,
  familyAmount: Prisma.Decimal,
  familyCurrency: string,
  paidAt: Date,
): Promise<Prisma.ExpenseUncheckedCreateInput | null> {
  if (payment.expenseId) return null;
  // Keeps the amount as paid (e.g. 100 USD); totals use familyAmount.
  const inFamilyCurrency = payment.currency === familyCurrency;
  const base = {
    familyId: payment.familyId,
    amount: payment.amount,
    currency: inFamilyCurrency ? null : payment.currency,
    familyAmount: inFamilyCurrency ? null : familyAmount,
    createdById: actor.userId,
    occurredAt: paidAt,
    description: payment.name,
  };

  // A recurring fee: post this cycle as the fee's actual expense (it replaces the planned amount).
  if (payment.recurringExpenseId) {
    const fee = await tx.recurringExpense.findUnique({ where: { id: payment.recurringExpenseId } });
    if (!fee) return null;
    const posted = await tx.expense.findFirst({ where: { recurringExpenseId: fee.id, date: payment.dueDate } });
    if (posted) return null;
    return {
      ...base,
      ownerType: fee.ownerType,
      memberId: fee.memberId,
      categoryId: fee.categoryId,
      subcategoryId: fee.subcategoryId,
      teacherId: fee.teacherId,
      subject: fee.subject,
      description: fee.description,
      date: payment.dueDate,
      isRecurring: true,
      recurringExpenseId: fee.id,
    };
  }

  const [categoryKey, sectionKey] = EXPENSE_TARGET[payment.category];
  const category = await tx.category.findFirst({ where: { familyId: payment.familyId, key: categoryKey, isActive: true } })
    ?? (await tx.category.findFirst({ where: { familyId: payment.familyId, key: 'other', isActive: true } }));
  if (!category) return null;
  const section = sectionKey ? await tx.subcategory.findFirst({ where: { categoryId: category.id, key: sectionKey, isActive: true } }) : null;
  return {
    ...base,
    ownerType: payment.memberId ? 'CHILD' : 'HOUSEHOLD',
    memberId: payment.memberId,
    categoryId: category.id,
    subcategoryId: section?.id ?? null,
    date: parseDateOnly(localDate(paidAt, actor.timezone)),
    isRecurring: payment.frequency !== 'ONCE',
  };
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
  // Paid money counts as spending, in the family currency.
  const family = await prisma.family.findUniqueOrThrow({ where: { id: current.familyId }, select: { currency: true } });
  const familyAmount = current.expenseId ? current.amount : await convertAmount(current.amount, current.currency, family.currency);

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
    const expenseData = await expenseForPaidCycle(tx, actor, current, familyAmount, family.currency, now);
    const expense = expenseData ? await tx.expense.create({ data: expenseData, select: { id: true } }) : null;
    await tx.paymentRecord.create({
      data: { paymentId: id, familyId: current.familyId, dueDate: current.dueDate, amount: current.amount, paidAt: now, paidById: actor.userId, expenseId: expense?.id ?? null },
    });
    return tx.payment.findUniqueOrThrow({ where: { id }, include });
  });
  return { ...paymentDto(updated), paidCycle: { dueDate, paidAt: now.toISOString(), status: 'PAID' as const } };
}

/**
 * What the family pays in a month: every payment cycle due that month, paid or not, in the family
 * currency. Paid = cycles due this month that were paid; remaining = unpaid cycles due this month
 * (a weekly bill counts each week), plus — for the current month — anything still overdue from
 * earlier months, since it is still owed.
 */
export async function paymentsForMonth(actor: Actor, requestedMonth?: string) {
  const now = new Date();
  const today = localDate(now, actor.timezone);
  const month = requestedMonth ?? today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const nextMonthStart = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const isCurrent = month === today.slice(0, 7);

  const [family, open, records] = await Promise.all([
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
    prisma.payment.findMany({ where: { AND: [paymentScope(actor), { deletedAt: null, state: 'ACTIVE' }] }, include }),
    prisma.paymentRecord.findMany({
      where: {
        payment: { AND: [paymentScope(actor), { deletedAt: null }] },
        OR: [
          // Cycles due this month that were paid…
          { dueDate: { gte: parseDateOnly(monthStart), lte: parseDateOnly(monthEnd) } },
          // …and overdue cycles from earlier months paid during this month (they were carried into it).
          { dueDate: { lt: parseDateOnly(monthStart) }, paidAt: { gte: zonedToUtc(monthStart, '00:00', actor.timezone), lt: zonedToUtc(nextMonthStart, '00:00', actor.timezone) } },
        ],
      },
      include: { payment: { select: { currency: true } } },
    }),
  ]);
  const currency = family.currency;
  const needsRates = [...open.map((p) => p.currency), ...records.map((r) => r.payment.currency)].some((code) => code !== currency);
  const rates = needsRates ? await getExchangeRates().then((r) => r.rates).catch(() => null) : null;
  let unconverted = 0;
  const convert = (amount: Prisma.Decimal, from: string) => {
    if (from === currency) return amount;
    if (!rates?.[from] || !rates[currency]) {
      unconverted += 1;
      return new Decimal(0);
    }
    return amount.div(rates[from]).mul(rates[currency]);
  };

  let remaining = new Decimal(0);
  let overdue = new Decimal(0);
  let remainingCount = 0;
  for (const payment of open) {
    const start = formatDateOnly(payment.startDate);
    // Walk the unpaid cycles from the current one up to the end of the month.
    let due: string | null = formatDateOnly(payment.dueDate);
    for (let i = 0; due && due <= monthEnd && i < 400; i += 1) {
      const carriedOverdue = isCurrent && due < monthStart;
      if (due >= monthStart || carriedOverdue) {
        const value = convert(payment.amount, payment.currency);
        remaining = remaining.plus(value);
        remainingCount += 1;
        const dueAt = zonedToUtc(due, payment.dueTime, payment.timezone);
        if (dueAt <= now) overdue = overdue.plus(value);
      }
      due = nextDueDate(due, payment.frequency, start, payment.customIntervalDays);
    }
  }
  const paid = records.reduce((total, r) => total.plus(convert(r.amount, r.payment.currency)), new Decimal(0));

  return {
    month,
    currency,
    total: toMoneyString(paid.plus(remaining), currency),
    paid: toMoneyString(paid, currency),
    paidCount: records.length,
    remaining: toMoneyString(remaining, currency),
    remainingCount,
    overdue: toMoneyString(overdue, currency),
    unconvertedCount: unconverted,
  };
}

/**
 * Totals for the payments screen, in the family currency, from the real data: what is still to pay
 * (unpaid cycles only), overdue, due today, due in the next 7 days, and what was actually paid this
 * month according to the payment history.
 */
export async function paymentTotals(actor: Actor) {
  const now = new Date();
  const [family, open, records] = await Promise.all([
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
    // Every live payment (paid or not); cancelled ones don't count.
    prisma.payment.findMany({ where: { AND: [paymentScope(actor), { deletedAt: null, state: { in: ['ACTIVE', 'PAID'] } }] }, include }),
    (() => {
      const month = localDate(now, actor.timezone).slice(0, 7);
      const start = zonedToUtc(`${month}-01`, '00:00', actor.timezone);
      const [y, m] = month.split('-').map(Number);
      const nextMonth = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
      const end = zonedToUtc(nextMonth, '00:00', actor.timezone);
      return prisma.paymentRecord.findMany({
        where: { paidAt: { gte: start, lt: end }, payment: { AND: [paymentScope(actor), { deletedAt: null }] } },
        include: { payment: { select: { currency: true } } },
      });
    })(),
  ]);
  const currency = family.currency;
  const all = open;
  const needsRates = [...all.map((p) => p.currency), ...records.map((r) => r.payment.currency)].some((code) => code !== currency);
  // If the rate service is down, same-currency payments still add up; the rest is flagged, not guessed.
  const rates = needsRates ? await getExchangeRates().then((r) => r.rates).catch(() => null) : null;
  let unconverted = 0;
  const convert = (amount: Prisma.Decimal, from: string) => {
    if (from === currency) return amount;
    if (!rates?.[from] || !rates[currency]) {
      unconverted += 1;
      return new Decimal(0);
    }
    return amount.div(rates[from]).mul(rates[currency]);
  };
  const sum = (rows: Payment[]) => rows.reduce((total, p) => total.plus(convert(p.amount, p.currency)), new Decimal(0));

  // Each payment counts once, the way the list shows it: PAID (one-time paid, or a recurring bill
  // whose last cycle is paid) or still to pay.
  const paidNow = all.filter((p) => paymentStatus(p, now) === 'PAID');
  const unpaid = all.filter((p) => paymentStatus(p, now) !== 'PAID');
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
  const overdue = unpaid.filter((p) => paymentStatus(p, now) === 'OVERDUE');
  const dueToday = unpaid.filter((p) => paymentStatus(p, now) === 'DUE_TODAY');
  const next7 = unpaid.filter((p) => p.dueAt >= now && p.dueAt < weekAhead);
  const paid = records.reduce((total, r) => total.plus(convert(r.amount, r.payment.currency)), new Decimal(0));

  return {
    currency,
    /** All payments (paid + still to pay), each counted once — matches the payments list. */
    // The sum of the two rounded parts, so "paid + to pay" always equals the total on screen.
    total: toMoneyString(new Decimal(toMoneyString(sum(paidNow), currency)).plus(toMoneyString(sum(unpaid), currency)), currency),
    totalCount: all.length,
    paid: toMoneyString(sum(paidNow), currency),
    paidCount: paidNow.length,
    toPay: toMoneyString(sum(unpaid), currency),
    toPayCount: unpaid.length,
    overdue: toMoneyString(sum(overdue), currency),
    overdueCount: overdue.length,
    dueToday: toMoneyString(sum(dueToday), currency),
    next7Days: toMoneyString(sum(next7), currency),
    paidThisMonth: toMoneyString(paid, currency),
    paidThisMonthCount: records.length,
    /** Payments in another currency left out because no exchange rate was available. */
    unconvertedCount: unconverted,
  };
}

/**
 * Undoes the most recent "paid": the payment goes back to that cycle (due date, due time, reminder)
 * and the payment record and the expense it created are removed. Repeat to undo earlier cycles.
 */
export async function unpayPayment(actor: Actor, id: string) {
  assertCan(actor, 'EDIT_PAYMENT');
  const current = await visiblePayment(actor, id);
  if (current.state === 'CANCELLED') throw AppError.conflict('This payment is cancelled');
  const last = await prisma.paymentRecord.findFirst({ where: { paymentId: id }, orderBy: [{ paidAt: 'desc' }, { dueDate: 'desc' }] });
  if (!last) throw AppError.conflict('This payment has not been paid yet');

  const dueDate = formatDateOnly(last.dueDate);
  const dueAt = zonedToUtc(dueDate, current.dueTime, current.timezone);
  const reminderAt = !current.reminderEnabled
    ? null
    : current.reminderDaysBefore != null
      ? presetReminderAt({ ...current, dueDate })
      : current.reminderAt
        ? new Date(current.reminderAt.getTime() - (current.dueAt.getTime() - dueAt.getTime()))
        : null;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.paymentRecord.delete({ where: { id: last.id } });
    // The spending it added goes away too (soft delete, like any removed expense).
    if (last.expenseId) await tx.expense.updateMany({ where: { id: last.expenseId, deletedAt: null }, data: { deletedAt: new Date() } });
    // The undone cycle is unpaid again, so the payment must not keep showing "Paid" from an
    // earlier cycle: it reads "awaiting payment" until it's paid (earlier cycles stay in the history).
    return tx.payment.update({
      where: { id },
      data: { state: 'ACTIVE', dueDate: last.dueDate, dueAt, reminderAt, lastPaidAt: null, lastPaidById: null },
      include,
    });
  });
  return paymentDto(updated);
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
