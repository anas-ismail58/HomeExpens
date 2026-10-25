-- CreateEnum
CREATE TYPE "DebtKind" AS ENUM ('LEND', 'BORROW', 'RECEIVE', 'PAY');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DEBT_REMINDER';

-- CreateTable
CREATE TABLE "debt_contacts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debt_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "kind" "DebtKind" NOT NULL,
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" "Currency" NOT NULL,
    "note" TEXT,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "reminderAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "expenseId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debt_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "debt_contacts_userId_deletedAt_idx" ON "debt_contacts"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "debt_entries_userId_contactId_idx" ON "debt_entries"("userId", "contactId");

-- CreateIndex
CREATE INDEX "debt_entries_reminderAt_remindedAt_idx" ON "debt_entries"("reminderAt", "remindedAt");

-- AddForeignKey
ALTER TABLE "debt_contacts" ADD CONSTRAINT "debt_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "debt_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
