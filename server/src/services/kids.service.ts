import type { ChildTaskStatus, PermissionKey, PointEntryKind, PointRuleKind, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { DEFAULT_CATEGORIES } from '../constants/defaults';
import { AppError } from '../utils/AppError';
import { formatDateOnly, parseDateOnly } from '../utils/dates';
import { CURRENCY_DECIMALS, Decimal, ZERO, toMoneyString } from '../utils/money';
import { addDays, localDate } from '../utils/time';
import { assertAdmin, assertOwnChild, can, childScope, type Actor } from './access.service';
import { notifyUsers } from './notification.service';

type Tx = Prisma.TransactionClient;

/**
 * Children's points, tasks, penalties and rewards.
 * Balances are always summed from the ledger (child_point_entries) inside a transaction that locks the
 * child's row, so two parents acting at once can't overspend points or money.
 */

// ───────────────────────── Access ─────────────────────────

/** Points permissions only ever apply to parents/relatives, never to a child's own login. */
function parentCan(actor: Actor, key: PermissionKey) {
  return actor.role !== 'CHILD' && can(actor, key);
}

function assertParentCan(actor: Actor, key: PermissionKey) {
  if (!parentCan(actor, key)) throw AppError.forbidden('You do not have permission to do this');
}

/** The admin, the child itself, and anyone the father gave a points permission. */
function canView(actor: Actor) {
  return actor.role === 'CHILD' || parentCan(actor, 'EVALUATE_CHILDREN') || parentCan(actor, 'MANAGE_CHILD_TASKS') || parentCan(actor, 'PENALIZE_CHILDREN');
}

function assertViewer(actor: Actor) {
  if (!canView(actor)) throw AppError.forbidden('You do not have access to children\'s points');
}

async function childFor(actor: Actor, childId: string) {
  assertViewer(actor);
  assertOwnChild(actor, childId);
  const child = await prisma.familyMember.findFirst({
    where: { ...childScope(actor), id: childId, type: 'CHILD', isActive: true, deletedAt: null },
    select: { id: true, name: true, grade: true, school: true },
  });
  if (!child) throw AppError.notFound('Child not found in this family');
  return child;
}

// ───────────────────────── Shared helpers ─────────────────────────

async function familyCurrency(familyId: string) {
  return (await prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { currency: true } })).currency;
}

export async function rewardSettings(familyId: string, tx: Tx = prisma) {
  return tx.childRewardSettings.upsert({ where: { familyId }, create: { familyId }, update: {} });
}

function today(actor: Actor) {
  return localDate(new Date(), actor.timezone);
}

/** Serializes every balance change for one child. */
async function lockChild(tx: Tx, memberId: string) {
  await tx.$queryRaw`SELECT id FROM family_members WHERE id = ${memberId}::uuid FOR UPDATE`;
}

async function balancesOf(tx: Tx, memberId: string) {
  const sum = await tx.childPointEntry.aggregate({ where: { memberId, voidedAt: null }, _sum: { points: true, amount: true } });
  return { points: sum._sum.points ?? 0, money: sum._sum.amount ?? ZERO };
}

function conflict(message: string, code: string) {
  return new AppError(409, message, [], code);
}

async function audit(tx: Tx, actor: Actor, input: { action: string; entityType: string; entityId?: string | null; memberId?: string | null; details?: Prisma.InputJsonValue }) {
  await tx.auditLog.create({
    data: {
      familyId: actor.familyId,
      actorId: actor.userId,
      memberId: input.memberId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      details: input.details ?? undefined,
    },
  });
}

async function activeRule(tx: Tx, familyId: string, ruleId: string, kind: PointRuleKind) {
  const rule = await tx.pointRule.findFirst({ where: { id: ruleId, familyId, kind, isActive: true } });
  if (!rule) throw AppError.notFound('Rule not found');
  return rule;
}

/** The "Children" expense category and one of its sections; created for families that predate it. */
async function childrenSection(tx: Tx, familyId: string, key: 'rewards' | 'pocket_money') {
  const defaults = DEFAULT_CATEGORIES.find((c) => c.key === 'children')!;
  const category =
    (await tx.category.findFirst({ where: { familyId, key: 'children' } })) ??
    (await tx.category.create({
      data: { familyId, key: 'children', nameAr: defaults.nameAr, nameEn: defaults.nameEn, icon: defaults.icon, color: defaults.color, isDefault: true, sortOrder: DEFAULT_CATEGORIES.indexOf(defaults) },
    }));
  const sub = defaults.subcategories.find((s) => s.key === key)!;
  const subcategory = await tx.subcategory.upsert({
    where: { categoryId_key: { categoryId: category.id, key } },
    create: { categoryId: category.id, key, nameAr: sub.nameAr, nameEn: sub.nameEn, sortOrder: defaults.subcategories.indexOf(sub) },
    update: {},
  });
  return { categoryId: category.id, subcategoryId: subcategory.id };
}

/** The child's own login, if it has one. */
async function childUserIds(memberId: string) {
  const users = await prisma.user.findMany({ where: { memberId, isActive: true }, select: { id: true } });
  return users.map((u) => u.id);
}

async function notifyChild(actor: Actor, memberId: string, title: string, message: string) {
  const ids = (await childUserIds(memberId)).filter((id) => id !== actor.userId);
  await notifyUsers(ids, { familyId: actor.familyId, type: 'CHILD_POINTS', title, message, relatedEntityId: memberId });
}

const points = (n: number) => n.toLocaleString('en-US');

// ───────────────────────── DTOs ─────────────────────────

const person = { select: { id: true, name: true } } as const;
const entryInclude = {
  createdBy: person,
  voidedBy: person,
  rule: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
} satisfies Prisma.ChildPointEntryInclude;
type EntryRow = Prisma.ChildPointEntryGetPayload<{ include: typeof entryInclude }>;

const MONEY_KINDS: PointEntryKind[] = ['CONVERT', 'PAYOUT', 'ALLOWANCE'];

/** Who may undo an entry: the father, or the parent who added it while they still hold that permission. */
function canVoid(actor: Actor, entry: { kind: PointEntryKind; createdById: string | null; voidedAt: Date | null }) {
  if (entry.voidedAt) return false;
  if (actor.isAdmin) return true;
  if (MONEY_KINDS.includes(entry.kind) || entry.createdById !== actor.userId) return false;
  return parentCan(actor, entry.kind === 'PENALTY' ? 'PENALIZE_CHILDREN' : 'EVALUATE_CHILDREN');
}

function entryDto(actor: Actor, e: EntryRow, currency: string) {
  return {
    id: e.id,
    kind: e.kind,
    points: e.points,
    amount: toMoneyString(e.amount, currency),
    cash: e.cash ? toMoneyString(e.cash, currency) : null,
    reason: e.reason,
    rule: e.rule,
    task: e.task,
    date: formatDateOnly(e.date),
    createdAt: e.createdAt.toISOString(),
    createdBy: e.createdBy,
    voided: Boolean(e.voidedAt),
    voidedAt: e.voidedAt?.toISOString() ?? null,
    voidedBy: e.voidedBy,
    voidReason: e.voidReason,
    canVoid: canVoid(actor, e),
  };
}

const taskInclude = { createdBy: person, completedBy: person, reviewedBy: person } satisfies Prisma.ChildTaskInclude;
type TaskRow = Prisma.ChildTaskGetPayload<{ include: typeof taskInclude }>;

function taskDto(actor: Actor, task: TaskRow, todayDate: string) {
  const due = task.dueDate ? formatDateOnly(task.dueDate) : null;
  const ownChild = actor.role === 'CHILD' && actor.memberId === task.memberId;
  const open = task.status !== 'APPROVED';
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    dueDate: due,
    points: task.points,
    status: task.status,
    overdue: task.status === 'PENDING' && due !== null && due < todayDate,
    createdBy: task.createdBy,
    completedAt: task.completedAt?.toISOString() ?? null,
    completedBy: task.completedBy,
    reviewedAt: task.reviewedAt?.toISOString() ?? null,
    reviewedBy: task.reviewedBy,
    reviewNote: task.reviewNote,
    createdAt: task.createdAt.toISOString(),
    canComplete: task.status === 'PENDING' && (ownChild || parentCan(actor, 'MANAGE_CHILD_TASKS') || parentCan(actor, 'EVALUATE_CHILDREN')),
    canApprove: open && parentCan(actor, 'EVALUATE_CHILDREN'),
    canReturn: task.status === 'COMPLETED' && parentCan(actor, 'EVALUATE_CHILDREN'),
    canEdit: open && parentCan(actor, 'MANAGE_CHILD_TASKS'),
  };
}

function settingsDto(s: Awaited<ReturnType<typeof rewardSettings>>, currency: string) {
  return {
    pointValue: s.pointValue.toString(),
    maxAwardPoints: s.maxAwardPoints,
    maxPenaltyPoints: s.maxPenaltyPoints,
    dailyPenaltyLimit: s.dailyPenaltyLimit,
    maxPenaltyAmount: toMoneyString(s.maxPenaltyAmount, currency),
    allowNegativePoints: s.allowNegativePoints,
    currency,
  };
}

function ruleDto(r: { id: string; kind: PointRuleKind; name: string; points: number; isActive: boolean }) {
  return { id: r.id, kind: r.kind, name: r.name, points: r.points, isActive: r.isActive };
}

// ───────────────────────── Rating, level, achievements ─────────────────────────

type LedgerPoint = { kind: PointEntryKind; points: number; amount: Prisma.Decimal; date: Date };

function earnedPoints(rows: LedgerPoint[]) {
  return rows.filter((e) => (e.kind === 'AWARD' || e.kind === 'TASK') && e.points > 0).reduce((t, e) => t + e.points, 0);
}

function lostPoints(rows: LedgerPoint[]) {
  return rows.filter((e) => e.kind === 'PENALTY').reduce((t, e) => t - e.points, 0);
}

/** 1–5 stars from the share of points earned vs lost in the last 30 days; null with no activity. */
function rating(recent: LedgerPoint[]) {
  const earned = earnedPoints(recent);
  const lost = lostPoints(recent);
  const penalties = recent.filter((e) => e.kind === 'PENALTY').length;
  if (earned + lost === 0 && !penalties) return null;
  if (earned + lost === 0) return 1;
  return Math.max(1, Math.round((5 * earned) / (earned + lost)));
}

const LEVEL_POINTS = 100;

function level(lifetimeEarned: number) {
  return { level: Math.floor(lifetimeEarned / LEVEL_POINTS) + 1, progress: lifetimeEarned % LEVEL_POINTS, size: LEVEL_POINTS };
}

function achievements(input: { approvedTasks: number; lifetimeEarned: number; week: LedgerPoint[]; rewards: number }) {
  const cleanWeek = input.week.some((e) => e.kind === 'AWARD' || e.kind === 'TASK') && !input.week.some((e) => e.kind === 'PENALTY');
  return [
    { key: 'first_task', earned: input.approvedTasks >= 1 },
    { key: 'tasks_10', earned: input.approvedTasks >= 10 },
    { key: 'points_100', earned: input.lifetimeEarned >= 100 },
    { key: 'points_500', earned: input.lifetimeEarned >= 500 },
    { key: 'clean_week', earned: cleanWeek },
    { key: 'first_reward', earned: input.rewards >= 1 },
  ];
}

// ───────────────────────── Overview & dashboard ─────────────────────────

export async function listKids(actor: Actor) {
  assertViewer(actor);
  const children = await prisma.familyMember.findMany({
    where: { ...childScope(actor), type: 'CHILD', isActive: true, deletedAt: null },
    select: { id: true, name: true, grade: true, school: true },
    orderBy: { createdAt: 'asc' },
  });
  const ids = children.map((c) => c.id);
  const since = parseDateOnly(addDays(today(actor), -29));
  const [sums, recent, tasks, currency] = await Promise.all([
    prisma.childPointEntry.groupBy({ by: ['memberId'], where: { memberId: { in: ids }, voidedAt: null }, _sum: { points: true, amount: true } }),
    prisma.childPointEntry.findMany({ where: { memberId: { in: ids }, voidedAt: null, date: { gte: since } }, select: { memberId: true, kind: true, points: true, amount: true, date: true } }),
    prisma.childTask.groupBy({ by: ['memberId', 'status'], where: { memberId: { in: ids }, deletedAt: null, status: { in: ['PENDING', 'COMPLETED'] } }, _count: true }),
    familyCurrency(actor.familyId),
  ]);
  return children.map((child) => {
    const sum = sums.find((s) => s.memberId === child.id)?._sum;
    const count = (status: ChildTaskStatus) => tasks.find((t) => t.memberId === child.id && t.status === status)?._count ?? 0;
    return {
      ...child,
      points: sum?.points ?? 0,
      money: toMoneyString(sum?.amount ?? ZERO, currency),
      currency,
      stars: rating(recent.filter((e) => e.memberId === child.id)),
      pendingTasks: count('PENDING'),
      awaitingApproval: count('COMPLETED'),
    };
  });
}

export async function getKidBoard(actor: Actor, childId: string) {
  const child = await childFor(actor, childId);
  const todayDate = today(actor);
  const since = parseDateOnly(addDays(todayDate, -7 * 8 + 1));
  const [settings, currency, balances, entries, tasks, ledger, approvedTasks, rewards, rules] = await Promise.all([
    rewardSettings(actor.familyId),
    familyCurrency(actor.familyId),
    balancesOf(prisma, child.id),
    prisma.childPointEntry.findMany({ where: { memberId: child.id }, include: entryInclude, orderBy: [{ createdAt: 'desc' }], take: 150 }),
    prisma.childTask.findMany({ where: { memberId: child.id, deletedAt: null }, include: taskInclude, orderBy: [{ createdAt: 'desc' }], take: 200 }),
    prisma.childPointEntry.findMany({ where: { memberId: child.id, voidedAt: null }, select: { kind: true, points: true, amount: true, date: true } }),
    prisma.childTask.count({ where: { memberId: child.id, deletedAt: null, status: 'APPROVED' } }),
    prisma.childPointEntry.count({ where: { memberId: child.id, voidedAt: null, kind: 'REWARD' } }),
    prisma.pointRule.findMany({ where: { familyId: actor.familyId, isActive: true }, orderBy: [{ kind: 'asc' }, { points: 'asc' }] }),
  ]);

  const lifetimeEarned = earnedPoints(ledger);
  const inLast = (days: number) => {
    const from = addDays(todayDate, -(days - 1));
    return ledger.filter((e) => formatDateOnly(e.date) >= from);
  };
  // Eight rolling weeks ending today, oldest first.
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = addDays(todayDate, -7 * (7 - i));
    const start = addDays(end, -6);
    const rows = ledger.filter((e) => e.date >= since && formatDateOnly(e.date) >= start && formatDateOnly(e.date) <= end);
    return { start, end, earned: earnedPoints(rows), lost: lostPoints(rows) };
  });
  const order: Record<ChildTaskStatus, number> = { COMPLETED: 0, PENDING: 1, APPROVED: 2 };
  const sortedTasks = [...tasks].sort((a, b) => order[a.status] - order[b.status]);

  return {
    child,
    currency,
    points: balances.points,
    money: toMoneyString(balances.money, currency),
    moneyValueOfPoints: toMoneyString(new Decimal(Math.max(balances.points, 0)).times(settings.pointValue), currency),
    stars: rating(inLast(30)),
    ...level(lifetimeEarned),
    lifetimeEarned,
    approvedTasks,
    achievements: achievements({ approvedTasks, lifetimeEarned, week: inLast(7), rewards }),
    weeks,
    tasks: sortedTasks.map((t) => taskDto(actor, t, todayDate)),
    entries: entries.map((e) => entryDto(actor, e, currency)),
    rules: actor.role === 'CHILD' ? rules.filter((r) => r.kind === 'REWARD').map(ruleDto) : rules.map(ruleDto),
    settings: settingsDto(settings, currency),
    can: {
      award: parentCan(actor, 'EVALUATE_CHILDREN'),
      penalize: parentCan(actor, 'PENALIZE_CHILDREN'),
      manageTasks: parentCan(actor, 'MANAGE_CHILD_TASKS'),
      manageMoney: actor.isAdmin,
      configure: actor.isAdmin,
    },
  };
}

// ───────────────────────── Points ─────────────────────────

async function createEntry(tx: Tx, actor: Actor, memberId: string, data: Omit<Prisma.ChildPointEntryUncheckedCreateInput, 'familyId' | 'memberId' | 'date' | 'createdById'>) {
  return tx.childPointEntry.create({
    data: { ...data, familyId: actor.familyId, memberId, date: parseDateOnly(today(actor)), createdById: actor.userId },
  });
}

export async function awardPoints(actor: Actor, childId: string, input: { ruleId?: string; points?: number; reason?: string }) {
  assertParentCan(actor, 'EVALUATE_CHILDREN');
  const child = await childFor(actor, childId);
  const entry = await prisma.$transaction(async (tx) => {
    const settings = await rewardSettings(actor.familyId, tx);
    const rule = input.ruleId ? await activeRule(tx, actor.familyId, input.ruleId, 'BEHAVIOR') : null;
    const amount = rule ? rule.points : input.points!;
    const reason = input.reason || rule?.name;
    if (!reason) throw AppError.validation([{ field: 'reason', message: 'Write a reason' }]);
    if (amount > settings.maxAwardPoints) throw AppError.validation([{ field: 'points', message: `At most ${settings.maxAwardPoints} points at a time` }]);
    await lockChild(tx, child.id);
    const created = await createEntry(tx, actor, child.id, { kind: 'AWARD', points: amount, reason, ruleId: rule?.id ?? null });
    await audit(tx, actor, { action: 'points.award', entityType: 'ChildPointEntry', entityId: created.id, memberId: child.id, details: { points: amount, reason, ruleId: rule?.id ?? null } });
    return created;
  });
  await notifyChild(actor, child.id, 'أحسنت! 🌟', `+${points(entry.points)} نقطة — ${entry.reason}`);
  return getKidBoard(actor, child.id);
}

export async function penalize(actor: Actor, childId: string, input: { ruleId?: string; points?: number; amount?: string; reason?: string }) {
  assertParentCan(actor, 'PENALIZE_CHILDREN');
  const child = await childFor(actor, childId);
  const currency = await familyCurrency(actor.familyId);
  const entry = await prisma.$transaction(async (tx) => {
    const settings = await rewardSettings(actor.familyId, tx);
    const rule = input.ruleId ? await activeRule(tx, actor.familyId, input.ruleId, 'PENALTY') : null;
    const reason = input.reason || rule?.name;
    if (!reason) throw AppError.validation([{ field: 'reason', message: 'Write the reason for the penalty' }]);
    await lockChild(tx, child.id);
    const balances = await balancesOf(tx, child.id);

    if (input.amount) {
      const money = new Decimal(input.amount);
      if (money.greaterThan(settings.maxPenaltyAmount)) throw AppError.validation([{ field: 'amount', message: `At most ${toMoneyString(settings.maxPenaltyAmount, currency)} ${currency} per penalty` }]);
      if (money.greaterThan(balances.money)) throw conflict('The child\'s reward balance is less than this amount', 'INSUFFICIENT_BALANCE');
      const created = await createEntry(tx, actor, child.id, { kind: 'PENALTY', amount: money.negated(), reason, ruleId: rule?.id ?? null });
      await audit(tx, actor, { action: 'penalty.money', entityType: 'ChildPointEntry', entityId: created.id, memberId: child.id, details: { amount: money.toString(), reason } });
      return created;
    }

    const lose = rule ? rule.points : input.points!;
    if (lose > settings.maxPenaltyPoints) throw AppError.validation([{ field: 'points', message: `At most ${settings.maxPenaltyPoints} points per penalty` }]);
    const day = await tx.childPointEntry.aggregate({ where: { memberId: child.id, kind: 'PENALTY', voidedAt: null, date: parseDateOnly(today(actor)) }, _sum: { points: true } });
    const lostToday = -(day._sum.points ?? 0);
    if (lostToday + lose > settings.dailyPenaltyLimit) throw conflict(`Daily penalty limit reached (${settings.dailyPenaltyLimit} points)`, 'PENALTY_LIMIT');
    if (!settings.allowNegativePoints && balances.points - lose < 0) throw conflict('The child does not have enough points', 'INSUFFICIENT_POINTS');
    const created = await createEntry(tx, actor, child.id, { kind: 'PENALTY', points: -lose, reason, ruleId: rule?.id ?? null });
    await audit(tx, actor, { action: 'penalty.points', entityType: 'ChildPointEntry', entityId: created.id, memberId: child.id, details: { points: lose, reason, ruleId: rule?.id ?? null } });
    return created;
  });
  const lost = entry.points ? `−${points(-entry.points)} نقطة` : `−${toMoneyString(entry.amount.negated(), currency)} ${currency}`;
  await notifyChild(actor, child.id, 'تم خصم', `${lost} — ${entry.reason}`);
  return getKidBoard(actor, child.id);
}

/** Spend points on a reward from the father's list. Points can never go below zero for this. */
export async function redeemReward(actor: Actor, childId: string, input: { ruleId: string }) {
  assertParentCan(actor, 'EVALUATE_CHILDREN');
  const child = await childFor(actor, childId);
  const entry = await prisma.$transaction(async (tx) => {
    const rule = await activeRule(tx, actor.familyId, input.ruleId, 'REWARD');
    await lockChild(tx, child.id);
    if ((await balancesOf(tx, child.id)).points < rule.points) throw conflict('The child does not have enough points', 'INSUFFICIENT_POINTS');
    const created = await createEntry(tx, actor, child.id, { kind: 'REWARD', points: -rule.points, reason: rule.name, ruleId: rule.id });
    await audit(tx, actor, { action: 'reward.redeem', entityType: 'ChildPointEntry', entityId: created.id, memberId: child.id, details: { points: rule.points, reward: rule.name } });
    return created;
  });
  await notifyChild(actor, child.id, 'مكافأة 🎁', `${entry.reason} (−${points(-entry.points)} نقطة)`);
  return getKidBoard(actor, child.id);
}

/** Father only: turn points into money owed to the child, at his conversion rate. */
export async function convertPoints(actor: Actor, childId: string, input: { points: number }) {
  assertAdmin(actor);
  const child = await childFor(actor, childId);
  const currency = await familyCurrency(actor.familyId);
  await prisma.$transaction(async (tx) => {
    const settings = await rewardSettings(actor.familyId, tx);
    await lockChild(tx, child.id);
    if ((await balancesOf(tx, child.id)).points < input.points) throw conflict('The child does not have enough points', 'INSUFFICIENT_POINTS');
    const money = new Decimal(input.points).times(settings.pointValue).toDecimalPlaces(CURRENCY_DECIMALS[currency] ?? 2);
    if (money.lessThanOrEqualTo(0)) throw AppError.validation([{ field: 'points', message: 'Too few points to convert' }]);
    const created = await createEntry(tx, actor, child.id, { kind: 'CONVERT', points: -input.points, amount: money, reason: `${input.points} × ${settings.pointValue.toString()}` });
    await audit(tx, actor, { action: 'points.convert', entityType: 'ChildPointEntry', entityId: created.id, memberId: child.id, details: { points: input.points, amount: money.toString(), rate: settings.pointValue.toString() } });
  });
  return getKidBoard(actor, child.id);
}

/** Father only: hand money to the child. A PAYOUT comes from the reward balance; an ALLOWANCE doesn't. Both are family expenses. */
export async function payChild(actor: Actor, childId: string, kind: 'PAYOUT' | 'ALLOWANCE', input: { amount: string; note?: string }) {
  assertAdmin(actor);
  const child = await childFor(actor, childId);
  const currency = await familyCurrency(actor.familyId);
  await prisma.$transaction(async (tx) => {
    const money = new Decimal(input.amount);
    await lockChild(tx, child.id);
    if (kind === 'PAYOUT' && money.greaterThan((await balancesOf(tx, child.id)).money)) throw conflict('The child\'s reward balance is less than this amount', 'INSUFFICIENT_BALANCE');
    const section = await childrenSection(tx, actor.familyId, kind === 'PAYOUT' ? 'rewards' : 'pocket_money');
    const reason = input.note || (kind === 'PAYOUT' ? `مكافأة ${child.name}` : `مصروف ${child.name}`);
    const expense = await tx.expense.create({
      data: {
        familyId: actor.familyId,
        ownerType: 'CHILD',
        memberId: child.id,
        ...section,
        amount: money,
        description: reason,
        date: parseDateOnly(today(actor)),
        occurredAt: new Date(),
        createdById: actor.userId,
      },
    });
    const created = await createEntry(tx, actor, child.id, { kind, amount: kind === 'PAYOUT' ? money.negated() : ZERO, cash: money, reason, expenseId: expense.id });
    await audit(tx, actor, { action: kind === 'PAYOUT' ? 'money.payout' : 'money.allowance', entityType: 'ChildPointEntry', entityId: created.id, memberId: child.id, details: { amount: money.toString(), currency, expenseId: expense.id } });
  });
  await notifyChild(actor, child.id, kind === 'PAYOUT' ? 'استلمت مكافأتك 💰' : 'استلمت مصروفك', `${toMoneyString(input.amount, currency)} ${currency}`);
  return getKidBoard(actor, child.id);
}

/** Undo an entry. Its expense is removed and an approved task goes back to "done, waiting for approval". */
export async function voidEntry(actor: Actor, entryId: string, input: { reason?: string }) {
  assertViewer(actor);
  const entry = await prisma.childPointEntry.findFirst({ where: { id: entryId, familyId: actor.familyId } });
  if (!entry) throw AppError.notFound('Entry not found');
  await childFor(actor, entry.memberId);
  if (entry.voidedAt) throw conflict('This entry was already undone', 'ALREADY_VOIDED');
  if (!canVoid(actor, entry)) throw AppError.forbidden('Only the father or the parent who added it can undo this');

  await prisma.$transaction(async (tx) => {
    const settings = await rewardSettings(actor.familyId, tx);
    await lockChild(tx, entry.memberId);
    const balances = await balancesOf(tx, entry.memberId);
    if (balances.money.minus(entry.amount).isNegative()) throw conflict('Part of this money was already paid out', 'INSUFFICIENT_BALANCE');
    if (entry.points > 0 && balances.points - entry.points < 0 && !settings.allowNegativePoints) throw conflict('Part of these points were already used', 'INSUFFICIENT_POINTS');
    const done = await tx.childPointEntry.updateMany({ where: { id: entry.id, voidedAt: null }, data: { voidedAt: new Date(), voidedById: actor.userId, voidReason: input.reason ?? null } });
    if (done.count !== 1) throw conflict('This entry was already undone', 'ALREADY_VOIDED');
    if (entry.expenseId) await tx.expense.updateMany({ where: { id: entry.expenseId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (entry.kind === 'TASK' && entry.taskId) {
      await tx.childTask.updateMany({ where: { id: entry.taskId, status: 'APPROVED' }, data: { status: 'COMPLETED', reviewedAt: null, reviewedById: null } });
    }
    await audit(tx, actor, { action: 'entry.void', entityType: 'ChildPointEntry', entityId: entry.id, memberId: entry.memberId, details: { kind: entry.kind, points: entry.points, amount: entry.amount.toString(), reason: input.reason ?? null } });
  });
  return getKidBoard(actor, entry.memberId);
}

// ───────────────────────── Tasks ─────────────────────────

async function visibleTask(actor: Actor, taskId: string) {
  assertViewer(actor);
  const task = await prisma.childTask.findFirst({ where: { id: taskId, familyId: actor.familyId, deletedAt: null } });
  if (!task) throw AppError.notFound('Task not found');
  if (actor.role === 'CHILD' && task.memberId !== actor.memberId) throw AppError.notFound('Task not found');
  await childFor(actor, task.memberId);
  return task;
}

function assertTaskPoints(settings: { maxAwardPoints: number }, value: number | undefined) {
  if (value !== undefined && value > settings.maxAwardPoints) throw AppError.validation([{ field: 'points', message: `At most ${settings.maxAwardPoints} points per task` }]);
}

export async function createTask(actor: Actor, childId: string, input: { title: string; description?: string | null; dueDate?: string | null; points: number }) {
  assertParentCan(actor, 'MANAGE_CHILD_TASKS');
  const child = await childFor(actor, childId);
  const task = await prisma.$transaction(async (tx) => {
    assertTaskPoints(await rewardSettings(actor.familyId, tx), input.points);
    const created = await tx.childTask.create({
      data: {
        familyId: actor.familyId,
        memberId: child.id,
        title: input.title,
        description: input.description || null,
        dueDate: input.dueDate ? parseDateOnly(input.dueDate) : null,
        points: input.points,
        createdById: actor.userId,
      },
    });
    await audit(tx, actor, { action: 'task.create', entityType: 'ChildTask', entityId: created.id, memberId: child.id, details: { title: input.title, points: input.points, dueDate: input.dueDate ?? null } });
    return created;
  });
  await notifyChild(actor, child.id, 'مهمة جديدة 📝', `${task.title} (+${points(task.points)} نقطة)`);
  return getKidBoard(actor, child.id);
}

export async function updateTask(actor: Actor, taskId: string, input: { title?: string; description?: string | null; dueDate?: string | null; points?: number }) {
  assertParentCan(actor, 'MANAGE_CHILD_TASKS');
  const task = await visibleTask(actor, taskId);
  if (task.status === 'APPROVED') throw conflict('An approved task can\'t be changed', 'TASK_APPROVED');
  await prisma.$transaction(async (tx) => {
    assertTaskPoints(await rewardSettings(actor.familyId, tx), input.points);
    await tx.childTask.update({
      where: { id: task.id },
      data: {
        title: input.title,
        description: input.description === undefined ? undefined : input.description || null,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate ? parseDateOnly(input.dueDate) : null,
        points: input.points,
      },
    });
    await audit(tx, actor, { action: 'task.update', entityType: 'ChildTask', entityId: task.id, memberId: task.memberId, details: { before: { title: task.title, points: task.points, dueDate: task.dueDate ? formatDateOnly(task.dueDate) : null }, changes: input } });
  });
  return getKidBoard(actor, task.memberId);
}

export async function deleteTask(actor: Actor, taskId: string) {
  assertParentCan(actor, 'MANAGE_CHILD_TASKS');
  const task = await visibleTask(actor, taskId);
  if (task.status === 'APPROVED') throw conflict('Undo the task\'s points first, then delete it', 'TASK_APPROVED');
  await prisma.$transaction(async (tx) => {
    await tx.childTask.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
    await audit(tx, actor, { action: 'task.delete', entityType: 'ChildTask', entityId: task.id, memberId: task.memberId, details: { title: task.title, points: task.points } });
  });
  return getKidBoard(actor, task.memberId);
}

/** The child (or a parent) marks it done. Parents are told it is waiting for approval. */
export async function completeTask(actor: Actor, taskId: string) {
  const task = await visibleTask(actor, taskId);
  const ownChild = actor.role === 'CHILD' && actor.memberId === task.memberId;
  if (!ownChild && !parentCan(actor, 'MANAGE_CHILD_TASKS') && !parentCan(actor, 'EVALUATE_CHILDREN')) throw AppError.forbidden('You do not have permission to do this');
  await prisma.$transaction(async (tx) => {
    const done = await tx.childTask.updateMany({ where: { id: task.id, status: 'PENDING', deletedAt: null }, data: { status: 'COMPLETED', completedAt: new Date(), completedById: actor.userId, reviewNote: null } });
    if (done.count !== 1) throw conflict('This task is not pending', 'TASK_NOT_PENDING');
    await audit(tx, actor, { action: 'task.complete', entityType: 'ChildTask', entityId: task.id, memberId: task.memberId, details: { title: task.title } });
  });
  if (ownChild) {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { ownerId: true } });
    const child = await prisma.familyMember.findUniqueOrThrow({ where: { id: task.memberId }, select: { name: true } });
    await notifyUsers([family.ownerId, ...(task.createdById ? [task.createdById] : [])], {
      familyId: actor.familyId,
      type: 'CHILD_POINTS',
      title: `${child.name} أنهى مهمة ✅`,
      message: `«${task.title}» بانتظار موافقتك`,
      relatedEntityId: task.memberId,
    });
  }
  return getKidBoard(actor, task.memberId);
}

/** Approving awards the task's points exactly once. */
export async function approveTask(actor: Actor, taskId: string) {
  assertParentCan(actor, 'EVALUATE_CHILDREN');
  const task = await visibleTask(actor, taskId);
  await prisma.$transaction(async (tx) => {
    await lockChild(tx, task.memberId);
    const now = new Date();
    const done = await tx.childTask.updateMany({
      where: { id: task.id, deletedAt: null, status: { in: ['PENDING', 'COMPLETED'] } },
      data: { status: 'APPROVED', reviewedAt: now, reviewedById: actor.userId, reviewNote: null, ...(task.status === 'PENDING' ? { completedAt: now, completedById: actor.userId } : {}) },
    });
    if (done.count !== 1) throw conflict('This task was already approved', 'TASK_APPROVED');
    const created = await createEntry(tx, actor, task.memberId, { kind: 'TASK', points: task.points, reason: task.title, taskId: task.id });
    await audit(tx, actor, { action: 'task.approve', entityType: 'ChildTask', entityId: task.id, memberId: task.memberId, details: { title: task.title, points: task.points, entryId: created.id } });
  });
  await notifyChild(actor, task.memberId, 'تمت الموافقة على مهمتك 🎉', `«${task.title}» +${points(task.points)} نقطة`);
  return getKidBoard(actor, task.memberId);
}

/** Send a completed task back to the child with a note. */
export async function returnTask(actor: Actor, taskId: string, input: { note?: string }) {
  assertParentCan(actor, 'EVALUATE_CHILDREN');
  const task = await visibleTask(actor, taskId);
  await prisma.$transaction(async (tx) => {
    const done = await tx.childTask.updateMany({ where: { id: task.id, status: 'COMPLETED', deletedAt: null }, data: { status: 'PENDING', completedAt: null, completedById: null, reviewNote: input.note ?? null } });
    if (done.count !== 1) throw conflict('Only a completed task can be sent back', 'TASK_NOT_COMPLETED');
    await audit(tx, actor, { action: 'task.return', entityType: 'ChildTask', entityId: task.id, memberId: task.memberId, details: { title: task.title, note: input.note ?? null } });
  });
  await notifyChild(actor, task.memberId, 'راجع مهمتك', `«${task.title}»${input.note ? ` — ${input.note}` : ''}`);
  return getKidBoard(actor, task.memberId);
}

// ───────────────────────── Reports ─────────────────────────

/** Weeks start on Saturday. */
function periodRange(period: 'week' | 'month', date: string) {
  if (period === 'month') {
    const start = `${date.slice(0, 7)}-01`;
    const [y, m] = start.split('-').map(Number);
    const end = formatDateOnly(new Date(Date.UTC(y, m, 0)));
    return { start, end };
  }
  const dow = parseDateOnly(date).getUTCDay(); // 0 = Sunday … 6 = Saturday
  const start = addDays(date, -((dow + 1) % 7));
  return { start, end: addDays(start, 6) };
}

export async function getKidReport(actor: Actor, childId: string, input: { period: 'week' | 'month'; date?: string }) {
  const child = await childFor(actor, childId);
  const { start, end } = periodRange(input.period, input.date ?? today(actor));
  const range = { gte: parseDateOnly(start), lte: parseDateOnly(end) };
  const [entries, currency, tasksCreated, tasksCompleted, openTasks] = await Promise.all([
    prisma.childPointEntry.findMany({ where: { memberId: child.id, date: range }, include: entryInclude, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
    familyCurrency(actor.familyId),
    prisma.childTask.count({ where: { memberId: child.id, deletedAt: null, createdAt: { gte: range.gte, lt: parseDateOnly(addDays(end, 1)) } } }),
    prisma.childTask.count({ where: { memberId: child.id, deletedAt: null, completedAt: { gte: range.gte, lt: parseDateOnly(addDays(end, 1)) } } }),
    prisma.childTask.findMany({ where: { memberId: child.id, deletedAt: null, status: 'PENDING', dueDate: { not: null, lte: range.lte } }, select: { dueDate: true } }),
  ]);
  const live = entries.filter((e) => !e.voidedAt);
  const sumPoints = (kind: PointEntryKind) => live.filter((e) => e.kind === kind).reduce((t, e) => t + e.points, 0);
  const sumMoney = (rows: typeof live) => rows.reduce((t, e) => t.plus(e.cash ?? e.amount.abs()), new Decimal(0));

  const days: { date: string; earned: number; lost: number }[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const rows = live.filter((e) => formatDateOnly(e.date) === d);
    days.push({ date: d, earned: earnedPoints(rows), lost: lostPoints(rows) });
  }
  const todayDate = today(actor);
  return {
    child,
    period: input.period,
    start,
    end,
    currency,
    points: {
      behavior: sumPoints('AWARD'),
      tasks: sumPoints('TASK'),
      penalties: -sumPoints('PENALTY'),
      rewards: -sumPoints('REWARD'),
      converted: -sumPoints('CONVERT'),
      net: live.reduce((t, e) => t + e.points, 0),
    },
    money: {
      converted: toMoneyString(sumMoney(live.filter((e) => e.kind === 'CONVERT')), currency),
      rewardsPaid: toMoneyString(sumMoney(live.filter((e) => e.kind === 'PAYOUT')), currency),
      allowances: toMoneyString(sumMoney(live.filter((e) => e.kind === 'ALLOWANCE')), currency),
      penalties: toMoneyString(sumMoney(live.filter((e) => e.kind === 'PENALTY' && !e.amount.isZero())), currency),
    },
    counts: {
      awards: live.filter((e) => e.kind === 'AWARD').length,
      penalties: live.filter((e) => e.kind === 'PENALTY').length,
      rewards: live.filter((e) => e.kind === 'REWARD').length,
      tasksApproved: live.filter((e) => e.kind === 'TASK').length,
      tasksCreated,
      tasksCompleted,
      tasksOverdue: openTasks.filter((t) => formatDateOnly(t.dueDate!) < todayDate).length,
    },
    stars: rating(live),
    days,
    entries: entries.map((e) => entryDto(actor, e, currency)),
  };
}

// ───────────────────────── Settings, rules, audit (father) ─────────────────────────

export async function getSettings(actor: Actor) {
  assertViewer(actor);
  const [settings, currency, rules] = await Promise.all([
    rewardSettings(actor.familyId),
    familyCurrency(actor.familyId),
    prisma.pointRule.findMany({ where: { familyId: actor.familyId, ...(actor.isAdmin ? {} : { isActive: true }) }, orderBy: [{ kind: 'asc' }, { isActive: 'desc' }, { points: 'asc' }] }),
  ]);
  return { settings: settingsDto(settings, currency), rules: rules.map(ruleDto), canConfigure: actor.isAdmin };
}

export async function updateSettings(
  actor: Actor,
  input: Partial<{ pointValue: string; maxAwardPoints: number; maxPenaltyPoints: number; dailyPenaltyLimit: number; maxPenaltyAmount: string; allowNegativePoints: boolean }>,
) {
  assertAdmin(actor);
  await prisma.$transaction(async (tx) => {
    const before = await rewardSettings(actor.familyId, tx);
    const after = await tx.childRewardSettings.update({ where: { familyId: actor.familyId }, data: { ...input, updatedById: actor.userId } });
    await audit(tx, actor, {
      action: 'settings.update',
      entityType: 'ChildRewardSettings',
      details: JSON.parse(JSON.stringify({ before: { ...before, updatedAt: undefined }, after: { ...after, updatedAt: undefined } })),
    });
  });
  return getSettings(actor);
}

export async function createRule(actor: Actor, input: { kind: PointRuleKind; name: string; points: number }) {
  assertAdmin(actor);
  await prisma.$transaction(async (tx) => {
    const rule = await tx.pointRule.create({ data: { familyId: actor.familyId, ...input } });
    await audit(tx, actor, { action: 'rule.create', entityType: 'PointRule', entityId: rule.id, details: input });
  });
  return getSettings(actor);
}

export async function updateRule(actor: Actor, ruleId: string, input: { name?: string; points?: number; isActive?: boolean }) {
  assertAdmin(actor);
  const rule = await prisma.pointRule.findFirst({ where: { id: ruleId, familyId: actor.familyId } });
  if (!rule) throw AppError.notFound('Rule not found');
  await prisma.$transaction(async (tx) => {
    await tx.pointRule.update({ where: { id: rule.id }, data: input });
    await audit(tx, actor, { action: 'rule.update', entityType: 'PointRule', entityId: rule.id, details: { before: ruleDto(rule), changes: input } });
  });
  return getSettings(actor);
}

/** Rules are switched off rather than deleted, so history keeps their names. */
export async function deleteRule(actor: Actor, ruleId: string) {
  return updateRule(actor, ruleId, { isActive: false });
}

export async function listAudit(actor: Actor, input: { childId?: string; limit?: number }) {
  assertAdmin(actor);
  const rows = await prisma.auditLog.findMany({
    where: { familyId: actor.familyId, ...(input.childId ? { memberId: input.childId } : {}) },
    include: { actor: person },
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 200,
  });
  const memberIds = [...new Set(rows.map((r) => r.memberId).filter((id): id is string => Boolean(id)))];
  const members = await prisma.familyMember.findMany({ where: { id: { in: memberIds }, familyId: actor.familyId }, select: { id: true, name: true } });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    actor: r.actor,
    child: members.find((m) => m.id === r.memberId) ?? null,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
  }));
}
