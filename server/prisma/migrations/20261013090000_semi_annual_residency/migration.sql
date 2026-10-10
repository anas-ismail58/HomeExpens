-- AlterEnum
ALTER TYPE "Frequency" ADD VALUE 'SEMI_ANNUAL' BEFORE 'YEARLY';

-- "Residency fees" household section for existing families (new families get it from the defaults).
INSERT INTO "subcategories" ("id", "categoryId", "key", "nameAr", "nameEn", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), c."id", 'residency', 'رسوم الإقامة', 'Residency fees', 1, NOW()
FROM "categories" c
WHERE c."key" = 'household'
  AND NOT EXISTS (SELECT 1 FROM "subcategories" s WHERE s."categoryId" = c."id" AND s."key" = 'residency');
