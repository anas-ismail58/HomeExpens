-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('LESSON', 'RENT', 'BILL', 'OTHER');

-- CreateEnum
CREATE TYPE "ReminderRepeat" AS ENUM ('MONTHLY', 'WEEKLY', 'ONCE');

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "memberId" UUID,
    "title" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL DEFAULT 'OTHER',
    "amount" DECIMAL(14,3),
    "repeat" "ReminderRepeat" NOT NULL DEFAULT 'MONTHLY',
    "dayOfMonth" INTEGER,
    "weekday" INTEGER,
    "date" DATE,
    "time" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminders_familyId_isActive_idx" ON "reminders"("familyId", "isActive");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
