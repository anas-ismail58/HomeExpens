import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { formatDateOnly, parseDateOnly } from '../utils/dates';
import { Decimal, toMoneyString } from '../utils/money';
import { addDays, localDate } from '../utils/time';
import { can, childScope, expenseScope, paymentScope, type Actor } from './access.service';
import { expenseDto, expenseInclude } from './finance.service';
import { getExchangeRates } from './rates.service';
import { ledger } from './country.service';

export type Period = 'today' | 'week' | 'month' | 'custom';

/** The date range for a period, in the viewer's timezone. Weeks start on Saturday. */
export function periodRange(period: Period, today: string, from?: string, to?: string) {
  if (period === 'custom' && from && to) return from <= to ? { from, to } : { from: to, to: from };
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') {
    const dow = parseDateOnly(today).getUTCDay();
    const start = addDays(today, -((dow + 1) % 7));
    return { from: start, to: addDays(start, 6) };
  }
  const start = `${today.slice(0, 7)}-01`;
  const [y, m] = start.split('-').map(Number);
  return { from: start, to: formatDateOnly(new Date(Date.UTC(y, m, 0))) };
}

const LESSON: Prisma.ExpenseWhereInput = { subcategory: { key: 'home_tutoring' } };

/** Converts payment amounts to the family currency with today's rates (fetched once); unknown → skipped. */
async function converter(currency: string, codes: string[]) {
  const rates = codes.some((c) => c !== currency) ? (await getExchangeRates().catch(() => null))?.rates ?? null : null;
  return (amount: Prisma.Decimal, from: string) => {
    if (from === currency) return amount;
    if (!rates?.[from] || !rates?.[currency]) return null;
    return amount.div(rates[from]).mul(rates[currency]);
  };
}

/** "2026-12" → "2027-01". */
function nextMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

/** Months ("YYYY-MM") ending with `month`, oldest first. */
function lastMonths(month: string, count: number) {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/**
 * Everything the home dashboard and analytics need, from real data, limited to what the viewer may see:
 * totals for the period, a 6-month trend, spending over the period, paid vs unpaid, upcoming reminders,
 * outstanding amounts by child and teacher, children's task progress, and the latest 4 of each record.
 */
export async function getInsights(actor: Actor, input: { period?: Period; from?: string; to?: string }) {
  const today = localDate(new Date(), actor.timezone);
  const period = input.period ?? 'month';
  const range = periodRange(period, today, input.from, input.to);
  const start = parseDateOnly(range.from);
  const endExclusive = parseDateOnly(addDays(range.to, 1));
  const now = new Date();
  // One country: its records in its currency. All countries: each converted to the family currency.
  const L = await ledger(actor);
  const currency = L.currency;
  const familyValue = L.value;
  const lessons = can(actor, 'SERVICE_LESSONS');
  const seesKids = actor.isAdmin || actor.role === 'CHILD' || (['EVALUATE_CHILDREN', 'MANAGE_CHILD_TASKS', 'PENALIZE_CHILDREN'] as const).some((k) => can(actor, k));
  const expenseWhere = (extra: Prisma.ExpenseWhereInput): Prisma.ExpenseWhereInput => ({ AND: [expenseScope(actor), { deletedAt: null }, extra] });
  const trendMonths = lastMonths(range.to.slice(0, 7), 6);
  const trendStart = parseDateOnly(`${trendMonths[0]}-01`);

  const [rangeExpenses, trendExpenses, records, open, recentLessons, recentTransactions, children] = await Promise.all([
    prisma.expense.findMany({ where: expenseWhere({ date: { gte: start, lt: endExclusive } }), select: { amount: true, familyAmount: true, countryId: true, date: true, subcategory: { select: { key: true } } } }),
    prisma.expense.findMany({ where: expenseWhere({ date: { gte: trendStart, lt: endExclusive } }), select: { amount: true, familyAmount: true, countryId: true, date: true, subcategory: { select: { key: true } } } }),
    prisma.paymentRecord.findMany({
      where: { familyId: actor.familyId, paidAt: { gte: start, lt: endExclusive }, payment: paymentScope(actor) },
      select: { id: true, amount: true, paidAt: true, dueDate: true, receiptCheck: true, payment: { select: { id: true, name: true, currency: true, category: true } }, paidBy: { select: { name: true } } },
      orderBy: { paidAt: 'desc' },
    }),
    prisma.payment.findMany({
      where: { AND: [paymentScope(actor), { deletedAt: null, state: 'ACTIVE' }] },
      select: { id: true, name: true, amount: true, currency: true, category: true, dueAt: true, dueDate: true, dueTime: true, member: { select: { id: true, name: true } }, teacher: { select: { id: true, name: true } } },
      orderBy: { dueAt: 'asc' },
    }),
    lessons ? prisma.expense.findMany({ where: expenseWhere(LESSON), include: expenseInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 4 }) : [],
    prisma.expense.findMany({ where: expenseWhere({}), include: expenseInclude, orderBy: [{ createdAt: 'desc' }], take: 4 }),
    seesKids ? prisma.familyMember.findMany({ where: { ...childScope(actor), type: 'CHILD', isActive: true, deletedAt: null }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }) : [],
  ]);

  const toFamily = await converter(currency, [...records.map((r) => r.payment.currency), ...open.map((p) => p.currency)]);
  const sum = (values: (Prisma.Decimal | null)[]) => values.reduce<Prisma.Decimal>((t, v) => (v ? t.plus(v) : t), new Decimal(0));
  const money = (value: Prisma.Decimal) => toMoneyString(value, currency);

  // Payments: paid in the period, still unpaid and due by the end of it, and overdue now.
  const dueByEnd = open.filter((p) => p.dueAt < endExclusive);
  const overdue = open.filter((p) => p.dueAt <= now);
  const upcomingLessonPayments = lessons ? open.filter((p) => p.category === 'TUITION' && p.dueAt > now && p.dueAt <= new Date(now.getTime() + 7 * 864e5)) : [];
  const futureLessons = lessons ? await prisma.expense.count({ where: expenseWhere({ ...LESSON, date: { gt: parseDateOnly(today) } }) }) : 0;

  // Spending over the period: by day for up to ~2 months, by month beyond that.
  const days = Math.round((endExclusive.getTime() - start.getTime()) / 864e5);
  const byMonth = days > 62;
  const buckets = new Map<string, { expenses: Prisma.Decimal; lessons: Prisma.Decimal }>();
  if (byMonth) for (let m = range.from.slice(0, 7); m <= range.to.slice(0, 7); m = nextMonth(m)) buckets.set(m, { expenses: new Decimal(0), lessons: new Decimal(0) });
  else for (let d = range.from; d <= range.to; d = addDays(d, 1)) buckets.set(d, { expenses: new Decimal(0), lessons: new Decimal(0) });
  for (const e of rangeExpenses) {
    const key = byMonth ? formatDateOnly(e.date).slice(0, 7) : formatDateOnly(e.date);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.expenses = bucket.expenses.plus(familyValue(e));
    if (e.subcategory?.key === 'home_tutoring') bucket.lessons = bucket.lessons.plus(familyValue(e));
  }

  const trend = trendMonths.map((month) => {
    const rows = trendExpenses.filter((e) => formatDateOnly(e.date).startsWith(month));
    return { month, expenses: money(sum(rows.map(familyValue))), lessons: money(sum(rows.filter((e) => e.subcategory?.key === 'home_tutoring').map(familyValue))) };
  });

  // Outstanding (unpaid, due by the end of the period) per child and per teacher.
  const group = (key: (p: (typeof dueByEnd)[number]) => { id: string; name: string } | null) => {
    const map = new Map<string, { id: string; name: string; amount: Prisma.Decimal; count: number }>();
    for (const p of dueByEnd) {
      const who = key(p);
      const value = toFamily(p.amount, p.currency);
      if (!who || !value) continue;
      const row = map.get(who.id) ?? { ...who, amount: new Decimal(0), count: 0 };
      row.amount = row.amount.plus(value);
      row.count++;
      map.set(who.id, row);
    }
    return [...map.values()].sort((a, b) => b.amount.comparedTo(a.amount)).map((r) => ({ id: r.id, name: r.name, amount: money(r.amount), count: r.count }));
  };

  // Children: tasks done in the period and points earned.
  const ids = children.map((c) => c.id);
  const [tasks, entries, recentTasks] = seesKids && ids.length
    ? await Promise.all([
        prisma.childTask.findMany({ where: { memberId: { in: ids }, deletedAt: null, OR: [{ forDate: { gte: start, lt: endExclusive } }, { dailyTaskId: null, createdAt: { gte: start, lt: endExclusive } }, { reviewedAt: { gte: start, lt: endExclusive } }] }, select: { memberId: true, status: true, dailyTaskId: true } }),
        prisma.childPointEntry.findMany({ where: { memberId: { in: ids }, voidedAt: null, date: { gte: start, lt: endExclusive } }, select: { memberId: true, kind: true, points: true } }),
        prisma.childTask.findMany({ where: { memberId: { in: ids }, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 4, select: { id: true, title: true, points: true, status: true, dailyTaskId: true, updatedAt: true, member: { select: { id: true, name: true } } } }),
      ])
    : [[], [], []];
  const kids = children.map((child) => {
    const mine = tasks.filter((t) => t.memberId === child.id);
    const points = entries.filter((e) => e.memberId === child.id);
    return {
      id: child.id,
      name: child.name,
      tasksDone: mine.filter((t) => t.status === 'APPROVED').length,
      tasksWaiting: mine.filter((t) => t.status === 'COMPLETED').length,
      tasksTotal: mine.length,
      earned: points.filter((e) => (e.kind === 'AWARD' || e.kind === 'TASK') && e.points > 0).reduce((t, e) => t + e.points, 0),
      lost: points.filter((e) => e.kind === 'PENALTY').reduce((t, e) => t - e.points, 0),
    };
  });

  const paidTotal = sum(records.map((r) => toFamily(r.amount, r.payment.currency)));
  const unpaidTotal = sum(dueByEnd.map((p) => toFamily(p.amount, p.currency)));
  const overdueTotal = sum(overdue.map((p) => toFamily(p.amount, p.currency)));

  return {
    period,
    range,
    currency,
    unit: byMonth ? ('month' as const) : ('day' as const),
    totals: {
      expenses: money(sum(rangeExpenses.map(familyValue))),
      lessons: lessons ? money(sum(rangeExpenses.filter((e) => e.subcategory?.key === 'home_tutoring').map(familyValue))) : null,
      paid: { amount: money(paidTotal), count: records.length },
      unpaid: { amount: money(unpaidTotal), count: dueByEnd.length },
      overdue: { amount: money(overdueTotal), count: overdue.length },
      upcomingLessons: lessons ? futureLessons + upcomingLessonPayments.length : null,
      children: seesKids ? children.length : null,
      tasks: seesKids ? { done: kids.reduce((t, k) => t + k.tasksDone, 0), total: kids.reduce((t, k) => t + k.tasksTotal, 0) } : null,
    },
    spending: [...buckets.entries()].map(([key, v]) => ({ key, expenses: money(v.expenses), lessons: money(v.lessons) })),
    trend,
    reminders: open.filter((p) => p.dueAt > now).slice(0, 5).map((p) => ({ id: p.id, name: p.name, amount: p.amount.toString(), currency: p.currency, dueDate: formatDateOnly(p.dueDate), dueTime: p.dueTime, category: p.category, child: p.member })),
    outstanding: { byChild: group((p) => p.member), byTeacher: lessons ? group((p) => p.teacher) : [] },
    kids,
    recent: {
      lessons: recentLessons.map((expense) => expenseDto(expense, L.value)),
      transactions: recentTransactions.map((expense) => expenseDto(expense, L.value)),
      payments: records.length
        ? records.slice(0, 4).map((r) => ({ id: r.id, paymentId: r.payment.id, name: r.payment.name, amount: r.amount.toString(), currency: r.payment.currency, paidAt: r.paidAt.toISOString(), paidBy: r.paidBy?.name ?? null, receiptCheck: r.receiptCheck }))
        : (await prisma.paymentRecord.findMany({ where: { familyId: actor.familyId, payment: paymentScope(actor) }, orderBy: { paidAt: 'desc' }, take: 4, select: { id: true, amount: true, paidAt: true, receiptCheck: true, payment: { select: { id: true, name: true, currency: true } }, paidBy: { select: { name: true } } } })).map((r) => ({ id: r.id, paymentId: r.payment.id, name: r.payment.name, amount: r.amount.toString(), currency: r.payment.currency, paidAt: r.paidAt.toISOString(), paidBy: r.paidBy?.name ?? null, receiptCheck: r.receiptCheck })),
      tasks: recentTasks.map((t) => ({ id: t.id, title: t.title, points: t.points, status: t.status, daily: Boolean(t.dailyTaskId), updatedAt: t.updatedAt.toISOString(), child: t.member })),
    },
  };
}
