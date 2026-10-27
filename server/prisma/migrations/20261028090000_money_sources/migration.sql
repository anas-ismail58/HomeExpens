-- CreateEnum
CREATE TYPE "IncomeKind" AS ENUM ('SALARY', 'PERSONAL', 'HOUSEHOLD', 'FROM_PERSON', 'BORROWED', 'OTHER');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "funding" JSONB;

-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "debtEntryId" UUID,
ADD COLUMN     "kind" "IncomeKind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "privateEntryId" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "funding" JSONB;

-- AlterTable
ALTER TABLE "recurring_expenses" ADD COLUMN     "funding" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "incomes_privateEntryId_key" ON "incomes"("privateEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "incomes_debtEntryId_key" ON "incomes"("debtEntryId");

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_privateEntryId_fkey" FOREIGN KEY ("privateEntryId") REFERENCES "private_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_debtEntryId_fkey" FOREIGN KEY ("debtEntryId") REFERENCES "debt_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

