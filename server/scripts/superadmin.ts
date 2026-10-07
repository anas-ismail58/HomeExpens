/* eslint-disable no-console */
/**
 * Grants or revokes super admin. Deliberately not exposed through the API.
 *   npm run superadmin -- someone@example.com            grant to an existing account
 *   npm run superadmin -- someone@example.com --create   create the account if missing (prints a random password)
 *   npm run superadmin -- someone@example.com --2fa      reset two-factor (e.g. a lost phone)
 *   npm run superadmin -- someone@example.com --revoke   revoke
 * Granting or creating sets up two-factor too; a super admin can't sign in without it.
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/prisma';
import { enrollTotp } from '../src/services/totp.service';

async function printTwoFactor(userId: string) {
  const { secret, uri } = await enrollTotp(userId);
  console.log('');
  console.log('Two-factor: in Google Authenticator / Microsoft Authenticator / Authy choose');
  console.log('"Enter a setup key" (time based) and type this key:');
  console.log(`  ${secret.match(/.{1,4}/g)!.join(' ')}`);
  console.log(`Or open this link on the phone: ${uri}`);
  console.log('Any previous authenticator entry for this account stops working.');
}

async function main() {
  const [rawEmail, ...flags] = process.argv.slice(2);
  if (!rawEmail) throw new Error('Usage: npm run superadmin -- <email> [--create | --revoke]');
  const email = rawEmail.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (flags.includes('--revoke')) {
    if (!existing) throw new Error(`No account with the email ${email}.`);
    await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data: { isSuperAdmin: false } }),
      prisma.refreshToken.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    console.log(`${email} is no longer a super admin.`);
    return;
  }

  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { isSuperAdmin: true, isActive: true } });
    console.log(`${email} is a super admin. Sign in with its existing password.`);
    if (!existing.totpSecret || flags.includes('--2fa')) await printTwoFactor(existing.id);
    return;
  }

  if (!flags.includes('--create')) {
    throw new Error(`No account with the email ${email}. Add --create to create it as a new super admin account.`);
  }
  // No family of its own: the super admin starts in the oldest family and switches from the admin page.
  const password = randomBytes(12).toString('base64url');
  const user = await prisma.user.create({
    data: { email, name: 'Super Admin', passwordHash: await bcrypt.hash(password, 12), isSuperAdmin: true },
  });
  console.log(`Created super admin ${email}`);
  console.log(`Password: ${password}`);
  await printTwoFactor(user.id);
  console.log('Shown only once. Store them somewhere safe.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
