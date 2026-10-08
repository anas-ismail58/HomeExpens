import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, parseDateOnly } from '../utils/dates';
import { Decimal, toMoneyString } from '../utils/money';
import { localDate } from '../utils/time';
import { assertAdmin, type Actor } from './access.service';
import { notifyUsers } from './notification.service';

const person = { select: { id: true, name: true } } as const;
const include = {
  holder: person,
  spenders: { include: { user: person } },
  entries: { select: { type: true, amount: true } },
} satisfies Prisma.WalletInclude;
type WalletRow = Prisma.WalletGetPayload<{ include: typeof include }>;

function balanceOf(entries: { type: string; amount: Prisma.Decimal }[]) {
  return entries.reduce((total, e) => (e.type === 'TOPUP' ? total.plus(e.amount) : total.minus(e.amount)), new Decimal(0));
}

/** Who may see a wallet: the admin, the person holding it, and anyone allowed to deduct from it. */
function canSee(actor: Actor, wallet: WalletRow) {
  return actor.isAdmin || wallet.holderId === actor.userId || wallet.spenders.some((s) => s.userId === actor.userId);
}

/** Who may deduct: the admin, or a member the admin chose. */
function canSpend(actor: Actor, wallet: WalletRow) {
  return actor.isAdmin || wallet.spenders.some((s) => s.userId === actor.userId);
}

async function familyCurrency(familyId: string) {
  return (await prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { currency: true } })).currency;
}

function walletDto(actor: Actor, wallet: WalletRow, currency: string) {
  const added = wallet.entries.filter((e) => e.type === 'TOPUP').reduce((t, e) => t.plus(e.amount), new Decimal(0));
  const spent = wallet.entries.filter((e) => e.type === 'SPEND').reduce((t, e) => t.plus(e.amount), new Decimal(0));
  return {
    id: wallet.id,
    name: wallet.name,
    currency,
    holder: wallet.holder,
    spenders: wallet.spenders.map((s) => s.user),
    added: toMoneyString(added, currency),
    spent: toMoneyString(spent, currency),
    balance: toMoneyString(added.minus(spent), currency),
    canSpend: canSpend(actor, wallet),
    canManage: actor.isAdmin,
    createdAt: wallet.createdAt.toISOString(),
  };
}

async function visibleWallet(actor: Actor, id: string) {
  const wallet = await prisma.wallet.findFirst({ where: { id, familyId: actor.familyId, isActive: true }, include });
  // Another family's wallet, or one this member may not see, looks like it doesn't exist.
  if (!wallet || !canSee(actor, wallet)) throw AppError.notFound('Allowance not found');
  return wallet;
}

/** Only real, active members of this family can hold or spend from a wallet. */
async function assertFamilyUsers(familyId: string, userIds: string[]) {
  const unique = [...new Set(userIds)];
  const count = await prisma.user.count({ where: { id: { in: unique }, familyId, isActive: true } });
  if (count !== unique.length) throw AppError.badRequest('Choose people from your family');
}

export async function listWallets(actor: Actor) {
  const [rows, currency] = await Promise.all([
    prisma.wallet.findMany({ where: { familyId: actor.familyId, isActive: true }, include, orderBy: { createdAt: 'asc' } }),
    familyCurrency(actor.familyId),
  ]);
  return rows.filter((w) => canSee(actor, w)).map((w) => walletDto(actor, w, currency));
}

export async function getWallet(actor: Actor, id: string) {
  const wallet = await visibleWallet(actor, id);
  const [entries, currency] = await Promise.all([
    prisma.walletEntry.findMany({ where: { walletId: id }, include: { createdBy: person }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 300 }),
    familyCurrency(actor.familyId),
  ]);
  return {
    ...walletDto(actor, wallet, currency),
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount.toString(),
      note: e.note,
      date: formatDateOnly(e.date),
      createdBy: e.createdBy,
      createdAt: e.createdAt.toISOString(),
      // The admin can undo anything; others only what they added themselves.
      canDelete: actor.isAdmin || e.createdById === actor.userId,
    })),
  };
}

export async function createWallet(actor: Actor, input: { name: string; holderId: string; amount?: string; spenderIds?: string[]; note?: string }) {
  assertAdmin(actor);
  const spenderIds = input.spenderIds?.length ? input.spenderIds : [input.holderId];
  await assertFamilyUsers(actor.familyId, [input.holderId, ...spenderIds]);
  const wallet = await prisma.wallet.create({
    data: {
      familyId: actor.familyId,
      name: input.name,
      holderId: input.holderId,
      createdById: actor.userId,
      spenders: { create: [...new Set(spenderIds)].map((userId) => ({ userId })) },
      ...(input.amount && Number(input.amount) > 0
        ? { entries: { create: { type: 'TOPUP' as const, amount: input.amount, note: input.note ?? null, date: parseDateOnly(localDate(new Date(), actor.timezone)), createdById: actor.userId } } }
        : {}),
    },
  });
  if (input.amount && Number(input.amount) > 0 && input.holderId !== actor.userId) await notifyTopUp(actor, wallet.id, input.holderId, input.name, input.amount);
  return getWallet(actor, wallet.id);
}

export async function updateWallet(actor: Actor, id: string, input: { name?: string; holderId?: string; spenderIds?: string[] }) {
  assertAdmin(actor);
  await visibleWallet(actor, id);
  await assertFamilyUsers(actor.familyId, [...(input.holderId ? [input.holderId] : []), ...(input.spenderIds ?? [])]);
  await prisma.$transaction(async (tx) => {
    await tx.wallet.update({ where: { id }, data: { name: input.name, holderId: input.holderId } });
    if (input.spenderIds) {
      await tx.walletSpender.deleteMany({ where: { walletId: id } });
      await tx.walletSpender.createMany({ data: [...new Set(input.spenderIds)].map((userId) => ({ walletId: id, userId })) });
    }
  });
  return getWallet(actor, id);
}

/** Closes the allowance; its spending stays in the family's expenses. */
export async function deleteWallet(actor: Actor, id: string) {
  assertAdmin(actor);
  await visibleWallet(actor, id);
  await prisma.wallet.update({ where: { id }, data: { isActive: false } });
}

async function notifyTopUp(actor: Actor, walletId: string, holderId: string, name: string, amount: string) {
  const currency = await familyCurrency(actor.familyId);
  await notifyUsers([holderId], {
    familyId: actor.familyId,
    type: 'FAMILY_EVENT',
    title: 'تمت إضافة مبلغ إلى عهدتك',
    message: `«${name}»: +${Number(amount).toLocaleString('en-US')} ${currency}`,
    relatedEntityId: walletId,
  });
}

export async function topUpWallet(actor: Actor, id: string, input: { amount: string; note?: string }) {
  assertAdmin(actor);
  const wallet = await visibleWallet(actor, id);
  await prisma.walletEntry.create({
    data: { walletId: id, type: 'TOPUP', amount: input.amount, note: input.note ?? null, date: parseDateOnly(localDate(new Date(), actor.timezone)), createdById: actor.userId },
  });
  if (wallet.holderId !== actor.userId) await notifyTopUp(actor, id, wallet.holderId, wallet.name, input.amount);
  return getWallet(actor, id);
}

/**
 * Deducts from the allowance. The money is also recorded as an expense (household by default, or the
 * chosen household section) so the month's spending and the remaining salary include it.
 */
export async function spendFromWallet(actor: Actor, id: string, input: { amount: string; note?: string; sectionKey?: string }) {
  const wallet = await visibleWallet(actor, id);
  if (!canSpend(actor, wallet)) throw AppError.forbidden('You are not allowed to deduct from this allowance');
  const amount = new Decimal(input.amount);
  if (amount.greaterThan(balanceOf(wallet.entries))) throw new AppError(409, 'The allowance balance is not enough', [], 'INSUFFICIENT_BALANCE');

  const category = await prisma.category.findFirst({ where: { familyId: actor.familyId, key: 'household', isActive: true } });
  if (!category) throw AppError.notFound('Household category is unavailable');
  const section = input.sectionKey ? await prisma.subcategory.findFirst({ where: { categoryId: category.id, key: input.sectionKey, isActive: true } }) : null;
  const date = parseDateOnly(localDate(new Date(), actor.timezone));

  await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        familyId: actor.familyId,
        ownerType: actor.role === 'CHILD' && actor.memberId ? 'CHILD' : 'HOUSEHOLD',
        memberId: actor.role === 'CHILD' ? actor.memberId : null,
        categoryId: category.id,
        subcategoryId: section?.id ?? null,
        amount,
        description: input.note || wallet.name,
        notes: `عهدة: ${wallet.name}`,
        date,
        occurredAt: new Date(),
        createdById: actor.userId,
      },
    });
    await tx.walletEntry.create({ data: { walletId: id, type: 'SPEND', amount, note: input.note ?? null, date, createdById: actor.userId, expenseId: expense.id } });
  });

  // Let the father know when someone else spends from it.
  if (!actor.isAdmin) {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { ownerId: true, currency: true } });
    const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true } });
    await notifyUsers([family.ownerId], {
      familyId: actor.familyId,
      type: 'FAMILY_EVENT',
      title: `صرف من العهدة «${wallet.name}»`,
      message: `${me.name}: −${amount.toNumber().toLocaleString('en-US')} ${family.currency}${input.note ? ` — ${input.note}` : ''}`,
      relatedEntityId: id,
    });
  }
  return getWallet(actor, id);
}

/** Undo an entry. A deduction's expense is removed too, so the totals go back. */
export async function deleteWalletEntry(actor: Actor, walletId: string, entryId: string) {
  const wallet = await visibleWallet(actor, walletId);
  const entry = await prisma.walletEntry.findFirst({ where: { id: entryId, walletId } });
  if (!entry) throw AppError.notFound('Entry not found');
  if (!actor.isAdmin && entry.createdById !== actor.userId) throw AppError.forbidden('Only the father or who added it can remove this');
  // Removing money that was already spent would push the balance below zero.
  if (entry.type === 'TOPUP' && balanceOf(wallet.entries).minus(entry.amount).isNegative()) {
    throw new AppError(409, 'Part of this amount was already spent', [], 'INSUFFICIENT_BALANCE');
  }
  await prisma.$transaction(async (tx) => {
    await tx.walletEntry.delete({ where: { id: entryId } });
    if (entry.expenseId) await tx.expense.updateMany({ where: { id: entry.expenseId, deletedAt: null }, data: { deletedAt: new Date() } });
  });
  return getWallet(actor, walletId);
}
