import { randomInt } from 'node:crypto';
import type { PermissionKey, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import bcrypt from 'bcryptjs';
import type { FamilyUpdateInput, InvitationInput, MemberAccountInput, PermissionsInput, RoleInput } from '../validators/family.validator';
import { assertAdmin, effectivePermissions, PERMISSION_KEYS, ROLE_DEFAULTS, type Actor } from './access.service';
import { notifyUsers } from './notification.service';
import { retimePaymentsForUser } from './payment.service';

const INVITE_TTL_DAYS = 7;
// 32 unambiguous symbols x 10 = 50 bits: not guessable behind the auth rate limiter.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newInviteCode() {
  return Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

export function normalizeInviteCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Every /families/:id route only works for the caller's own family; others look like 404. */
function assertOwnFamily(actor: Actor, familyId: string) {
  if (familyId !== actor.familyId) throw AppError.notFound('Family not found');
}

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  VIEW_EXPENSES: 'View expenses',
  ADD_EXPENSE: 'Add expense',
  EDIT_EXPENSE: 'Edit expense',
  DELETE_EXPENSE: 'Delete expense',
  VIEW_PAYMENTS: 'View payments',
  ADD_PAYMENT: 'Add payment',
  EDIT_PAYMENT: 'Edit / pay payment',
  DELETE_PAYMENT: 'Delete payment',
  VIEW_REPORTS: 'View reports',
  MANAGE_CHILDREN: 'Manage children',
  SERVICE_LESSONS: 'Lessons service',
  SERVICE_RECURRING: 'Recurring fees service',
  SERVICE_HOUSEHOLD: 'Household service',
  VIEW_INCOME: 'Salary & balance',
};

function familyDto(family: { id: string; name: string; currency: string; timezone: string; language: string; ownerId: string; createdAt: Date }) {
  return { id: family.id, name: family.name, currency: family.currency, timezone: family.timezone, language: family.language, ownerId: family.ownerId, createdAt: family.createdAt.toISOString() };
}

export async function getFamily(actor: Actor, familyId: string) {
  assertOwnFamily(actor, familyId);
  const family = await prisma.family.findUniqueOrThrow({ where: { id: familyId } });
  return familyDto(family);
}

export async function updateFamily(actor: Actor, familyId: string, input: FamilyUpdateInput) {
  assertOwnFamily(actor, familyId);
  assertAdmin(actor);
  const family = await prisma.family.update({ where: { id: familyId }, data: input });
  return familyDto(family);
}

const memberSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  memberId: true,
  profileImage: true,
  timezone: true,
  createdAt: true,
  member: { select: { id: true, name: true } },
  permissions: { select: { key: true, granted: true } },
} satisfies Prisma.UserSelect;

/** Everyone in the family sees who is in it; emails and permissions are admin-only. */
export async function listMembers(actor: Actor, familyId: string) {
  assertOwnFamily(actor, familyId);
  const [family, users] = await Promise.all([
    prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { ownerId: true } }),
    prisma.user.findMany({ where: { familyId, isActive: true }, select: memberSelect, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] }),
  ]);
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    role: user.role,
    isOwner: user.id === family.ownerId,
    isAdmin: user.role === 'FATHER',
    profileImage: user.profileImage,
    child: user.role === 'CHILD' ? user.member : null,
    ...(actor.isAdmin ? { email: user.email, timezone: user.timezone, permissions: effectivePermissions(user.role, user.permissions) } : {}),
  }));
}

async function familyMemberUser(familyId: string, userId: string) {
  const [user, family] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, familyId }, select: { id: true, name: true, role: true, memberId: true } }),
    prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { ownerId: true, name: true } }),
  ]);
  if (!user) throw AppError.notFound('Family member not found');
  return { user, family };
}

async function assertChildAvailable(tx: Prisma.TransactionClient, familyId: string, memberId: string, exceptUserId?: string) {
  const child = await tx.familyMember.findFirst({ where: { id: memberId, familyId, type: 'CHILD', deletedAt: null } });
  if (!child) throw AppError.notFound('Child not found in this family');
  const linked = await tx.user.findFirst({ where: { memberId, familyId, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) } });
  if (linked) throw AppError.conflict('This child already has a login');
}

/**
 * The child record a CHILD login represents: the chosen one (must be free), or a new child named
 * after the person so the father doesn't have to add the child first.
 */
async function childRecordFor(tx: Prisma.TransactionClient, familyId: string, memberId: string | null | undefined, name: string, exceptUserId?: string) {
  if (memberId) {
    await assertChildAvailable(tx, familyId, memberId, exceptUserId);
    return memberId;
  }
  const child = await tx.familyMember.create({ data: { familyId, name, type: 'CHILD' } });
  return child.id;
}

function invitationDto(invitation: { id: string; email: string; role: UserRole; code: string; status: string; expiresAt: Date; createdAt: Date; memberId: string | null }) {
  const expired = invitation.status === 'PENDING' && invitation.expiresAt <= new Date();
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    memberId: invitation.memberId,
    code: invitation.code,
    status: expired ? 'EXPIRED' : invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}

export async function createInvitation(actor: Actor, familyId: string, input: InvitationInput) {
  assertOwnFamily(actor, familyId);
  assertAdmin(actor);
  const alreadyMember = await prisma.user.findFirst({ where: { email: input.email, familyId } });
  if (alreadyMember) throw AppError.conflict('This person is already in your family');

  const invitation = await prisma.$transaction(async (tx) => {
    if (input.role === 'CHILD' && input.memberId) await assertChildAvailable(tx, familyId, input.memberId);
    // One live invitation per email: a new one replaces the old.
    await tx.familyInvitation.updateMany({ where: { familyId, email: input.email, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    return tx.familyInvitation.create({
      data: {
        familyId,
        email: input.email,
        role: input.role,
        memberId: input.role === 'CHILD' ? input.memberId ?? null : null,
        code: newInviteCode(),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        invitedById: actor.userId,
      },
    });
  });
  return invitationDto(invitation);
}

export async function listInvitations(actor: Actor, familyId: string) {
  assertOwnFamily(actor, familyId);
  assertAdmin(actor);
  const rows = await prisma.familyInvitation.findMany({ where: { familyId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return rows.map(invitationDto);
}

export async function revokeInvitation(actor: Actor, familyId: string, invitationId: string) {
  assertOwnFamily(actor, familyId);
  assertAdmin(actor);
  const { count } = await prisma.familyInvitation.updateMany({ where: { id: invitationId, familyId, status: 'PENDING' }, data: { status: 'EXPIRED', respondedAt: new Date() } });
  if (!count) throw AppError.notFound('Invitation not found');
}

async function liveInvitation(code: string) {
  const invitation = await prisma.familyInvitation.findUnique({
    where: { code: normalizeInviteCode(code) },
    include: { family: { select: { name: true } }, invitedBy: { select: { name: true } } },
  });
  if (!invitation) throw new AppError(404, 'Invitation not found', [], 'INVITE_NOT_FOUND');
  if (invitation.status === 'PENDING' && invitation.expiresAt <= new Date()) {
    await prisma.familyInvitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
    invitation.status = 'EXPIRED';
  }
  return invitation;
}

/** Public preview for the sign-up screen. The email is masked so a code alone reveals little. */
export async function previewInvitation(code: string) {
  const invitation = await liveInvitation(code);
  const [local, domain] = invitation.email.split('@');
  return {
    familyName: invitation.family.name,
    invitedBy: invitation.invitedBy.name,
    role: invitation.role,
    status: invitation.status,
    emailHint: `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export async function rejectInvitation(code: string) {
  const invitation = await liveInvitation(code);
  if (invitation.status !== 'PENDING') throw AppError.conflict(`This invitation is ${invitation.status.toLowerCase()}`);
  await prisma.familyInvitation.update({ where: { id: invitation.id }, data: { status: 'REJECTED', respondedAt: new Date() } });
  await notifyUsers([invitation.invitedById], {
    familyId: invitation.familyId,
    type: 'INVITATION',
    title: 'Invitation declined',
    message: `${invitation.email} declined the invitation to join ${invitation.family.name}.`,
    relatedEntityId: invitation.id,
  });
}

/** Single-use claim inside the sign-up transaction. The invite must be pending, unexpired and for this email. */
export async function claimInvitation(tx: Prisma.TransactionClient, code: string, email: string, userId: string, name: string) {
  const invitation = await tx.familyInvitation.findUnique({ where: { code: normalizeInviteCode(code) } });
  if (!invitation || invitation.status !== 'PENDING') throw new AppError(404, 'Invitation not found or already used', [], 'INVITE_NOT_FOUND');
  if (invitation.expiresAt <= new Date()) throw new AppError(410, 'This invitation has expired. Ask for a new one.', [], 'INVITATION_EXPIRED');
  if (invitation.email !== email) throw new AppError(403, 'This invitation was sent to a different email address', [], 'INVITE_WRONG_EMAIL');
  const memberId = invitation.role === 'CHILD' ? await childRecordFor(tx, invitation.familyId, invitation.memberId, name, userId) : null;
  const { count } = await tx.familyInvitation.updateMany({
    where: { id: invitation.id, status: 'PENDING' },
    data: { status: 'ACCEPTED', acceptedById: userId, respondedAt: new Date() },
  });
  if (!count) throw AppError.conflict('This invitation was already used');
  return { ...invitation, memberId };
}

/** The admin creates a login for a family member (e.g. the mother) with a username/email and password. */
export async function createMemberAccount(actor: Actor, familyId: string, input: MemberAccountInput) {
  assertOwnFamily(actor, familyId);
  assertAdmin(actor);
  const existing = await prisma.user.findUnique({ where: { email: input.login } });
  if (existing) throw AppError.conflict('This username or email is already used');
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const memberId = input.role === 'CHILD' ? await childRecordFor(tx, familyId, input.memberId, input.name) : null;
    return tx.user.create({
      data: {
        email: input.login,
        name: input.name,
        passwordHash,
        familyId,
        role: input.role,
        memberId,
        timezone: actor.timezone,
      },
    });
  });
  return (await listMembers(actor, familyId)).find((member) => member.id === user.id);
}

/** The admin sets a new password for a member (signs them out everywhere). */
export async function resetMemberPassword(actor: Actor, familyId: string, userId: string, password: string) {
  assertOwnFamily(actor, familyId);
  assertAdmin(actor);
  const { user, family } = await familyMemberUser(familyId, userId);
  if (user.id === family.ownerId && user.id !== actor.userId) throw AppError.forbidden("The owner's password can't be changed by others");
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12) } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

/**
 * Removes someone from the family: they lose access immediately (sessions revoked, devices unlinked)
 * and their open payments move to the admin so reminders keep reaching someone in the family.
 */
export async function removeMember(actor: Actor, familyId: string, userId: string) {
  assertOwnFamily(actor, familyId);
  assertAdmin(actor);
  const { user, family } = await familyMemberUser(familyId, userId);
  if (user.id === family.ownerId) throw AppError.forbidden('The family owner cannot be removed');
  if (user.id === actor.userId) throw AppError.badRequest('You cannot remove yourself');

  await prisma.$transaction([
    prisma.payment.updateMany({ where: { familyId, assigneeId: user.id }, data: { assigneeId: actor.userId } }),
    prisma.user.update({ where: { id: user.id }, data: { familyId: null, memberId: null } }),
    prisma.userPermission.deleteMany({ where: { userId: user.id } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.pushToken.deleteMany({ where: { userId: user.id } }),
  ]);
  await retimePaymentsForUser(actor.userId, actor.timezone);
}

export async function changeRole(actor: Actor, familyId: string, userId: string, input: RoleInput) {
  assertOwnFamily(actor, familyId);
  assertAdmin(actor);
  const { user, family } = await familyMemberUser(familyId, userId);
  if (user.id === family.ownerId) throw AppError.forbidden("The family owner's role cannot be changed");
  await prisma.$transaction(async (tx) => {
    const memberId = input.role === 'CHILD' ? await childRecordFor(tx, familyId, input.memberId ?? user.memberId, user.name, user.id) : null;
    await tx.user.update({ where: { id: user.id }, data: { role: input.role, memberId } });
  });
  await notifyUsers([user.id], {
    familyId,
    type: 'PERMISSION_CHANGE',
    title: 'Your role changed',
    message: `${family.name}: your role is now ${input.role.toLowerCase()}.`,
    relatedEntityId: user.id,
  });
  return (await listMembers(actor, familyId)).find((member) => member.id === user.id);
}

export async function getPermissions(actor: Actor, familyId: string) {
  assertOwnFamily(actor, familyId);
  assertAdmin(actor);
  const [family, users] = await Promise.all([
    prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { ownerId: true } }),
    prisma.user.findMany({ where: { familyId, isActive: true }, select: memberSelect, orderBy: { createdAt: 'asc' } }),
  ]);
  return {
    catalog: PERMISSION_KEYS.map((key) => ({ key, label: PERMISSION_LABELS[key] })),
    roleDefaults: ROLE_DEFAULTS,
    members: users.map((user) => {
      const granted = new Set(effectivePermissions(user.role, user.permissions));
      return {
        userId: user.id,
        name: user.name,
        role: user.role,
        // Admins always have everything; their switches are read-only.
        editable: user.role !== 'FATHER' && user.id !== family.ownerId,
        permissions: Object.fromEntries(PERMISSION_KEYS.map((key) => [key, granted.has(key)])) as Record<PermissionKey, boolean>,
      };
    }),
  };
}

export async function setPermissions(actor: Actor, familyId: string, userId: string, input: PermissionsInput) {
  assertOwnFamily(actor, familyId);
  assertAdmin(actor);
  const { user } = await familyMemberUser(familyId, userId);
  if (user.role === 'FATHER') throw AppError.badRequest('Admins always have every permission');

  const before = new Set(effectivePermissions(user.role, await prisma.userPermission.findMany({ where: { userId }, select: { key: true, granted: true } })));
  const entries = Object.entries(input.permissions) as [PermissionKey, boolean][];
  await prisma.$transaction(
    entries.map(([key, granted]) =>
      prisma.userPermission.upsert({
        where: { userId_key: { userId, key } },
        create: { userId, key, granted, updatedById: actor.userId },
        update: { granted, updatedById: actor.userId },
      }),
    ),
  );

  const changed = entries.filter(([key, granted]) => before.has(key) !== granted);
  if (changed.length) {
    await notifyUsers([user.id], {
      familyId,
      type: 'PERMISSION_CHANGE',
      title: 'Permissions updated',
      message: changed.map(([key, granted]) => `${PERMISSION_LABELS[key]}: ${granted ? 'ON' : 'OFF'}`).join(' · '),
      relatedEntityId: user.id,
    });
  }
  return (await getPermissions(actor, familyId)).members.find((member) => member.userId === userId);
}
