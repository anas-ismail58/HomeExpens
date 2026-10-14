import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { assertSuperAdmin, type Actor } from './access.service';
import { deleteFamilyAccount } from './account.service';
import { retimePaymentsForUser } from './payment.service';

const LIMIT = 500;

/** Every family on the platform, newest first, with its owner and size. */
export async function listAllFamilies(actor: Actor) {
  assertSuperAdmin(actor);
  const families = await prisma.family.findMany({
    select: {
      id: true,
      name: true,
      currency: true,
      createdAt: true,
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { users: { where: { isActive: true } }, members: { where: { deletedAt: null } }, expenses: { where: { deletedAt: null } }, payments: { where: { deletedAt: null } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIMIT,
  });
  return families.map(({ _count, createdAt, ...family }) => ({
    ...family,
    createdAt: createdAt.toISOString(),
    isCurrent: family.id === actor.familyId,
    counts: { users: _count.users, children: _count.members, expenses: _count.expenses, payments: _count.payments },
  }));
}

/** Every user account on the platform with the family they belong to. */
export async function listAllUsers(actor: Actor) {
  assertSuperAdmin(actor);
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      isSuperAdmin: true,
      lastLoginAt: true,
      createdAt: true,
      family: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIMIT,
  });
  return users.map((user) => ({ ...user, lastLoginAt: user.lastLoginAt?.toISOString() ?? null, createdAt: user.createdAt.toISOString() }));
}

async function editableUser(actor: Actor, id: string) {
  assertSuperAdmin(actor);
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, isSuperAdmin: true, familyId: true, ownedFamily: { select: { id: true, name: true, _count: { select: { users: true } } } } },
  });
  if (!user) throw AppError.notFound('User not found');
  if (user.isSuperAdmin && user.id !== actor.userId) throw AppError.forbidden('Another super admin can only be changed from the server');
  return user;
}

/** Super admin: change a user's name, login (email or username), password, or turn the account off/on. */
export async function updateUserAsAdmin(actor: Actor, id: string, input: { name?: string; email?: string; password?: string; isActive?: boolean }) {
  const user = await editableUser(actor, id);
  if (input.isActive === false && user.id === actor.userId) throw AppError.badRequest('You cannot turn off your own account');
  if (input.email && input.email !== user.email) {
    const taken = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (taken) throw AppError.conflict('This email or username is already used');
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email,
        isActive: input.isActive,
        ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}),
      },
    });
    // A new password or a turned-off account signs the user out everywhere.
    if (input.password || input.isActive === false) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  return (await listAllUsers(actor)).find((u) => u.id === id);
}

/**
 * Super admin: delete a user everywhere. A family member's records move to the family's father first. A
 * family owner can only be deleted when nobody else is left in the family, and the family goes with them.
 */
export async function deleteUserAsAdmin(actor: Actor, id: string) {
  const user = await editableUser(actor, id);
  if (user.id === actor.userId) throw AppError.badRequest('You cannot delete your own account');
  if (user.ownedFamily) {
    const others = await prisma.user.count({ where: { familyId: user.ownedFamily.id, id: { not: user.id } } });
    if (others) throw new AppError(409, `This user owns the family “${user.ownedFamily.name}” which still has ${others} other member(s). Remove them first.`, [], 'OWNER_HAS_MEMBERS');
    // Deleting the owner deletes the family (and everything in it) through the database's cascade.
    await prisma.user.delete({ where: { id } });
    return { deletedFamily: user.ownedFamily.name };
  }
  if (user.familyId) {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: user.familyId }, select: { ownerId: true } });
    await prisma.$transaction((tx) => deleteFamilyAccount(tx, id, family.ownerId));
    const heir = await prisma.user.findUniqueOrThrow({ where: { id: family.ownerId }, select: { timezone: true } });
    await retimePaymentsForUser(family.ownerId, heir.timezone);
    return { deletedFamily: null };
  }
  await prisma.user.delete({ where: { id } });
  return { deletedFamily: null };
}

