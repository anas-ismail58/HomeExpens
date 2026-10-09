import { createHash, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { canSendMail, sendMail } from './mail.service';
import { notifyUsers } from './notification.service';

const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const codeHash = (userId: string, code: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex');

/**
 * "Forgot password". The reply never says whether the account exists. What happens:
 * - an account with an email (and email configured): a 6-digit code is emailed, valid 15 minutes;
 * - a family member without email (a username the father created): the father is notified and sets a
 *   new password from the Family screen.
 * Super admin accounts are recovered from the server command line, never from here.
 */
export async function requestPasswordReset(login: string) {
  const user = await prisma.user.findUnique({ where: { email: login }, include: { family: { select: { id: true, ownerId: true } } } });
  if (!user || !user.isActive || user.isSuperAdmin) return;

  if (login.includes('@') && canSendMail()) {
    // One code a minute is plenty; repeated taps don't flood the inbox.
    const recent = await prisma.passwordResetToken.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent) return;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: codeHash(user.id, code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) } }),
    ]);
    try {
      await sendMail(
        user.email,
        `رمز إعادة تعيين كلمة المرور: ${code}`,
        `رمز إعادة تعيين كلمة المرور في مصروف العائلة: ${code}\nصالح لمدة ${CODE_MINUTES} دقيقة. إذا لم تطلبه فتجاهل هذه الرسالة.\n\nYour Family Expenses password reset code: ${code} (valid ${CODE_MINUTES} minutes).`,
        `<div dir="rtl" style="font-family:sans-serif;font-size:16px;line-height:1.6">
          <p>رمز إعادة تعيين كلمة المرور في <b>مصروف العائلة</b>:</p>
          <p style="font-size:32px;font-weight:800;letter-spacing:6px">${code}</p>
          <p>صالح لمدة ${CODE_MINUTES} دقيقة. إذا لم تطلبه فتجاهل هذه الرسالة.</p>
          <p dir="ltr" style="color:#666">Your Family Expenses password reset code (valid ${CODE_MINUTES} minutes).</p>
        </div>`,
      );
      return;
    } catch (err) {
      console.error('Password reset email failed:', err);
      // Fall through: a member can still get help from the father.
    }
  }

  if (!user.family || user.family.ownerId === user.id || user.role === 'FATHER') return;
  // Ask the father (and any co-admin) once every 10 minutes at most.
  const already = await prisma.notification.findFirst({
    where: { type: 'PASSWORD_RESET_REQUEST', relatedEntityId: user.id, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
  });
  if (already) return;
  const admins = await prisma.user.findMany({ where: { familyId: user.family.id, role: 'FATHER', isActive: true }, select: { id: true } });
  await notifyUsers(admins.map((a) => a.id), {
    familyId: user.family.id,
    type: 'PASSWORD_RESET_REQUEST',
    title: 'طلب إعادة تعيين كلمة المرور',
    message: `${user.name} نسي كلمة المرور. افتح العائلة واختر «${user.name}» لتعيين كلمة مرور جديدة.`,
    relatedEntityId: user.id,
  });
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
