-- CreateEnum
CREATE TYPE "PrivateDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "private_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "direction" "PrivateDirection" NOT NULL,
    "amount" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "private_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "private_entries_userId_date_idx" ON "private_entries"("userId", "date");

-- AddForeignKey
ALTER TABLE "private_entries" ADD CONSTRAINT "private_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

