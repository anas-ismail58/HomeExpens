import type { BankEntry, Currency, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, parseDateOnly } from '../utils/dates';
import { Decimal, toMoneyString } from '../utils/money';
import { localDate } from '../utils/time';
import type { Actor } from './access.service';
import { getExchangeRates } from './rates.service';

/**
 * Bank savings: balances the user keeps in bank accounts. Private to the user, tracking only (no bank
 * connection). Balance = opening + deposits − withdrawals + adjustments, per account, in its currency.
 * Deposits and withdrawals are transfers between the user's own money, so they never create income or
 * expenses; savings are shown apart from what is available to spend.
 */
function assertAdult(actor: Actor) {
  if (actor.role === 'CHILD') throw AppError.forbidden('This is for adults');
}

const signed = (entry: Pick<BankEntry, 'kind' | 'amount'>) => (entry.kind === 'WITHDRAW' ? entry.amount.neg() : entry.amount);
const balanceOf = (entries: Pick<BankEntry, 'kind' | 'amount'>[]) => entries.reduce<Prisma.Decimal>((total, entry) => total.plus(signed(entry)), new Decimal(0));

function assertNotNegative(entries: Pick<BankEntry, 'kind' | 'amount'>[]) {
  if (balanceOf(entries).isNegative()) throw new AppError(422, 'The balance would go below zero.', [], 'BANK_INSUFFICIENT');
}

async function ownAccount(actor: Actor, id: string) {
  const account = await prisma.bankAccount.findFirst({ where: { id, userId: actor.userId, deletedAt: null }, include: { entries: true } });
  if (!account) throw AppError.notFound('Account not found');
  return account;
}

async function assertFamilyCountry(actor: Actor, countryId: string | null | undefined) {
  if (!countryId) return;
  const country = await prisma.country.findFirst({ where: { id: countryId, familyId: actor.familyId } });
  if (!country) throw AppError.badRequest('Choose one of the family countries');
}

type AccountRow = { id: string; bankName: string; accountName: string; countryId: string | null; currency: Currency; entries: Pick<BankEntry, 'kind' | 'amount' | 'date'>[] };
function accountDto(account: AccountRow) {
  const last = account.entries.map((e) => formatDateOnly(e.date)).sort().pop() ?? null;
  return {
    id: account.id,
    bankName: account.bankName,
    accountName: account.accountName,
    countryId: account.countryId,
    currency: account.currency,
    balance: toMoneyString(balanceOf(account.entries), account.currency),
    lastDate: last,
  };
}

/** All accounts, totals per currency (never mixed) and an optional total in the family currency. */
export async function listBankAccounts(actor: Actor) {
  assertAdult(actor);
  const [accounts, family] = await Promise.all([
    prisma.bankAccount.findMany({ where: { userId: actor.userId, deletedAt: null }, include: { entries: true }, orderBy: [{ bankName: 'asc' }, { createdAt: 'asc' }] }),
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
  ]);
  const totals = new Map<Currency, Prisma.Decimal>();
  for (const account of accounts) totals.set(account.currency, (totals.get(account.currency) ?? new Decimal(0)).plus(balanceOf(account.entries)));
  const foreign = [...totals.keys()].some((c) => c !== family.currency);
  const rates = foreign ? (await getExchangeRates().catch(() => null))?.rates ?? null : null;
  let combined: Prisma.Decimal | null = new Decimal(0);
  for (const [currency, amount] of totals) {
    if (!combined) break;
    if (currency === family.currency) combined = combined.plus(amount);
    else if (rates?.[currency] && rates[family.currency]) combined = combined.plus(amount.div(rates[currency]).mul(rates[family.currency]));
    else combined = null;
  }
  return {
    accounts: accounts.map(accountDto),
    totals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount: toMoneyString(amount, currency) })),
    combined: totals.size && combined ? { currency: family.currency, amount: toMoneyString(combined, family.currency) } : null,
  };
}

export async function getBankAccount(actor: Actor, id: string) {
  assertAdult(actor);
  const account = await ownAccount(actor, id);
  const entries = [...account.entries].sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
  return {
    ...accountDto(account),
    entries: entries.map((e) => ({ id: e.id, kind: e.kind, amount: e.amount.toString(), source: e.source, note: e.note, date: formatDateOnly(e.date) })),
  };
}

export async function createBankAccount(actor: Actor, input: { bankName: string; accountName: string; countryId?: string | null; currency: Currency; balance?: string }) {
  assertAdult(actor);
  await assertFamilyCountry(actor, input.countryId);
  const account = await prisma.bankAccount.create({
    data: {
      userId: actor.userId,
      bankName: input.bankName,
      accountName: input.accountName,
      countryId: input.countryId ?? null,
      currency: input.currency,
      ...(input.balance && Number(input.balance) > 0
        ? { entries: { create: { kind: 'OPENING', amount: input.balance, date: parseDateOnly(localDate(new Date(), actor.timezone)) } } }
        : {}),
    },
  });
  return getBankAccount(actor, account.id);
}

/** Name, bank and country can change; the currency is fixed once there is history. */
export async function updateBankAccount(actor: Actor, id: string, input: { bankName?: string; accountName?: string; countryId?: string | null; currency?: Currency }) {
  assertAdult(actor);
  const account = await ownAccount(actor, id);
  await assertFamilyCountry(actor, input.countryId);
  if (input.currency && input.currency !== account.currency && account.entries.length) {
    throw new AppError(409, 'The currency can’t change once the account has entries.', [], 'BANK_CURRENCY_LOCKED');
  }
  await prisma.bankAccount.update({ where: { id }, data: { bankName: input.bankName, accountName: input.accountName, countryId: input.countryId, currency: input.currency } });
  return getBankAccount(actor, id);
}

export async function deleteBankAccount(actor: Actor, id: string) {
  assertAdult(actor);
  await ownAccount(actor, id);
  await prisma.bankAccount.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * A deposit or withdrawal, with where the money came from / went: this month's salary (a deposit comes off
 * the remaining salary, a withdrawal adds to it — never as new income), the father's private money (recorded
 * there too) or other (no other balance changes).
 */
export async function addBankEntry(actor: Actor, id: string, input: { kind: 'DEPOSIT' | 'WITHDRAW'; amount: string; note?: string; date?: string; source?: 'SALARY' | 'PRIVATE' | 'OTHER' }) {
  assertAdult(actor);
  const account = await ownAccount(actor, id);
  const amount = new Decimal(input.amount);
  const source = input.source ?? 'OTHER';
  if (source === 'PRIVATE' && actor.role !== 'FATHER') throw AppError.forbidden('Private money is only available to the father');
  assertNotNegative([...account.entries, { kind: input.kind, amount }]);
  const date = parseDateOnly(input.date ?? localDate(new Date(), actor.timezone));
  await prisma.$transaction(async (tx) => {
    let privateEntryId: string | null = null;
    if (source === 'PRIVATE') {
      const family = await tx.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } });
      const value = (await convertTotals(new Map([[account.currency, amount]]), family.currency)) ?? null;
      if (!value) throw new AppError(503, 'Exchange rates are unavailable right now', [], 'RATES_UNAVAILABLE');
      if (input.kind === 'DEPOSIT') {
        const rows = await tx.privateEntry.groupBy({ by: ['direction'], where: { userId: actor.userId }, _sum: { amount: true } });
        const sum = (direction: 'IN' | 'OUT') => rows.find((row) => row.direction === direction)?._sum.amount ?? new Decimal(0);
        if (value.greaterThan(sum('IN').minus(sum('OUT')))) throw new AppError(422, 'Your private money is less than this amount.', [], 'PRIVATE_INSUFFICIENT');
      }
      const label = `${account.bankName}${input.note ? ` — ${input.note}` : ''}`;
      privateEntryId = (await tx.privateEntry.create({ data: { userId: actor.userId, direction: input.kind === 'DEPOSIT' ? 'OUT' : 'IN', amount: value, note: label, date }, select: { id: true } })).id;
    }
    await tx.bankEntry.create({ data: { accountId: id, kind: input.kind, amount, source, privateEntryId, note: input.note || null, date } });
  });
  return getBankAccount(actor, id);
}

async function convertTotals(totals: Map<Currency, Prisma.Decimal>, target: Currency) {
  const needsRates = [...totals.keys()].some((code) => code !== target);
  const rates = needsRates ? (await getExchangeRates().catch(() => null))?.rates ?? null : null;
  let total = new Decimal(0);
  for (const [code, value] of totals) {
    if (code === target) total = total.plus(value);
    else if (rates?.[code] && rates[target]) total = total.plus(value.div(rates[code]).mul(rates[target]));
    else return null;
  }
  return total.toDecimalPlaces(3);
}

/**
 * Bank money that moved with this month's salary for one member: deposits from the salary minus withdrawals
 * to it, in `currency`. Taken off (or, when negative, added to) the remaining salary.
 */
export async function bankSalaryNet(userId: string, range: { start: Date; end: Date }, currency: string) {
  const entries = await prisma.bankEntry.findMany({
    where: { source: 'SALARY', account: { userId, deletedAt: null }, date: { gte: range.start, lt: range.end } },
    select: { kind: true, amount: true, account: { select: { currency: true } } },
  });
  const totals = new Map<Currency, Prisma.Decimal>();
  for (const entry of entries) {
    const signedAmount = entry.kind === 'DEPOSIT' ? entry.amount : entry.amount.neg();
    totals.set(entry.account.currency, (totals.get(entry.account.currency) ?? new Decimal(0)).plus(signedAmount));
  }
  return (await convertTotals(totals, currency as Currency)) ?? new Decimal(0);
}

/** Sets the recorded balance to what the bank shows, with one adjustment entry for the difference. */
export async function setBankBalance(actor: Actor, id: string, input: { balance: string; note?: string }) {
  assertAdult(actor);
  const account = await ownAccount(actor, id);
  const difference = new Decimal(input.balance).minus(balanceOf(account.entries));
  if (!difference.isZero()) {
    await prisma.bankEntry.create({ data: { accountId: id, kind: 'ADJUST', amount: difference, note: input.note || null, date: parseDateOnly(localDate(new Date(), actor.timezone)) } });
  }
  return getBankAccount(actor, id);
}

export async function deleteBankEntry(actor: Actor, entryId: string) {
  assertAdult(actor);
  const entry = await prisma.bankEntry.findFirst({ where: { id: entryId, account: { userId: actor.userId, deletedAt: null } }, include: { account: { include: { entries: true } } } });
  if (!entry) throw AppError.notFound('Entry not found');
  assertNotNegative(entry.account.entries.filter((e) => e.id !== entryId));
  await prisma.$transaction(async (tx) => {
    await tx.bankEntry.delete({ where: { id: entryId } });
    // Its private money entry goes too.
    if (entry.privateEntryId) await tx.privateEntry.deleteMany({ where: { id: entry.privateEntryId } });
  });
  return getBankAccount(actor, entry.accountId);
}
