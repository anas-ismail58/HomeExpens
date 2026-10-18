-- CreateTable
CREATE TABLE "payment_items" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "subject" TEXT,
    "date" DATE,
    "amount" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_items_paymentId_idx" ON "payment_items"("paymentId");

-- AddForeignKey
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

