-- CreateEnum
CREATE TYPE "BankEntryKind" AS ENUM ('OPENING', 'DEPOSIT', 'WITHDRAW', 'ADJUST');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "countryId" UUID,
    "currency" "Currency" NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_entries" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "kind" "BankEntryKind" NOT NULL,
    "amount" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_userId_deletedAt_idx" ON "bank_accounts"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "bank_entries_accountId_date_idx" ON "bank_entries"("accountId", "date");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_entries" ADD CONSTRAINT "bank_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
