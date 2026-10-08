-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "teacherId" UUID;

-- CreateIndex
CREATE INDEX "payments_teacherId_idx" ON "payments"("teacherId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: reminders created with a lesson or a recurring fee take that lesson's teacher.
UPDATE "payments" p SET "teacherId" = e."teacherId"
FROM "expenses" e
WHERE p."expenseId" = e."id" AND e."teacherId" IS NOT NULL AND p."teacherId" IS NULL;

UPDATE "payments" p SET "teacherId" = r."teacherId"
FROM "recurring_expenses" r
WHERE p."recurringExpenseId" = r."id" AND r."teacherId" IS NOT NULL AND p."teacherId" IS NULL;
