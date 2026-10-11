-- AlterTable
ALTER TABLE "payment_records" ADD COLUMN     "receiptChecks" JSONB;

-- AlterTable
ALTER TABLE "receipt_scans" ADD COLUMN     "reading" JSONB,
ADD COLUMN     "teacherName" TEXT;
