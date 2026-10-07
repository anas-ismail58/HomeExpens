-- AlterTable
ALTER TABLE "payment_records" ADD COLUMN     "expenseId" UUID;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

