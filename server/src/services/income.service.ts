import type { Currency, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, monthRange, parseDateOnly } from '../utils/dates';
import { Decimal, toMoneyString } from '../utils/money';
import { localDate } from '../utils/time';
import { assertAdmin, assertCan, type Actor } from './access.service';
import { getMonthlyFinance } from './finance.service';
import { getExchangeRates } from './rates.service';
import { writeCountry } from './country.service';
import { vaultSavedInMonth } from './vault.service';

type DecimalValue = InstanceType<typeof Decimal>;

/**
 * Converts amounts into the family currency with the live USD-based rates. Rates are only fetched
 * when something is actually in another currency.
 */
async function converterTo(target: string, needed: boolean, familyCurrency: string) {
  const rates = needed ? await getExchangeRates() : null;
  return (amount: DecimalValue, stored: string | null) => {
    // A stored null currency means the family currency (which may differ from the selected country's).
    const from = stored ?? familyCurrency;
    if (from === target) return amount;
    const fromRate = rates?.rates[from];
    const toRate = rates?.rates[target];
    if (!fromRate || !toRate) throw new AppError(503, `No exchange rate for ${from} → ${target}`, [], 'RATES_UNAVAILABLE');
    return amount.div(fromRate).mul(toRate).toDecimalPlaces(3);
  };
}

const SALARY_SOURCE = 'salary';

function monthOf(actor: Actor, month?: string) {
  return month ?? localDate(new Date(), actor.timezone).slice(0, 7);
}

/** Income records in the selected country (all countries when none is selected). */
export function incomeCountry(actor: Actor) {
  return actor.countryId ? { countryId: actor.countryId } : {};
}

/** Recurring incomes (the salary) that apply to the month: started by its end, not ended before its start. */
function recurringInMonth(actor: Actor, range: { start: Date; end: Date }): Prisma.RecurringIncomeWhereInput {
  return {
    familyId: actor.familyId,
    ...incomeCountry(actor),
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

  const salaryCountry = await writeCountry(actor);
  const [report, salaries, incomes, current, family] = await Promise.all([
    getMonthlyFinance(actor, selected),
    prisma.recurringIncome.findMany({ where: recurringInMonth(actor, range), orderBy: { startDate: 'desc' } }),
    prisma.income.findMany({
      where: { familyId: actor.familyId, ...incomeCountry(actor), deletedAt: null, date: { gte: range.start, lt: range.end } },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    }),
    // The salary shown and edited: the selected country's (the default country's in the combined view).
    prisma.recurringIncome.findFirst({ where: { familyId: actor.familyId, countryId: salaryCountry.id, isActive: true, source: SALARY_SOURCE }, orderBy: { startDate: 'desc' } }),
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
  ]);

  const currency = report.currency;
  // Salary / income may be paid in another currency (e.g. SAR while the family counts in EGP).
  const foreign = [...salaries, ...incomes].some((row) => (row.currency ?? family.currency) !== currency);
  const toFamily = await converterTo(currency, foreign, family.currency);
  const salaryTotal = salaries.reduce((total, row) => total.plus(toFamily(row.amount, row.currency)), new Decimal(0));
  const extraTotal = incomes.reduce((total, row) => total.plus(toFamily(row.amount, row.currency)), new Decimal(0));
  const income = salaryTotal.plus(extraTotal);
  const expenses = new Decimal(report.totalAmount);
  // Money the viewer moved into their own savings vault this month is not available to spend. Only
  // their own vault counts: nobody else's savings are ever part of what they see.
  const saved = await vaultSavedInMonth(actor.userId, range, currency);
  // Remaining salary = income − expenses (paid payments are expenses) − own savings. This month's payments
  // not paid yet are pending: shown apart, and taken off only once paid.
  const payments = new Decimal(report.payments.amount);
  const remaining = income.minus(expenses).minus(saved);

  return {
    month: selected,
    currency,
    salary: current
      ? {
          id: current.id,
          amount: current.amount.toString(),
          currency: current.currency ?? family.currency,
          // The same salary in the family currency, at today's rate.
          amountInFamilyCurrency: toMoneyString((await converterTo(currency, (current.currency ?? family.currency) !== currency, family.currency))(current.amount, current.currency), currency),
          description: current.description,
          payDay: current.startDate.getUTCDate(),
          since: formatDateOnly(current.startDate),
        }
      : null,
    totals: {
      salary: toMoneyString(salaryTotal, currency),
      extraIncome: toMoneyString(extraTotal, currency),
      income: toMoneyString(income, currency),
      expenses: toMoneyString(expenses, currency),
      household: report.household.totalAmount,
      lessons: report.homeLessons.totalAmount,
      other: report.other.spentAmount,
      payments: report.payments.amount,
      paymentsCount: report.payments.count,
      /** What is left once the pending payments are paid too. */
      afterPending: toMoneyString(remaining.minus(payments), currency),
      /** The same payments in their own currencies (never added together without conversion). */
      paymentsByCurrency: report.payments.byCurrency,
      savedToVault: saved.isZero() ? null : toMoneyString(saved, currency),
      remaining: toMoneyString(remaining, currency),
      spentRatio: income.isZero() ? null : Number(expenses.div(income).toDecimalPlaces(4)),
    },
    incomes: incomes.map((row) => ({
      id: row.id,
      amount: row.amount.toString(),
      currency: row.currency ?? family.currency,
      amountInFamilyCurrency: toMoneyString(toFamily(row.amount, row.currency), currency),
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
export async function setSalary(actor: Actor, input: { amount: string; payDay: number; currency?: Currency; description?: string }) {
  assertAdmin(actor);
  const today = localDate(new Date(), actor.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = parseDateOnly(`${today.slice(0, 7)}-${String(Math.min(input.payDay, lastDay)).padStart(2, '0')}`);
  // Each country has its own salary; the combined view edits the default country's.
  const country = await writeCountry(actor);
  const current = await prisma.recurringIncome.findFirst({ where: { familyId: actor.familyId, countryId: country.id, isActive: true, source: SALARY_SOURCE } });

  await prisma.$transaction(async (tx) => {
    if (current && formatDateOnly(current.startDate) >= monthStart) {
      // Set this month already: just correct it.
      await tx.recurringIncome.update({
        where: { id: current.id },
        data: { amount: input.amount, currency: input.currency ?? null, description: input.description ?? null, startDate: start, nextOccurrence: start },
      });
      return;
    }
    if (current) {
      const endOfLastMonth = new Date(parseDateOnly(monthStart).getTime() - 86_400_000);
      await tx.recurringIncome.update({ where: { id: current.id }, data: { isActive: false, endDate: endOfLastMonth } });
    }
    await tx.recurringIncome.create({
      data: {
        familyId: actor.familyId,
        countryId: country.id,
        amount: input.amount,
        currency: input.currency ?? null,
        source: SALARY_SOURCE,
        description: input.description ?? null,
        frequency: 'MONTHLY',
        startDate: start,
        nextOccurrence: start,
      },
    });
  });
  return getIncomeSummary(actor);
}

/** Stops the salary from this month on (earlier months keep it). */
export async function removeSalary(actor: Actor) {
  assertAdmin(actor);
  const today = localDate(new Date(), actor.timezone);
  const monthStart = parseDateOnly(`${today.slice(0, 7)}-01`);
  const country = await writeCountry(actor);
  const current = await prisma.recurringIncome.findFirst({ where: { familyId: actor.familyId, countryId: country.id, isActive: true, source: SALARY_SOURCE } });
  if (!current) throw AppError.notFound('No salary set');
  // Set this month: it never applied to an earlier month, so it simply goes away.
  if (current.startDate >= monthStart) {
    await prisma.recurringIncome.delete({ where: { id: current.id } });
    return;
  }
  // Set before: earlier months keep it; from this month on there is no salary.
  await prisma.recurringIncome.update({ where: { id: current.id }, data: { isActive: false, endDate: new Date(monthStart.getTime() - 86_400_000) } });
}
