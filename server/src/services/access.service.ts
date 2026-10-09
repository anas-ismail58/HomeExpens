import type { PermissionKey, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

export const PERMISSION_KEYS = [
  'VIEW_EXPENSES',
  'ADD_EXPENSE',
  'EDIT_EXPENSE',
  'DELETE_EXPENSE',
  'VIEW_PAYMENTS',
  'ADD_PAYMENT',
  'EDIT_PAYMENT',
  'DELETE_PAYMENT',
  'VIEW_REPORTS',
  'MANAGE_CHILDREN',
  'SERVICE_LESSONS',
  'SERVICE_RECURRING',
  'SERVICE_HOUSEHOLD',
  'VIEW_INCOME',
] as const satisfies readonly PermissionKey[];

/** Starting grants for a new member; the admin can change each one afterwards. */
export const ROLE_DEFAULTS: Record<UserRole, readonly PermissionKey[]> = {
  FATHER: PERMISSION_KEYS,
  MOTHER: [
    'VIEW_EXPENSES',
    'ADD_EXPENSE',
    'EDIT_EXPENSE',
    'VIEW_PAYMENTS',
    'ADD_PAYMENT',
    'EDIT_PAYMENT',
    'VIEW_REPORTS',
    'SERVICE_LESSONS',
    'SERVICE_RECURRING',
    'SERVICE_HOUSEHOLD',
  ],
  CHILD: ['VIEW_EXPENSES', 'VIEW_PAYMENTS', 'SERVICE_LESSONS'],
  // A relative sees the family's spending and payments; the father turns on anything more.
  UNCLE: ['VIEW_EXPENSES', 'VIEW_PAYMENTS'],
};

/** The authenticated caller, always loaded from the database (never from client input). */
export interface Actor {
  userId: string;
  familyId: string;
  role: UserRole;
  /** FATHER = family admin with every permission. */
  isAdmin: boolean;
  /** Set for CHILD logins: the child's FamilyMember id. Children only ever see their own data. */
  memberId: string | null;
  timezone: string;
  permissions: PermissionKey[];
  /** Platform operator: may enter any family as its admin. */
  isSuperAdmin: boolean;
  /** A super admin inside a family they are not a member of. Family-member defaults fall back to the owner. */
  isVisiting: boolean;
}

export function effectivePermissions(role: UserRole, overrides: { key: PermissionKey; granted: boolean }[]): PermissionKey[] {
  if (role === 'FATHER') return [...PERMISSION_KEYS];
  const granted = new Set<PermissionKey>(ROLE_DEFAULTS[role]);
  for (const { key, granted: on } of overrides) {
    if (on) granted.add(key);
    else granted.delete(key);
  }
  return PERMISSION_KEYS.filter((key) => granted.has(key));
}

/**
 * Loads the caller and checks they are still an active member of the family in their token.
 * A super admin may hold a token for any existing family and acts there with full admin rights.
 */
export async function loadActor(userId: string, familyId: string): Promise<Actor> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, familyId: true, role: true, memberId: true, timezone: true, isActive: true, isSuperAdmin: true, permissions: { select: { key: true, granted: true } } },
  });
  if (!user || !user.isActive) throw AppError.unauthorized('Your family access has changed. Please sign in again.');
  const isVisiting = user.isSuperAdmin && user.familyId !== familyId;
  if (isVisiting) {
    if (!(await prisma.family.findUnique({ where: { id: familyId }, select: { id: true } }))) throw AppError.unauthorized('This family no longer exists.');
  } else if (user.familyId !== familyId) {
    throw AppError.unauthorized('Your family access has changed. Please sign in again.');
  }
  const role: UserRole = user.isSuperAdmin ? 'FATHER' : user.role;
  return {
    userId: user.id,
    familyId,
    role,
    isAdmin: role === 'FATHER',
    memberId: role === 'CHILD' ? user.memberId : null,
    timezone: user.timezone,
    permissions: effectivePermissions(role, user.permissions),
    isSuperAdmin: user.isSuperAdmin,
    isVisiting,
  };
}

export function assertSuperAdmin(actor: Actor) {
  if (!actor.isSuperAdmin) throw AppError.forbidden('Only the super admin can do this');
}

/** Who family-member defaults (payment assignee, reassigned payments) should point at for this actor. */
export async function familyStandIn(actor: Actor) {
  if (!actor.isVisiting) return actor.userId;
  const family = await prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { ownerId: true } });
  return family.ownerId;
}

export function can(actor: Actor, key: PermissionKey) {
  return actor.isAdmin || actor.permissions.includes(key);
}

export function assertCan(actor: Actor, key: PermissionKey) {
  if (!can(actor, key)) throw AppError.forbidden('You do not have permission to do this');
}

export function assertAdmin(actor: Actor) {
  if (!actor.isAdmin) throw AppError.forbidden('Only the family admin can do this');
}

/** Children are limited to their own records; everyone else sees the whole family. */
function isChild(actor: Actor) {
  return actor.role === 'CHILD';
}

/** Expense sections hidden from the actor because the admin turned that service off. */
function hiddenServices(actor: Actor): Prisma.ExpenseWhereInput[] {
  const hidden: Prisma.ExpenseWhereInput[] = [];
  if (!can(actor, 'SERVICE_LESSONS')) hidden.push({ subcategory: { key: 'home_tutoring' } });
  if (!can(actor, 'SERVICE_HOUSEHOLD')) hidden.push({ category: { key: 'household' } });
  if (!can(actor, 'SERVICE_RECURRING')) hidden.push({ recurringExpenseId: { not: null } });
  return hidden;
}

/**
 * Expenses the actor may see. Without VIEW_EXPENSES a member still sees what they created themselves.
 * A child only ever sees expenses for their own child record (or ones they added).
 * Services the admin switched off are excluded entirely.
 */
export function expenseScope(actor: Actor): Prisma.ExpenseWhereInput {
  const own = { createdById: actor.userId };
  const hidden = hiddenServices(actor);
  const services: Prisma.ExpenseWhereInput = hidden.length ? { NOT: hidden } : {};
  if (isChild(actor)) {
    if (!can(actor, 'VIEW_EXPENSES')) return { familyId: actor.familyId, ...own, ...services };
    return { familyId: actor.familyId, ...services, OR: [own, ...(actor.memberId ? [{ memberId: actor.memberId }] : [])] };
  }
  return can(actor, 'VIEW_EXPENSES') ? { familyId: actor.familyId, ...services } : { familyId: actor.familyId, ...own, ...services };
}

/** Recurring expenses (fees, recurring bills) the actor may see. */
export function recurringScope(actor: Actor): Prisma.RecurringExpenseWhereInput {
  const none = { id: '00000000-0000-0000-0000-000000000000' };
  if (!can(actor, 'SERVICE_RECURRING')) return none;
  const kinds: Prisma.RecurringExpenseWhereInput[] = [];
  if (can(actor, 'SERVICE_LESSONS')) kinds.push({ subcategory: { key: 'home_tutoring' } });
  if (can(actor, 'SERVICE_HOUSEHOLD')) kinds.push({ category: { key: 'household' } });
  if (!kinds.length) return none;
  if (isChild(actor)) return { familyId: actor.familyId, memberId: actor.memberId ?? none.id, OR: kinds };
  if (!can(actor, 'VIEW_EXPENSES')) return none;
  return { familyId: actor.familyId, OR: kinds };
}

/** Payments the actor may see: all family payments, or (children / no VIEW_PAYMENTS) only their own. */
export function paymentScope(actor: Actor): Prisma.PaymentWhereInput {
  const own: Prisma.PaymentWhereInput[] = [{ assigneeId: actor.userId }, { createdById: actor.userId }];
  if (isChild(actor)) {
    if (actor.memberId && can(actor, 'VIEW_PAYMENTS')) own.push({ memberId: actor.memberId });
    return { familyId: actor.familyId, OR: own };
  }
  return can(actor, 'VIEW_PAYMENTS') ? { familyId: actor.familyId } : { familyId: actor.familyId, OR: own };
}

/** Child records the actor may use (a child only sees itself). */
export function childScope(actor: Actor): Prisma.FamilyMemberWhereInput {
  return isChild(actor) ? { familyId: actor.familyId, id: actor.memberId ?? '00000000-0000-0000-0000-000000000000' } : { familyId: actor.familyId };
}

/** A child may only attach records to its own child record. */
export function assertOwnChild(actor: Actor, childId: string | null | undefined) {
  if (isChild(actor) && childId !== actor.memberId) throw AppError.forbidden('Children can only use their own records');
}
