import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, monthRange, parseDateOnly } from '../utils/dates';
import { Decimal, toMoneyString } from '../utils/money';
import { localDate } from '../utils/time';
import type { Actor } from './access.service';

/**
 * The father's private money. Every query is keyed on the caller's own userId — there is no way
 * (role, permission, family admin) to read another user's entries, and nothing here feeds family
 * totals, reports, notifications or the dashboard.
 */
function assertFather(actor: Actor) {
  if (actor.role !== 'FATHER') throw AppError.forbidden('Private money is only available to the father');
}

export async function getPrivateSummary(actor: Actor, month?: string) {
  assertFather(actor);
  const selected = month ?? localDate(new Date(), actor.timezone).slice(0, 7);
  const [year, monthNumber] = selected.split('-').map(Number);
  const range = monthRange(year, monthNumber);
  const own = { userId: actor.userId };

  const [totals, monthTotals, entries, family] = await Promise.all([
    prisma.privateEntry.groupBy({ by: ['direction'], where: own, _sum: { amount: true } }),
    prisma.privateEntry.groupBy({ by: ['direction'], where: { ...own, date: { gte: range.start, lt: range.end } }, _sum: { amount: true } }),
    prisma.privateEntry.findMany({ where: { ...own, date: { gte: range.start, lt: range.end } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
  ]);
  const sum = (rows: typeof totals, direction: 'IN' | 'OUT') => rows.find((row) => row.direction === direction)?._sum.amount ?? new Decimal(0);
  const balance = sum(totals, 'IN').minus(sum(totals, 'OUT'));

  return {
    month: selected,
    currency: family.currency,
    balance: toMoneyString(balance, family.currency),
    monthIn: toMoneyString(sum(monthTotals, 'IN'), family.currency),
    monthOut: toMoneyString(sum(monthTotals, 'OUT'), family.currency),
    entries: entries.map((entry) => ({
      id: entry.id,
      direction: entry.direction,
      amount: entry.amount.toString(),
      note: entry.note,
      date: formatDateOnly(entry.date),
    })),
  };
}

export async function addPrivateEntry(actor: Actor, input: { direction: 'IN' | 'OUT'; amount: string; note?: string; date?: string }) {
  assertFather(actor);
  await prisma.privateEntry.create({
    data: {
      userId: actor.userId,
      direction: input.direction,
      amount: input.amount,
      note: input.note || null,
      date: parseDateOnly(input.date ?? localDate(new Date(), actor.timezone)),
    },
  });
  return getPrivateSummary(actor, (input.date ?? localDate(new Date(), actor.timezone)).slice(0, 7));
}

export async function deletePrivateEntry(actor: Actor, id: string) {
  assertFather(actor);
  const { count } = await prisma.privateEntry.deleteMany({ where: { id, userId: actor.userId } });
  if (!count) throw AppError.notFound('Entry not found');
}
