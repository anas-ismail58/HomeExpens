import type { Prisma } from '@prisma/client';
import { DEFAULT_CATEGORIES, DEFAULT_PAYMENT_METHODS } from '../constants/defaults';

/**
 * Creates the default categories, subcategories and payment methods for a family.
 * Call inside a transaction (used by registration in Phase 6 and by the seed).
 */
export async function provisionFamilyDefaults(tx: Prisma.TransactionClient, familyId: string) {
  for (const [index, cat] of DEFAULT_CATEGORIES.entries()) {
    await tx.category.create({
      data: {
        familyId,
        key: cat.key,
        nameAr: cat.nameAr,
        nameEn: cat.nameEn,
        icon: cat.icon,
        color: cat.color,
        isDefault: true,
        sortOrder: index,
        subcategories: {
          create: cat.subcategories.map((sub, subIndex) => ({
            key: sub.key,
            nameAr: sub.nameAr,
            nameEn: sub.nameEn,
            sortOrder: subIndex,
          })),
        },
      },
    });
  }

  await tx.paymentMethod.createMany({
    data: DEFAULT_PAYMENT_METHODS.map((pm, index) => ({
      familyId,
      type: pm.type,
      nameAr: pm.nameAr,
      nameEn: pm.nameEn,
      isDefault: pm.isDefault ?? false,
      sortOrder: index,
    })),
  });
}
