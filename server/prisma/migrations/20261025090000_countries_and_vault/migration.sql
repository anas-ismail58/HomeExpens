-- CreateEnum
CREATE TYPE "VaultDirection" AS ENUM ('DEPOSIT', 'WITHDRAW');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "countryId" UUID;

-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "countryId" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "countryId" UUID;

-- AlterTable
ALTER TABLE "recurring_expenses" ADD COLUMN     "countryId" UUID;

-- AlterTable
ALTER TABLE "recurring_incomes" ADD COLUMN     "countryId" UUID;

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "countryId" UUID;

-- CreateTable
CREATE TABLE "countries" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "direction" "VaultDirection" NOT NULL,
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" "Currency" NOT NULL,
    "note" TEXT,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "keyHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "vault_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "countries_familyId_code_key" ON "countries"("familyId", "code");

-- CreateIndex
CREATE INDEX "vault_entries_userId_date_idx" ON "vault_entries"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "vault_devices_keyHash_key" ON "vault_devices"("keyHash");

-- CreateIndex
CREATE INDEX "vault_devices_userId_idx" ON "vault_devices"("userId");

-- CreateIndex
CREATE INDEX "expenses_familyId_countryId_idx" ON "expenses"("familyId", "countryId");

-- CreateIndex
CREATE INDEX "incomes_familyId_countryId_idx" ON "incomes"("familyId", "countryId");

-- CreateIndex
CREATE INDEX "payments_familyId_countryId_idx" ON "payments"("familyId", "countryId");

-- CreateIndex
CREATE INDEX "recurring_expenses_familyId_countryId_idx" ON "recurring_expenses"("familyId", "countryId");

-- CreateIndex
CREATE INDEX "recurring_incomes_familyId_countryId_idx" ON "recurring_incomes"("familyId", "countryId");

-- CreateIndex
CREATE INDEX "wallets_familyId_countryId_idx" ON "wallets"("familyId", "countryId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_incomes" ADD CONSTRAINT "recurring_incomes_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "countries" ADD CONSTRAINT "countries_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_entries" ADD CONSTRAINT "vault_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_devices" ADD CONSTRAINT "vault_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every family gets one default country matching its currency, and all its existing money
-- records go there. Their stored amounts are in the family currency, which is that country's currency,
-- so nothing changes in any total.
INSERT INTO "countries" ("id", "familyId", "code", "currency", "isDefault", "sortOrder")
SELECT gen_random_uuid(), f."id",
  CASE f."currency"::text
    WHEN 'SAR' THEN 'SA' WHEN 'EGP' THEN 'EG' WHEN 'AED' THEN 'AE' WHEN 'KWD' THEN 'KW'
    WHEN 'QAR' THEN 'QA' WHEN 'BHD' THEN 'BH' WHEN 'USD' THEN 'US' ELSE 'EU' END,
  f."currency", true, 0
FROM "families" f;

UPDATE "expenses" t SET "countryId" = c."id" FROM "countries" c WHERE c."familyId" = t."familyId" AND c."isDefault";
UPDATE "incomes" t SET "countryId" = c."id" FROM "countries" c WHERE c."familyId" = t."familyId" AND c."isDefault";
UPDATE "recurring_expenses" t SET "countryId" = c."id" FROM "countries" c WHERE c."familyId" = t."familyId" AND c."isDefault";
UPDATE "recurring_incomes" t SET "countryId" = c."id" FROM "countries" c WHERE c."familyId" = t."familyId" AND c."isDefault";
UPDATE "payments" t SET "countryId" = c."id" FROM "countries" c WHERE c."familyId" = t."familyId" AND c."isDefault";
UPDATE "wallets" t SET "countryId" = c."id" FROM "countries" c WHERE c."familyId" = t."familyId" AND c."isDefault";
