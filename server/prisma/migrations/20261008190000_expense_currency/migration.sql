-- AlterTable
ALTER TABLE "expenses" ADD COLUMN "currency" "Currency",
ADD COLUMN "familyAmount" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "recurring_expenses" ADD COLUMN "currency" "Currency",
ADD COLUMN "familyAmount" DECIMAL(14,3);
