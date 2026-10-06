import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { Family, User } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { provisionFamilyDefaults } from './familyDefaults.service';
import { AppError } from '../utils/AppError';
import type { LoginInput, RegisterInput } from '../validators/auth.validator';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

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

function sessionResponse(user: User, family: Family, accessToken: string, refreshToken: string) {
  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email },
    family: { id: family.id, name: family.name, currency: family.currency, timezone: family.timezone },
  };
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

async function issueSession(user: User, family: Family) {
  const tokenId = randomUUID();
  const accessToken = createAccessToken(user, family);
  const refreshToken = createRefreshToken(user, family, tokenId);
  await persistRefreshToken(user.id, tokenId, refreshToken);
  return sessionResponse(user, family, accessToken, refreshToken);
}

export async function registerAccount(input: RegisterInput) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const { user, family } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, passwordHash },
    });
    const family = await tx.family.create({
      data: { ownerId: user.id, name: input.familyName },
    });
    await provisionFamilyDefaults(tx, family.id);
    return { user, family };
  });
  return issueSession(user, family);
}

export async function loginAccount(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email }, include: { family: true } });
  if (!user || !user.isActive || !user.family || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw AppError.unauthorized('Email or password is incorrect');
  }
  const updatedUser = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return issueSession(updatedUser, user.family);
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
    include: { user: { include: { family: true } } },
  });
  const family = existing?.user.family;
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

export async function getAccount(userId: string, familyId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true, family: { id: familyId } },
    include: { family: true },
  });
  if (!user?.family) throw AppError.unauthorized();
  return {
    user: { id: user.id, name: user.name, email: user.email },
    family: { id: user.family.id, name: user.family.name, currency: user.family.currency, timezone: user.family.timezone },
  };
}