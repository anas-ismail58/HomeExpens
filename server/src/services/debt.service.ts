import type { Currency, DebtEntry, DebtKind, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, parseDateOnly } from '../utils/dates';
import { Decimal, toMoneyString } from '../utils/money';
import { addDays, localDate, zonedToUtc } from '../utils/time';
import type { Actor } from './access.service';
import { ledgerPricing, writeCountry } from './country.service';
import { notifyUsers } from './notification.service';
import { getExchangeRates } from './rates.service';

/**
 * Pay to other wallet: money between the user and other people (lent, borrowed, paid back). Private to the
 * user who records it — no role or permission reaches another member's records. Balances are computed from
 * the entries, per currency: owed to me = lent − received; I owe = borrowed − paid. A repayment can't be
 * more than what is outstanding, so balances never go below zero.
 */
export type EntryInput = {
  kind: DebtKind;
  amount: string;
  currency: Currency;
  note?: string;
  date?: string;
  dueDate?: string | null;
  /** Remind N days before the due date, at HH:MM (lend / borrow with a due date). */
  remind?: { daysBefore: number; time: string } | null;
  /** A payment (PAY) also recorded as a family expense. */
  recordExpense?: boolean;
};

type Balance = { owedToMe: Prisma.Decimal; iOwe: Prisma.Decimal };
const ZERO = () => new Decimal(0);

function assertAdult(actor: Actor) {
  if (actor.role === 'CHILD') throw AppError.forbidden('This is for adults');
}

function balancesOf(entries: Pick<DebtEntry, 'kind' | 'amount' | 'currency'>[]) {
  const map = new Map<Currency, Balance>();
  for (const entry of entries) {
    const row = map.get(entry.currency) ?? { owedToMe: ZERO(), iOwe: ZERO() };
    if (entry.kind === 'LEND') row.owedToMe = row.owedToMe.plus(entry.amount);
    if (entry.kind === 'RECEIVE') row.owedToMe = row.owedToMe.minus(entry.amount);
    if (entry.kind === 'BORROW') row.iOwe = row.iOwe.plus(entry.amount);
    if (entry.kind === 'PAY') row.iOwe = row.iOwe.minus(entry.amount);
    map.set(entry.currency, row);
  }
  return map;
}

/** Balances must stay ≥ 0: nobody repays more than was lent or borrowed. */
function assertValid(entries: Pick<DebtEntry, 'kind' | 'amount' | 'currency'>[]) {
  for (const [, row] of balancesOf(entries)) {
    if (row.owedToMe.isNegative()) throw new AppError(422, 'That is more than this person owes you in this currency.', [], 'DEBT_OVERPAID');
    if (row.iOwe.isNegative()) throw new AppError(422, 'That is more than you owe this person in this currency.', [], 'DEBT_OVERPAID');
  }
}

function balanceDto(map: Map<Currency, Balance>) {
  return [...map.entries()]
    .map(([currency, row]) => ({
      currency,
      owedToMe: toMoneyString(row.owedToMe, currency),
      iOwe: toMoneyString(row.iOwe, currency),
      net: toMoneyString(row.owedToMe.minus(row.iOwe), currency),
    }))
    .filter((row) => Number(row.owedToMe) !== 0 || Number(row.iOwe) !== 0);
}

function entryDto(entry: DebtEntry) {
  return {
    id: entry.id,
    kind: entry.kind,
    amount: entry.amount.toString(),
    currency: entry.currency,
    note: entry.note,
    date: formatDateOnly(entry.date),
    dueDate: entry.dueDate ? formatDateOnly(entry.dueDate) : null,
    reminderAt: entry.reminderAt?.toISOString() ?? null,
    expenseId: entry.expenseId,
  };
}

async function ownContact(actor: Actor, id: string) {
  const contact = await prisma.debtContact.findFirst({ where: { id, userId: actor.userId, deletedAt: null } });
  if (!contact) throw AppError.notFound('Person not found');
  return contact;
}

/** Everyone the user deals with, their balances per currency, and the totals (per currency, never mixed). */
export async function listDebts(actor: Actor) {
  assertAdult(actor);
  const [contacts, family] = await Promise.all([
    prisma.debtContact.findMany({ where: { userId: actor.userId, deletedAt: null }, include: { entries: true }, orderBy: { name: 'asc' } }),
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
  ]);
  const totals = new Map<Currency, Balance>();
  const people = contacts.map((contact) => {
    const balances = balancesOf(contact.entries);
    for (const [currency, row] of balances) {
      const total = totals.get(currency) ?? { owedToMe: ZERO(), iOwe: ZERO() };
      totals.set(currency, { owedToMe: total.owedToMe.plus(row.owedToMe), iOwe: total.iOwe.plus(row.iOwe) });
    }
    const today = formatDateOnly(new Date());
    const nextDue = contact.entries
      .filter((e) => e.dueDate && (e.kind === 'LEND' || e.kind === 'BORROW') && formatDateOnly(e.dueDate) >= today)
      .map((e) => formatDateOnly(e.dueDate!))
      .sort()[0] ?? null;
    const last = contact.entries.map((e) => formatDateOnly(e.date)).sort().pop() ?? null;
    return { id: contact.id, name: contact.name, phone: contact.phone, notes: contact.notes, balances: balanceDto(balances), nextDue, lastDate: last };
  });

  // An optional combined figure in the family currency, converted at today's rates (null if a rate is missing).
  let combined: { currency: Currency; owedToMe: string; iOwe: string; net: string } | null = null;
  if (totals.size) {
    const foreign = [...totals.keys()].some((c) => c !== family.currency);
    const rates = foreign ? (await getExchangeRates().catch(() => null))?.rates ?? null : null;
    let owed = ZERO();
    let owe = ZERO();
    let ok = true;
    for (const [currency, row] of totals) {
      const factor = currency === family.currency ? new Decimal(1) : rates?.[currency] && rates[family.currency] ? new Decimal(rates[family.currency]).div(rates[currency]) : null;
      if (!factor) {
        ok = false;
        break;
      }
      owed = owed.plus(row.owedToMe.mul(factor));
      owe = owe.plus(row.iOwe.mul(factor));
    }
    if (ok) combined = { currency: family.currency, owedToMe: toMoneyString(owed, family.currency), iOwe: toMoneyString(owe, family.currency), net: toMoneyString(owed.minus(owe), family.currency) };
  }
  return { totals: balanceDto(totals), combined, people };
}

export async function createContact(actor: Actor, input: { name: string; phone?: string; notes?: string }) {
  assertAdult(actor);
  const contact = await prisma.debtContact.create({ data: { userId: actor.userId, name: input.name, phone: input.phone || null, notes: input.notes || null } });
  return getContact(actor, contact.id);
}

export async function updateContact(actor: Actor, id: string, input: { name?: string; phone?: string | null; notes?: string | null }) {
  assertAdult(actor);
  await ownContact(actor, id);
  await prisma.debtContact.update({ where: { id }, data: { name: input.name, phone: input.phone === undefined ? undefined : input.phone || null, notes: input.notes === undefined ? undefined : input.notes || null } });
  return getContact(actor, id);
}

/** Removes the person and their history (linked family expenses stay). */
export async function deleteContact(actor: Actor, id: string) {
  assertAdult(actor);
  await ownContact(actor, id);
  await prisma.debtContact.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function getContact(actor: Actor, id: string) {
  assertAdult(actor);
  const contact = await ownContact(actor, id);
  const entries = await prisma.debtEntry.findMany({ where: { contactId: id, userId: actor.userId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
  return { id: contact.id, name: contact.name, phone: contact.phone, notes: contact.notes, balances: balanceDto(balancesOf(entries)), entries: entries.map(entryDto) };
}

function reminderAt(actor: Actor, input: Pick<EntryInput, 'kind' | 'dueDate' | 'remind'>) {
  if (!input.remind || !input.dueDate || (input.kind !== 'LEND' && input.kind !== 'BORROW')) return null;
  return zonedToUtc(addDays(input.dueDate, -input.remind.daysBefore), input.remind.time, actor.timezone);
}

/** A payment recorded as a family expense too (household spending of the selected country). */
async function paymentExpense(actor: Actor, contactName: string, input: EntryInput, date: Date) {
  const [family, category, country] = await Promise.all([
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
    prisma.category.findFirst({ where: { familyId: actor.familyId, key: 'household', isActive: true } }),
    writeCountry(actor),
  ]);
  if (!category) throw AppError.notFound('Household category is unavailable');
  const price = await ledgerPricing(family, country, input.amount, input.currency);
  const expense = await prisma.expense.create({
    data: {
      familyId: actor.familyId,
      countryId: country.id,
      ownerType: 'HOUSEHOLD',
      categoryId: category.id,
      amount: input.amount,
      ...price,
      description: input.note || contactName,
      notes: `سداد: ${contactName}`,
      date,
      occurredAt: new Date(),
      createdById: actor.userId,
    },
    select: { id: true },
  });
  return expense.id;
}

export async function addEntry(actor: Actor, contactId: string, input: EntryInput) {
  assertAdult(actor);
  const contact = await ownContact(actor, contactId);
  const existing = await prisma.debtEntry.findMany({ where: { contactId, userId: actor.userId }, select: { kind: true, amount: true, currency: true } });
  assertValid([...existing, { kind: input.kind, amount: new Decimal(input.amount), currency: input.currency }]);
  const date = parseDateOnly(input.date ?? localDate(new Date(), actor.timezone));
  const expenseId = input.kind === 'PAY' && input.recordExpense ? await paymentExpense(actor, contact.name, input, date) : null;
  await prisma.debtEntry.create({
    data: {
      userId: actor.userId,
      contactId,
      kind: input.kind,
      amount: input.amount,
      currency: input.currency,
      note: input.note || null,
      date,
      dueDate: input.dueDate && (input.kind === 'LEND' || input.kind === 'BORROW') ? parseDateOnly(input.dueDate) : null,
      reminderAt: reminderAt(actor, input),
      expenseId,
    },
  });
  return getContact(actor, contactId);
}

/** Edits an entry; balances are recomputed and must stay valid. A linked expense follows the amount. */
export async function updateEntry(actor: Actor, id: string, input: EntryInput) {
  assertAdult(actor);
  const entry = await prisma.debtEntry.findFirst({ where: { id, userId: actor.userId }, include: { contact: true } });
  if (!entry || entry.contact.deletedAt) throw AppError.notFound('Entry not found');
  const others = await prisma.debtEntry.findMany({ where: { contactId: entry.contactId, userId: actor.userId, id: { not: id } }, select: { kind: true, amount: true, currency: true } });
  assertValid([...others, { kind: input.kind, amount: new Decimal(input.amount), currency: input.currency }]);
  const date = input.date ? parseDateOnly(input.date) : entry.date;
  let expenseId = entry.expenseId;
  if (expenseId && (input.kind !== 'PAY' || input.recordExpense === false)) {
    await prisma.expense.updateMany({ where: { id: expenseId, familyId: actor.familyId }, data: { deletedAt: new Date() } });
    expenseId = null;
  } else if (expenseId) {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } });
    const linked = await prisma.expense.findFirst({ where: { id: expenseId, familyId: actor.familyId }, select: { countryId: true } });
    const country = linked?.countryId ? await prisma.country.findFirst({ where: { id: linked.countryId } }) : null;
    const price = await ledgerPricing(family, country ?? (await writeCountry(actor)), input.amount, input.currency);
    await prisma.expense.updateMany({ where: { id: expenseId, familyId: actor.familyId }, data: { amount: input.amount, ...price, date } });
  } else if (input.kind === 'PAY' && input.recordExpense) {
    expenseId = await paymentExpense(actor, entry.contact.name, input, date);
  }
  const dueDate = input.dueDate === undefined ? (entry.dueDate ? formatDateOnly(entry.dueDate) : null) : input.dueDate;
  await prisma.debtEntry.update({
    where: { id },
    data: {
      kind: input.kind,
      amount: input.amount,
      currency: input.currency,
      note: input.note === undefined ? entry.note : input.note || null,
      date,
      dueDate: dueDate && (input.kind === 'LEND' || input.kind === 'BORROW') ? parseDateOnly(dueDate) : null,
      ...(input.remind !== undefined ? { reminderAt: reminderAt(actor, { ...input, dueDate }), remindedAt: null } : {}),
      expenseId,
    },
  });
  return getContact(actor, entry.contactId);
}

export async function deleteEntry(actor: Actor, id: string) {
  assertAdult(actor);
  const entry = await prisma.debtEntry.findFirst({ where: { id, userId: actor.userId } });
  if (!entry) throw AppError.notFound('Entry not found');
  const others = await prisma.debtEntry.findMany({ where: { contactId: entry.contactId, userId: actor.userId, id: { not: id } }, select: { kind: true, amount: true, currency: true } });
  // Removing a loan that was already (partly) repaid would leave a negative balance.
  assertValid(others);
  if (entry.expenseId) await prisma.expense.updateMany({ where: { id: entry.expenseId, familyId: actor.familyId }, data: { deletedAt: new Date() } });
  await prisma.debtEntry.delete({ where: { id } });
  return getContact(actor, entry.contactId);
}

/** Sends due debt reminders (once each) to their owner only. */
export async function processDebtReminders(now: Date, familyId?: string) {
  const due = await prisma.debtEntry.findMany({
    where: { reminderAt: { lte: now }, remindedAt: null, contact: { deletedAt: null }, ...(familyId ? { user: { familyId } } : {}) },
    include: { contact: { select: { id: true, name: true } }, user: { select: { familyId: true } } },
    take: 100,
  });
  for (const entry of due) {
    const claimed = await prisma.debtEntry.updateMany({ where: { id: entry.id, remindedAt: null }, data: { remindedAt: now } });
    if (!claimed.count || !entry.user.familyId) continue;
    const amount = `${Number(entry.amount).toLocaleString('en-US')} ${entry.currency}`;
    await notifyUsers([entry.userId], {
      familyId: entry.user.familyId,
      type: 'DEBT_REMINDER',
      title: entry.kind === 'LEND' ? `موعد استرداد ${amount} من ${entry.contact.name}` : `موعد سداد ${amount} إلى ${entry.contact.name}`,
      message: entry.dueDate ? `الاستحقاق ${formatDateOnly(entry.dueDate)}` : '',
      relatedEntityId: entry.contact.id,
    }).catch(() => undefined);
  }
  return due.length;
}
