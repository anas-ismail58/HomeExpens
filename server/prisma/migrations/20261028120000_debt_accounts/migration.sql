-- CreateEnum
CREATE TYPE "DebtAccount" AS ENUM ('SALARY', 'PRIVATE', 'BUDGET', 'OTHER');

-- AlterTable
ALTER TABLE "debt_entries" ADD COLUMN     "account" "DebtAccount" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "privateEntryId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "debt_entries_privateEntryId_key" ON "debt_entries"("privateEntryId");

-- AddForeignKey
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_privateEntryId_fkey" FOREIGN KEY ("privateEntryId") REFERENCES "private_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Loans recorded as money in of kind "borrowed" went into the household budget.
UPDATE "debt_entries" d SET "account" = 'BUDGET' FROM "incomes" i WHERE i."debtEntryId" = d."id";
