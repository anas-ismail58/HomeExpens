import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { Family, Prisma, User } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { provisionFamilyDefaults } from './familyDefaults.service';
import { assertSuperAdmin, effectivePermissions, type Actor } from './access.service';
import { claimInvitation } from './family.service';
import { decryptSecret, matchTotp } from './totp.service';
import { notifyUsers } from './notification.service';
import { retimePaymentsForUser } from './payment.service';
import { AppError } from '../utils/AppError';
import type { LoginInput, ProfileInput, RegisterInput } from '../validators/auth.validator';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const userInclude = { permissions: { select: { key: true, granted: true } } } satisfies Prisma.UserInclude;
type SessionUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function createAccessToken(user: User, family: Family) {
  return jwt.sign({ familyId: family.id }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

function createRefreshToken(user: User, family: Family, tokenId: string) {
  return jwt.sign({ familyId: family.id }, env.JWT_REFRESH_SECRET, {
    subject: user.id,
    jwtid: tokenId,
    expiresIn: `${env.JWT_REFRESH_EXPIRES_DAYS}d` as SignOptions['expiresIn'],
  });
}

/** Public profile of the signed-in user: identity, role and effective permissions. */
export function accountDto(user: SessionUser, family: Family) {
  // A super admin acts as the admin of whichever family they are in.
  const role = user.isSuperAdmin ? 'FATHER' : user.role;
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      isAdmin: role === 'FATHER',
      isSuperAdmin: user.isSuperAdmin,
      memberId: role === 'CHILD' ? user.memberId : null,
      timezone: user.timezone,
      profileImage: user.profileImage,
      permissions: effectivePermissions(role, user.permissions),
    },
    family: { id: family.id, name: family.name, currency: family.currency, timezone: family.timezone, ownerId: family.ownerId },
  };
}

function sessionResponse(user: SessionUser, family: Family, accessToken: string, refreshToken: string) {
  return { accessToken, refreshToken, ...accountDto(user, family) };
}

async function persistRefreshToken(userId: string, tokenId: string, refreshToken: string) {
  await prisma.refreshToken.create({
    data: {
      id: tokenId,
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_EXPIRES_DAYS * 86_400_000),
    },
  });
}

async function issueSession(user: SessionUser, family: Family) {
  const tokenId = randomUUID();
  const accessToken = createAccessToken(user, family);
  const refreshToken = createRefreshToken(user, family, tokenId);
  await persistRefreshToken(user.id, tokenId, refreshToken);
  return sessionResponse(user, family, accessToken, refreshToken);
}

export async function registerAccount(input: RegisterInput) {
  if (input.inviteCode) return joinWithInvitation(input, input.inviteCode);

  const passwordHash = await bcrypt.hash(input.password, 12);
  const { user, family } = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email: input.email, name: input.name, passwordHash, role: 'FATHER', timezone: input.timezone },
    });
    const family = await tx.family.create({
      data: { ownerId: created.id, name: input.familyName!, timezone: input.timezone },
    });
    await provisionFamilyDefaults(tx, family.id);
    const user = await tx.user.update({ where: { id: created.id }, data: { familyId: family.id }, include: userInclude });
    return { user, family };
  });
  return issueSession(user, family);
}

/**
 * Accepts an invitation as part of sign-up. A brand-new email creates the account; an existing account
 * that was removed from its family can rejoin with its current password.
 */
async function joinWithInvitation(input: RegisterInput, code: string) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    if (existing.familyId) throw new AppError(409, 'This email already belongs to a family. Sign in instead.', [], 'EMAIL_HAS_FAMILY');
    if (!(await bcrypt.compare(input.password, existing.passwordHash))) throw AppError.unauthorized('Email or password is incorrect');
  }
  const passwordHash = existing ? undefined : await bcrypt.hash(input.password, 12);

  const { user, family, inviterId } = await prisma.$transaction(async (tx) => {
    const userId = existing?.id ?? randomUUID();
    if (!existing) {
      await tx.user.create({ data: { id: userId, email: input.email, name: input.name, passwordHash: passwordHash!, role: 'MOTHER', timezone: input.timezone } });
    }
    const invitation = await claimInvitation(tx, code, input.email, userId, existing?.name ?? input.name);
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        familyId: invitation.familyId,
        role: invitation.role,
        memberId: invitation.role === 'CHILD' ? invitation.memberId : null,
        isActive: true,
        ...(input.timezone ? { timezone: input.timezone } : {}),
      },
      include: userInclude,
    });
    // A rejoining account starts from the role defaults again.
    await tx.userPermission.deleteMany({ where: { userId } });
    const family = await tx.family.findUniqueOrThrow({ where: { id: invitation.familyId } });
    return { user: { ...user, permissions: [] }, family, inviterId: invitation.invitedById };
  });

  await notifyUsers([inviterId], {
    familyId: family.id,
    type: 'FAMILY_EVENT',
    title: 'Family member joined',
    message: `${user.name} accepted your invitation and joined ${family.name}.`,
    relatedEntityId: user.id,
  });
  return issueSession(user, family);
}

export async function loginAccount(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email }, include: { family: true } });
  if (!user || !user.isActive || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw AppError.unauthorized('Email or password is incorrect');
  }
  if (user.isSuperAdmin) return startTwoFactor(user);
  if (!user.family) throw AppError.forbidden('This account is no longer part of a family. Ask the family admin for a new invitation.');
  if (input.as === 'FATHER' && user.role !== 'FATHER') throw new AppError(403, 'This is not a father (admin) account. Choose “Family member” to sign in.', [], 'NOT_FATHER_ACCOUNT');
  if (input.as === 'MEMBER' && user.role === 'FATHER') throw new AppError(403, 'This is the father’s (admin) account. Choose “Father” to sign in.', [], 'FATHER_ACCOUNT');
  const updatedUser = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() }, include: userInclude });
  return issueSession(updatedUser, user.family);
}

const OTP_AUDIENCE = 'otp-challenge';

/**
 * Super admin, step 1 of 2: the password was right, so hand back a short-lived challenge instead of a
 * session. Without an enrolled authenticator the account can't sign in at all.
 */
function startTwoFactor(user: User) {
  if (!user.totpSecret) {
    throw new AppError(403, 'Two-factor authentication is not set up for this account. Run: npm run superadmin -- <email> --2fa', [], 'TWO_FACTOR_SETUP_REQUIRED');
  }
  const challenge = jwt.sign({}, env.JWT_SECRET, { subject: user.id, audience: OTP_AUDIENCE, expiresIn: '5m' });
  return { twoFactorRequired: true as const, challenge };
}

/** Super admin, step 2 of 2: the authenticator code turns the challenge into a session. */
export async function completeTwoFactor(challenge: string, code: string) {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(challenge, env.JWT_SECRET, { audience: OTP_AUDIENCE }) as JwtPayload;
  } catch {
    throw new AppError(401, 'The sign-in took too long. Enter your email and password again.', [], 'CHALLENGE_EXPIRED');
  }
  const user = typeof payload.sub === 'string' ? await prisma.user.findUnique({ where: { id: payload.sub }, include: { family: true } }) : null;
  if (!user || !user.isActive || !user.isSuperAdmin || !user.totpSecret) throw AppError.unauthorized('Email or password is incorrect');

  const step = matchTotp(decryptSecret(user.totpSecret), code, user.totpLastStep);
  // Claim the step atomically so the same code can't be used twice, even by parallel requests.
  const claimed =
    step === null
      ? 0
      : (
          await prisma.user.updateMany({
            where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
            data: { totpLastStep: step, lastLoginAt: new Date() },
          })
        ).count;
  if (!claimed) throw new AppError(401, 'The code is incorrect or already used', [], 'INVALID_OTP');

  // Starts in their own family, or the oldest one if they have none; they switch from the admin page.
  const family = user.family ?? (await prisma.family.findFirst({ orderBy: { createdAt: 'asc' } }));
  if (!family) throw AppError.forbidden('There are no families yet.');
  const sessionUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude });
  return issueSession(sessionUser, family);
}

export async function rotateRefreshToken(token: string) {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }

  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
    throw AppError.unauthorized('Invalid refresh token');
  }

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { family: true, ...userInclude } } },
  });
  // A super admin keeps the family they switched into; everyone else is pinned to their own.
  const family =
    existing?.user.isSuperAdmin && typeof payload.familyId === 'string'
      ? await prisma.family.findUnique({ where: { id: payload.familyId } })
      : existing?.user.family;
  if (!existing || existing.revokedAt || existing.expiresAt <= new Date() || !existing.user.isActive || !family) {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }

  const nextId = randomUUID();
  const refreshToken = createRefreshToken(existing.user, family, nextId);
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRES_DAYS * 86_400_000);
  await prisma.$transaction(async (tx) => {
    const revoked = await tx.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date(), replacedById: nextId },
    });
    if (revoked.count !== 1) throw AppError.unauthorized('Refresh token was already used');
    await tx.refreshToken.create({
      data: { id: nextId, userId: existing.user.id, tokenHash: hashToken(refreshToken), expiresAt },
    });
  });

  return sessionResponse(existing.user, family, createAccessToken(existing.user, family), refreshToken);
}

export async function revokeRefreshToken(token: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getAccount(actor: Actor) {
  const [user, family] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, include: userInclude }),
    prisma.family.findUnique({ where: { id: actor.familyId } }),
  ]);
  if (!family) throw AppError.unauthorized();
  return accountDto(user, family);
}

/**
 * Super admin: moves the session into another family without a password. The current refresh token
 * is revoked so only the new session stays valid.
 */
export async function switchFamily(actor: Actor, familyId: string, currentRefreshToken?: string) {
  assertSuperAdmin(actor);
  const [user, family] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, include: userInclude }),
    prisma.family.findUnique({ where: { id: familyId } }),
  ]);
  if (!family) throw AppError.notFound('Family not found');
  if (currentRefreshToken) {
    await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(currentRefreshToken), userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  console.info(`[super-admin] ${user.email} entered family ${family.id} (${family.name})`);
  return issueSession(user, family);
}

export async function updateProfile(actor: Actor, input: ProfileInput) {
  await prisma.user.update({
    where: { id: actor.userId },
    data: { name: input.name, timezone: input.timezone, profileImage: input.profileImage },
  });
  // Due times are wall-clock times in the assignee's zone: re-anchor their payments.
  if (input.timezone && input.timezone !== actor.timezone) await retimePaymentsForUser(actor.userId, input.timezone);
  return getAccount(actor);
}
