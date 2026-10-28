import type { Currency, IncomeKind, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, monthRange, parseDateOnly } from '../utils/dates';
import { Decimal, toMoneyString } from '../utils/money';
import { localDate } from '../utils/time';
import { assertAdmin, assertCan, type Actor } from './access.service';
import { getMonthlyFinance } from './finance.service';
import { getExchangeRates } from './rates.service';
import { writeCountry } from './country.service';
import { debtSalaryNet } from './debt.service';
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
  // Money in, by kind. Only the salary (and income recorded as salary) is salary; personal funds, household
  // contributions, money from others and borrowed money add to the available budget instead.
  const byKind = (kind: IncomeKind) => incomes.filter((row) => row.kind === kind).reduce((total, row) => total.plus(toFamily(row.amount, row.currency)), new Decimal(0));
  const salaryTotal = salaries.reduce((total, row) => total.plus(toFamily(row.amount, row.currency)), new Decimal(0)).plus(byKind('SALARY'));
  const personal = byKind('PERSONAL');
  const householdIn = byKind('HOUSEHOLD');
  const fromOthers = byKind('FROM_PERSON');
  const borrowed = byKind('BORROWED');
  const otherIncome = byKind('OTHER');
  const extraTotal = personal.plus(householdIn).plus(fromOthers).plus(borrowed).plus(otherIncome);
  const available = salaryTotal.plus(extraTotal);
  const expenses = new Decimal(report.totalAmount);
  // Money the viewer moved from this month's salary into their own savings vault. Only their own vault
  // counts: nobody else's savings are ever part of what they see.
  const saved = await vaultSavedInMonth(actor.userId, range, currency);
  const payments = new Decimal(report.payments.amount);
  // Remaining salary = salary − what the salary paid for (salary-funded expenses, paid payments included)
  // − savings taken from it. Pending payments are shown apart and come off once paid.
  const salaryFunded = new Decimal(report.funding.salary);
  // Pay to Other Wallet: money the viewer lent or paid back from the salary, minus repayments back to it.
  const debtsFromSalary = await debtSalaryNet(actor.userId, range, currency);
  const remaining = salaryTotal.minus(salaryFunded).minus(saved).minus(debtsFromSalary);
  // Remaining available budget = all money in − all expenses − what is still to pay − savings and loans from the salary.
  const remainingAvailable = available.minus(expenses).minus(payments).minus(saved).minus(debtsFromSalary);

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
      /** The salary (what "income" means on the salary card). */
      income: toMoneyString(salaryTotal, currency),
      personalFunds: toMoneyString(personal, currency),
      householdContributions: toMoneyString(householdIn, currency),
      fromOthers: toMoneyString(fromOthers, currency),
      borrowed: toMoneyString(borrowed, currency),
      otherIncome: toMoneyString(otherIncome, currency),
      /** Everything that came in this month. */
      totalAvailable: toMoneyString(available, currency),
      /** The month's spending by who paid for it. */
      fundedBy: report.funding,
      remainingAvailable: toMoneyString(remainingAvailable, currency),
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
      /** Net money that went from the salary to other people (lent / paid back) less repayments back to it. */
      debtsFromSalary: debtsFromSalary.isZero() ? null : toMoneyString(debtsFromSalary, currency),
      remaining: toMoneyString(remaining, currency),
      spentRatio: salaryTotal.isZero() ? null : Number(salaryFunded.div(salaryTotal).toDecimalPlaces(4)),
    },
    incomes: incomes.map((row) => ({
      id: row.id,
      amount: row.amount.toString(),
      currency: row.currency ?? family.currency,
      amountInFamilyCurrency: toMoneyString(toFamily(row.amount, row.currency), currency),
      source: row.source,
      kind: row.kind,
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

/**
 * Adds money that came in (admin only). Its kind says what it is: salary, personal funds (moved out of the
 * owner's private money, so it isn't counted twice), a household contribution, money from another person,
 * borrowed money (also "I borrowed" in Pay to Other Wallet, so it is owed back, not income) or other.
 */
export async function addIncome(
  actor: Actor,
  input: { amount: string; currency?: Currency; source: string; kind?: IncomeKind; date: string; description?: string; contactId?: string; contactName?: string },
) {
  assertAdmin(actor);
  const kind = input.kind ?? 'OTHER';
  const country = await writeCountry(actor);
  const family = await prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } });
  const currency = input.currency ?? family.currency;

  let privateEntryId: string | null = null;
  let debtEntryId: string | null = null;
  if (kind === 'PERSONAL') {
    if (actor.role !== 'FATHER') throw AppError.forbidden('Personal funds come from the father\'s private money');
    const value = (await converterTo(family.currency, currency !== family.currency, family.currency))(new Decimal(input.amount), currency);
    const entry = await prisma.privateEntry.create({
      data: { userId: actor.userId, direction: 'OUT', amount: value, note: input.description ? `للبيت: ${input.description}` : 'للبيت', date: parseDateOnly(input.date) },
      select: { id: true },
    });
    privateEntryId = entry.id;
  }
  if (kind === 'BORROWED') {
    let contactId = input.contactId ?? null;
    if (contactId) {
      const own = await prisma.debtContact.findFirst({ where: { id: contactId, userId: actor.userId, deletedAt: null }, select: { id: true } });
      if (!own) throw AppError.notFound('Person not found');
    } else {
      const name = (input.contactName ?? input.source).trim();
      const existing = await prisma.debtContact.findFirst({ where: { userId: actor.userId, deletedAt: null, name }, select: { id: true } });
      contactId = existing?.id ?? (await prisma.debtContact.create({ data: { userId: actor.userId, name }, select: { id: true } })).id;
    }
    const entry = await prisma.debtEntry.create({
      data: { userId: actor.userId, contactId, kind: 'BORROW', amount: input.amount, currency, note: input.description || null, date: parseDateOnly(input.date), account: 'BUDGET' },
      select: { id: true },
    });
    debtEntryId = entry.id;
  }
  return prisma.income.create({
    data: {
      familyId: actor.familyId,
      countryId: country.id,
      amount: input.amount,
      currency: input.currency ?? null,
      source: input.source,
      kind,
      privateEntryId,
      debtEntryId,
      description: input.description,
      date: parseDateOnly(input.date),
      createdById: actor.userId,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  });
}

/** Removes money that came in, with the private money or loan entry made with it. */
export async function deleteIncome(actor: Actor, id: string) {
  assertAdmin(actor);
  const income = await prisma.income.findFirst({ where: { id, familyId: actor.familyId, deletedAt: null } });
  if (!income) throw AppError.notFound('Income not found');
  if (income.debtEntryId) {
    const entry = await prisma.debtEntry.findUnique({ where: { id: income.debtEntryId } });
    if (entry) {
      const others = await prisma.debtEntry.findMany({ where: { contactId: entry.contactId, id: { not: entry.id } }, select: { kind: true, amount: true, currency: true } });
      const owed = others.filter((e) => e.currency === entry.currency).reduce((t, e) => (e.kind === 'BORROW' ? t.plus(e.amount) : e.kind === 'PAY' ? t.minus(e.amount) : t), new Decimal(0));
      if (owed.isNegative()) throw new AppError(409, 'This loan was already (partly) paid back. Remove the repayments first.', [], 'DEBT_REPAID');
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.income.update({ where: { id }, data: { deletedAt: new Date(), privateEntryId: null, debtEntryId: null } });
    if (income.privateEntryId) await tx.privateEntry.deleteMany({ where: { id: income.privateEntryId } });
    if (income.debtEntryId) await tx.debtEntry.deleteMany({ where: { id: income.debtEntryId } });
  });
}
