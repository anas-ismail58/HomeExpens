import type { Prisma } from '@prisma/client';

/**
 * Deletes a family member's account completely, so it doesn't linger as a login with no family.
 * Family records it created or held are handed to `heirId` (the father) first, because some of them
 * would otherwise be deleted with the account (payments, allowances, invitations). Its own sessions,
 * permissions, notifications, devices and private money go with it; other records keep their history
 * with the author removed.
 */
export async function deleteFamilyAccount(tx: Prisma.TransactionClient, userId: string, heirId: string) {
  await tx.payment.updateMany({ where: { assigneeId: userId }, data: { assigneeId: heirId } });
  await tx.payment.updateMany({ where: { createdById: userId }, data: { createdById: heirId } });
  await tx.wallet.updateMany({ where: { holderId: userId }, data: { holderId: heirId } });
  await tx.wallet.updateMany({ where: { createdById: userId }, data: { createdById: heirId } });
  await tx.familyInvitation.updateMany({ where: { invitedById: userId }, data: { invitedById: heirId } });
  await tx.user.delete({ where: { id: userId } });
}
