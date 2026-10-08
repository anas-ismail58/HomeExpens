-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('TOPUP', 'SPEND');

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "holderId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_spenders" (
    "walletId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "wallet_spenders_pkey" PRIMARY KEY ("walletId","userId")
);

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "amount" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "date" DATE NOT NULL,
    "createdById" UUID,
    "expenseId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallets_familyId_isActive_idx" ON "wallets"("familyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_expenseId_key" ON "wallet_entries"("expenseId");

-- CreateIndex
CREATE INDEX "wallet_entries_walletId_date_idx" ON "wallet_entries"("walletId", "date");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_spenders" ADD CONSTRAINT "wallet_spenders_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_spenders" ADD CONSTRAINT "wallet_spenders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

