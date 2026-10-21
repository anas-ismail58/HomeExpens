import { createHash, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { firebaseConfigured, redeemFirebaseResetCode, sendFirebaseResetLink } from './firebase.service';
import { canSendMail, sendMail } from './mail.service';
import { notifyUsers } from './notification.service';

const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const codeHash = (userId: string, code: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex');

/** How the person gets back in: a Firebase email link, an emailed 6-digit code, or the father resets it. */
export type ResetMethod = 'link' | 'code' | 'father';

/**
 * "Forgot password". What happens:
 * - no such account (or a disabled one): a 404 with NO_ACCOUNT, so the person knows to check it or sign up;
 * - an account with an email: Firebase emails a reset link when FIREBASE_API_KEY is set, otherwise a 6-digit
 *   code is emailed (Resend or SMTP), valid 15 minutes;
 * - a family member without email (a username the father created), or whose email couldn't be sent: the
 *   father is notified and sets a new password from the Family screen;
 * - a father whose email couldn't be sent: a 503 with EMAIL_UNAVAILABLE.
 * Super admin accounts are recovered from the server command line, never from here.
 */
export async function requestPasswordReset(login: string): Promise<ResetMethod> {
  const user = await prisma.user.findUnique({ where: { email: login }, include: { family: { select: { id: true, ownerId: true, language: true } } } });
  if (!user || !user.isActive) throw new AppError(404, 'No account uses this email or username.', [], 'NO_ACCOUNT');
  const isEmail = login.includes('@');
  if (user.isSuperAdmin) return firebaseConfigured() ? 'link' : 'code';

  if (isEmail && firebaseConfigured()) {
    try {
      await sendFirebaseResetLink(user.email, user.family?.language ?? 'ar');
      return 'link';
    } catch (err) {
      console.error('Password reset link failed:', err);
      // Fall through: a member can still get help from the father.
    }
  } else if (isEmail && canSendMail()) {
    // One code a minute is plenty; repeated taps don't flood the inbox.
    const recent = await prisma.passwordResetToken.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent) return 'code';
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
      return 'code';
    } catch (err) {
      console.error('Password reset email failed:', err);
    }
  } else if (isEmail) {
    console.warn('Password reset not emailed: no FIREBASE_API_KEY, RESEND_API_KEY or SMTP_* configured');
  }

  if (!user.family || user.family.ownerId === user.id || user.role === 'FATHER') {
    if (isEmail) throw new AppError(503, "The reset email can't be sent right now. Try again later.", [], 'EMAIL_UNAVAILABLE');
    return 'father';
  }
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
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  return email;
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
