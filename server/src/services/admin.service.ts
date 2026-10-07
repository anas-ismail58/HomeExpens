import { prisma } from '../config/prisma';
import { assertSuperAdmin, type Actor } from './access.service';

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
