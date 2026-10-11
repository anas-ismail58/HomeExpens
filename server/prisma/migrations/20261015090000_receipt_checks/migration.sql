-- CreateEnum
CREATE TYPE "ReceiptCheck" AS ENUM ('MATCH', 'MISMATCH', 'UNREADABLE', 'DUPLICATE', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "sha256" TEXT;

-- AlterTable
ALTER TABLE "payment_records" ADD COLUMN     "overriddenById" UUID,
ADD COLUMN     "receiptAmount" DECIMAL(14,3),
ADD COLUMN     "receiptCheck" "ReceiptCheck",
ADD COLUMN     "receiptCurrency" TEXT;

-- CreateTable
CREATE TABLE "receipt_scans" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "ReceiptCheck" NOT NULL,
    "reason" TEXT,
    "amount" DECIMAL(14,3),
    "currency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receipt_scans_familyId_idx" ON "receipt_scans"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_scans_paymentId_sha256_key" ON "receipt_scans"("paymentId", "sha256");

-- CreateIndex
CREATE INDEX "attachments_familyId_sha256_idx" ON "attachments"("familyId", "sha256");
