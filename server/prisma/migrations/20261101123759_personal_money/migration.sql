-- AlterEnum
ALTER TYPE "VaultSource" ADD VALUE 'PERSONAL';

-- CreateTable
CREATE TABLE "personal_transfers" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "countryId" UUID,
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" "Currency" NOT NULL,
    "note" TEXT,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_limits" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "month" DATE NOT NULL,
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" "Currency" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_transfers_userId_date_idx" ON "personal_transfers"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "personal_limits_userId_month_key" ON "personal_limits"("userId", "month");

-- AddForeignKey
ALTER TABLE "personal_transfers" ADD CONSTRAINT "personal_transfers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_limits" ADD CONSTRAINT "personal_limits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
