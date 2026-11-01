import type { Currency, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, parseDateOnly } from '../utils/dates';
import { Decimal } from '../utils/money';
import { localDate } from '../utils/time';
import type { Actor } from './access.service';
import { writeCountry } from './country.service';
import { getIncomeSummary } from './income.service';
import { convertAmount } from './rates.service';

/**
 * Personal money: the father's monthly pot that personal-funded spending comes off. Money moves into it from
 * the salary (here), from bank savings (a bank withdrawal to PERSONAL) or from private money (personal funds
 * income). Moving money between the salary, personal money and savings is never income or an expense.
 */
function assertFather(actor: Actor) {
  if (actor.role !== 'FATHER') throw AppError.forbidden('Personal money is only available to the father');
}

const thisMonth = (actor: Actor) => localDate(new Date(), actor.timezone).slice(0, 7);

/** A move into a month is dated today in the current month, or the 1st of another month. */
const dateIn = (actor: Actor, month: string) => parseDateOnly(month === thisMonth(actor) ? localDate(new Date(), actor.timezone) : `${month}-01`);

/** What is left of that month's salary, in the salary summary's currency. */
async function salaryLeft(actor: Actor, month: string) {
  const summary = await getIncomeSummary(actor, month);
  return { remaining: new Decimal(summary.totals.remaining), currency: summary.currency as Currency };
}

function insufficientSalary(): never {
  throw new AppError(422, 'This is more than what is left of the salary.', [{ field: 'amount', message: 'This is more than what is left of the salary.' }], 'SALARY_INSUFFICIENT');
}

/** Money moved out of a month's salary (to savings or personal money) can't be more than what is left of it. */
export async function assertSalaryCovers(actor: Actor, month: string, amount: Prisma.Decimal, currency: string) {
  const left = await salaryLeft(actor, month);
  const value = currency === left.currency ? amount : await convertAmount(amount, currency, left.currency);
  if (value.greaterThan(left.remaining)) insufficientSalary();
}

/** A bank deposit from the salary is checked against the remaining salary before it is saved. */
export async function checkBankEntry(actor: Actor, accountId: string, input: { kind: 'DEPOSIT' | 'WITHDRAW'; amount: string; source?: string; date?: string }) {
  if (input.kind !== 'DEPOSIT' || input.source !== 'SALARY') return;
  const account = await prisma.bankAccount.findFirst({ where: { id: accountId, userId: actor.userId, deletedAt: null }, select: { currency: true } });
  if (!account) throw AppError.notFound('Account not found');
  await assertSalaryCovers(actor, input.date?.slice(0, 7) ?? thisMonth(actor), new Decimal(input.amount), account.currency);
}

/** Moves money from the chosen month's salary (this month by default) into that month's personal money. */
export async function addSalaryTransfer(actor: Actor, input: { amount: string; note?: string; month?: string }) {
  assertFather(actor);
  const month = input.month ?? thisMonth(actor);
  const amount = new Decimal(input.amount);
  const left = await salaryLeft(actor, month);
  if (amount.greaterThan(left.remaining)) insufficientSalary();
  const country = await writeCountry(actor);
  await prisma.personalTransfer.create({
    data: {
      userId: actor.userId,
      familyId: actor.familyId,
      countryId: country.id,
      amount,
      currency: left.currency,
      note: input.note || null,
      date: dateIn(actor, month),
    },
  });
  return getIncomeSummary(actor, month);
}

async function ownTransfer(actor: Actor, id: string) {
  const transfer = await prisma.personalTransfer.findFirst({ where: { id, userId: actor.userId } });
  if (!transfer) throw AppError.notFound('Transfer not found');
  return transfer;
}

/** A new amount: the salary gets the old amount back and gives the new one (checked against what is left). */
export async function updateSalaryTransfer(actor: Actor, id: string, input: { amount?: string; note?: string }) {
  assertFather(actor);
  const transfer = await ownTransfer(actor, id);
  if (input.amount !== undefined) {
    const amount = new Decimal(input.amount);
    // Checked against the salary of the transfer's own month.
    const left = await getIncomeSummary(actor, formatDateOnly(transfer.date).slice(0, 7));
    const remaining = new Decimal(left.totals.remaining);
    const before = transfer.currency === left.currency ? transfer.amount : await convertAmount(transfer.amount, transfer.currency, left.currency);
    const after = transfer.currency === left.currency ? amount : await convertAmount(amount, transfer.currency, left.currency);
    if (after.minus(before).greaterThan(remaining)) insufficientSalary();
    await prisma.personalTransfer.update({ where: { id }, data: { amount, ...(input.note !== undefined ? { note: input.note || null } : {}) } });
  } else if (input.note !== undefined) {
    await prisma.personalTransfer.update({ where: { id }, data: { note: input.note || null } });
  }
  return getIncomeSummary(actor, formatDateOnly(transfer.date).slice(0, 7));
}

/** Removed: the money goes back to that month's salary and leaves personal money. */
export async function deleteSalaryTransfer(actor: Actor, id: string) {
  assertFather(actor);
  const transfer = await ownTransfer(actor, id);
  await prisma.personalTransfer.delete({ where: { id } });
  return getIncomeSummary(actor, formatDateOnly(transfer.date).slice(0, 7));
}

/** Sets the chosen month's personal money limit (and the months after it); earlier months keep theirs. */
export async function setPersonalLimit(actor: Actor, input: { amount: string; currency?: Currency; month?: string }) {
  assertFather(actor);
  const family = await prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } });
  const chosen = input.month ?? thisMonth(actor);
  const month = parseDateOnly(`${chosen}-01`);
  const data = { amount: input.amount, currency: input.currency ?? family.currency };
  await prisma.personalLimit.upsert({ where: { userId_month: { userId: actor.userId, month } }, create: { userId: actor.userId, month, ...data }, update: data });
  return getIncomeSummary(actor, chosen);
}
