import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, monthRange, parseDateOnly } from '../utils/dates';
import { Decimal, toMoneyString } from '../utils/money';
import { localDate } from '../utils/time';
import { assertAdmin, assertCan, type Actor } from './access.service';
import { getMonthlyFinance } from './finance.service';

const SALARY_SOURCE = 'salary';

function monthOf(actor: Actor, month?: string) {
  return month ?? localDate(new Date(), actor.timezone).slice(0, 7);
}

/** Recurring incomes (the salary) that apply to the month: started by its end, not ended before its start. */
function recurringInMonth(familyId: string, range: { start: Date; end: Date }): Prisma.RecurringIncomeWhereInput {
  return {
    familyId,
    startDate: { lt: range.end },
    OR: [{ endDate: null, isActive: true }, { endDate: { gte: range.start } }],
  };
}

/**
 * Salary and budget for a month: income (salary + extra income) minus expenses (actual + planned
 * recurring, same totals as the home screen) = what is left.
 */
export async function getIncomeSummary(actor: Actor, month?: string) {
  assertCan(actor, 'VIEW_INCOME');
  if (actor.role === 'CHILD') throw AppError.forbidden();
  const selected = monthOf(actor, month);
  const [year, monthNumber] = selected.split('-').map(Number);
  const range = monthRange(year, monthNumber);

  const [report, salaries, incomes, current] = await Promise.all([
    getMonthlyFinance(actor, selected),
    prisma.recurringIncome.findMany({ where: recurringInMonth(actor.familyId, range), orderBy: { startDate: 'desc' } }),
    prisma.income.findMany({
      where: { familyId: actor.familyId, deletedAt: null, date: { gte: range.start, lt: range.end } },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    }),
    prisma.recurringIncome.findFirst({ where: { familyId: actor.familyId, isActive: true, source: SALARY_SOURCE }, orderBy: { startDate: 'desc' } }),
  ]);

  const currency = report.currency;
  const salaryTotal = salaries.reduce((total, row) => total.plus(row.amount), new Decimal(0));
  const extraTotal = incomes.reduce((total, row) => total.plus(row.amount), new Decimal(0));
  const income = salaryTotal.plus(extraTotal);
  const expenses = new Decimal(report.household.totalAmount).plus(report.homeLessons.totalAmount);
  const remaining = income.minus(expenses);

  return {
    month: selected,
    currency,
    salary: current
      ? { id: current.id, amount: current.amount.toString(), description: current.description, payDay: current.startDate.getUTCDate(), since: formatDateOnly(current.startDate) }
      : null,
    totals: {
      salary: toMoneyString(salaryTotal, currency),
      extraIncome: toMoneyString(extraTotal, currency),
      income: toMoneyString(income, currency),
      expenses: toMoneyString(expenses, currency),
      household: report.household.totalAmount,
      lessons: report.homeLessons.totalAmount,
      remaining: toMoneyString(remaining, currency),
      spentRatio: income.isZero() ? null : Number(expenses.div(income).toDecimalPlaces(4)),
    },
    incomes: incomes.map((row) => ({
      id: row.id,
      amount: row.amount.toString(),
      source: row.source,
      description: row.description,
      date: formatDateOnly(row.date),
      createdBy: row.createdBy,
    })),
  };
}

/**
 * Sets the monthly salary (admin only). A change starts from the current month; earlier months keep
 * the old amount so past balances don't move.
 */
export async function setSalary(actor: Actor, input: { amount: string; payDay: number; description?: string }) {
  assertAdmin(actor);
  const today = localDate(new Date(), actor.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = parseDateOnly(`${today.slice(0, 7)}-${String(Math.min(input.payDay, lastDay)).padStart(2, '0')}`);
  const current = await prisma.recurringIncome.findFirst({ where: { familyId: actor.familyId, isActive: true, source: SALARY_SOURCE } });

  await prisma.$transaction(async (tx) => {
    if (current && formatDateOnly(current.startDate) >= monthStart) {
      // Set this month already: just correct it.
      await tx.recurringIncome.update({ where: { id: current.id }, data: { amount: input.amount, description: input.description ?? null, startDate: start, nextOccurrence: start } });
      return;
    }
    if (current) {
      const endOfLastMonth = new Date(parseDateOnly(monthStart).getTime() - 86_400_000);
      await tx.recurringIncome.update({ where: { id: current.id }, data: { isActive: false, endDate: endOfLastMonth } });
    }
    await tx.recurringIncome.create({
      data: { familyId: actor.familyId, amount: input.amount, source: SALARY_SOURCE, description: input.description ?? null, frequency: 'MONTHLY', startDate: start, nextOccurrence: start },
    });
  });
  return getIncomeSummary(actor);
}

/** Stops the salary from this month on (earlier months keep it). */
export async function removeSalary(actor: Actor) {
  assertAdmin(actor);
  const today = localDate(new Date(), actor.timezone);
  const monthStart = parseDateOnly(`${today.slice(0, 7)}-01`);
  const current = await prisma.recurringIncome.findFirst({ where: { familyId: actor.familyId, isActive: true, source: SALARY_SOURCE } });
  if (!current) throw AppError.notFound('No salary set');
  await prisma.recurringIncome.update({
    where: { id: current.id },
    data: { isActive: false, endDate: current.startDate >= monthStart ? new Date(current.startDate.getTime() - 86_400_000) : new Date(monthStart.getTime() - 86_400_000) },
  });
}
