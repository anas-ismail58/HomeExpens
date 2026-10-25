import { createHash } from 'node:crypto';
import type { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { firebaseConfigured, firebasePasswordMatches, redeemFirebaseResetCode } from './firebase.service';
import { notifyUsers } from './notification.service';

const MAX_ATTEMPTS = 5;
const codeHash = (userId: string, code: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex');
/** Marks a reset token row as "a Firebase link was sent" rather than an emailed code. */
const LINK_MARK = 'firebase-link:';

/** How the person gets back in: the father resets it, or (the father's own account) the app admin does. */
export type ResetMethod = 'link' | 'code' | 'father' | 'admin';

/**
 * "Forgot password". No email is sent. What happens:
 * - no such account (or a disabled one): a 404 with NO_ACCOUNT, so the person knows to check it or sign up;
 * - a family member (email or username): the father is notified and sets a new password from the Family screen;
 * - the family admin (father) or a super admin: there is nobody in the family to ask, so the app tells them
 *   to contact the app admin.
 */
export async function requestPasswordReset(login: string): Promise<ResetMethod> {
  const user = await prisma.user.findUnique({ where: { email: login }, include: { family: { select: { id: true, ownerId: true } } } });
  if (!user || !user.isActive) throw new AppError(404, 'No account uses this email or username.', [], 'NO_ACCOUNT');
  if (user.isSuperAdmin || !user.family || user.family.ownerId === user.id || user.role === 'FATHER') return 'admin';

  // Ask the father (and any co-admin) once every 10 minutes at most.
  const already = await prisma.notification.findFirst({
    where: { type: 'PASSWORD_RESET_REQUEST', relatedEntityId: user.id, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
  });
  if (already) return 'father';
  const admins = await prisma.user.findMany({ where: { familyId: user.family.id, role: 'FATHER', isActive: true }, select: { id: true } });
  await notifyUsers(admins.map((a) => a.id), {
    familyId: user.family.id,
    type: 'PASSWORD_RESET_REQUEST',
    title: 'طلب إعادة تعيين كلمة المرور',
    message: `${user.name} نسي كلمة المرور. افتح العائلة واختر «${user.name}» لتعيين كلمة مرور جديدة.`,
    relatedEntityId: user.id,
  });
  return 'father';
}

/** Sets a new password from a Firebase reset link (its one-time code); signs the account out everywhere. */
export async function resetPasswordWithLink(oobCode: string, password: string) {
  const email = await redeemFirebaseResetCode(oobCode);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || user.isSuperAdmin) throw new AppError(400, 'This link is wrong, used or expired. Ask for a new one.', [], 'INVALID_RESET_LINK');
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12) } }),
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  return email;
}

/**
 * Sign-in with a password that doesn't match ours: when this account asked for a Firebase reset link in the
 * last 7 days and Firebase accepts the password (set on Firebase's own reset page), it becomes our password.
 * Other sessions are signed out, as with any reset. Returns whether the password was adopted.
 */
export async function adoptFirebasePassword(user: User, password: string) {
  if (!firebaseConfigured() || user.isSuperAdmin) return false;
  const mark = await prisma.passwordResetToken.findFirst({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() }, tokenHash: { startsWith: LINK_MARK } } });
  if (!mark || !(await firebasePasswordMatches(user.email, password))) return false;
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12) } }),
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  return true;
}

/** Sets a new password with the emailed code; signs the account out everywhere. */
export async function resetPasswordWithCode(login: string, code: string, password: string) {
  const invalid = () => new AppError(400, 'The code is wrong or has expired. Request a new one.', [], 'INVALID_RESET_CODE');
  const user = await prisma.user.findUnique({ where: { email: login } });
  if (!user || !user.isActive || user.isSuperAdmin) throw invalid();
  const token = await prisma.passwordResetToken.findFirst({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!token) throw invalid();
  if (token.tokenHash !== codeHash(user.id, code)) {
    const attempts = token.attempts + 1;
    await prisma.passwordResetToken.update({ where: { id: token.id }, data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { usedAt: new Date() } : {}) } });
    throw invalid();
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12) } }),
    prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}
