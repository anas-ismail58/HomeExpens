-- AlterEnum
ALTER TYPE "ChildTaskStatus" ADD VALUE 'MISSED';

-- AlterTable
ALTER TABLE "child_tasks" ADD COLUMN     "dailyTaskId" UUID,
ADD COLUMN     "forDate" DATE;

-- CreateTable
CREATE TABLE "daily_tasks" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "points" INTEGER NOT NULL,
    "weekdays" INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_tasks_familyId_memberId_isActive_idx" ON "daily_tasks"("familyId", "memberId", "isActive");

-- CreateIndex
CREATE INDEX "child_tasks_memberId_forDate_idx" ON "child_tasks"("memberId", "forDate");

-- CreateIndex
CREATE UNIQUE INDEX "child_tasks_dailyTaskId_forDate_key" ON "child_tasks"("dailyTaskId", "forDate");

-- AddForeignKey
ALTER TABLE "child_tasks" ADD CONSTRAINT "child_tasks_dailyTaskId_fkey" FOREIGN KEY ("dailyTaskId") REFERENCES "daily_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

