/* eslint-disable no-console */
/**
 * Grants or revokes super admin. Deliberately not exposed through the API.
 *   npm run superadmin -- someone@example.com            grant to an existing account
 *   npm run superadmin -- someone@example.com --create   create the account if missing (prints a random password)
 *   npm run superadmin -- someone@example.com --revoke   revoke
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/prisma';

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
    console.log(`${email} is now a super admin. Sign in with its existing password.`);
    return;
  }

  if (!flags.includes('--create')) {
    throw new Error(`No account with the email ${email}. Add --create to create it as a new super admin account.`);
  }
  // No family of its own: the super admin starts in the oldest family and switches from the admin page.
  const password = randomBytes(12).toString('base64url');
  await prisma.user.create({
    data: { email, name: 'Super Admin', passwordHash: await bcrypt.hash(password, 12), isSuperAdmin: true },
  });
  console.log(`Created super admin ${email}`);
  console.log(`Password: ${password}`);
  console.log('Shown only once. Store it somewhere safe.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
