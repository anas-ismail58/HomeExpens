-- CreateEnum
CREATE TYPE "PointRuleKind" AS ENUM ('BEHAVIOR', 'PENALTY', 'REWARD');

-- CreateEnum
CREATE TYPE "PointEntryKind" AS ENUM ('AWARD', 'TASK', 'PENALTY', 'REWARD', 'CONVERT', 'PAYOUT', 'ALLOWANCE');

-- CreateEnum
CREATE TYPE "ChildTaskStatus" AS ENUM ('PENDING', 'COMPLETED', 'APPROVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PermissionKey" ADD VALUE 'EVALUATE_CHILDREN';
ALTER TYPE "PermissionKey" ADD VALUE 'MANAGE_CHILD_TASKS';
ALTER TYPE "PermissionKey" ADD VALUE 'PENALIZE_CHILDREN';

-- CreateTable
CREATE TABLE "child_reward_settings" (
    "familyId" UUID NOT NULL,
    "pointValue" DECIMAL(14,3) NOT NULL DEFAULT 0.5,
    "maxAwardPoints" INTEGER NOT NULL DEFAULT 50,
    "maxPenaltyPoints" INTEGER NOT NULL DEFAULT 20,
    "dailyPenaltyLimit" INTEGER NOT NULL DEFAULT 50,
    "maxPenaltyAmount" DECIMAL(14,3) NOT NULL DEFAULT 50,
    "allowNegativePoints" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "child_reward_settings_pkey" PRIMARY KEY ("familyId")
);

-- CreateTable
CREATE TABLE "point_rules" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "kind" "PointRuleKind" NOT NULL,
    "name" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "point_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_tasks" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATE,
    "points" INTEGER NOT NULL,
    "status" "ChildTaskStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" UUID,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewNote" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "child_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_point_entries" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "kind" "PointEntryKind" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "cash" DECIMAL(14,3),
    "reason" TEXT NOT NULL,
    "ruleId" UUID,
    "taskId" UUID,
    "expenseId" UUID,
    "date" DATE NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" TEXT,

    CONSTRAINT "child_point_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "actorId" UUID,
    "memberId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "point_rules_familyId_kind_isActive_idx" ON "point_rules"("familyId", "kind", "isActive");

-- CreateIndex
CREATE INDEX "child_tasks_familyId_memberId_status_idx" ON "child_tasks"("familyId", "memberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "child_point_entries_expenseId_key" ON "child_point_entries"("expenseId");

-- CreateIndex
CREATE INDEX "child_point_entries_familyId_memberId_date_idx" ON "child_point_entries"("familyId", "memberId", "date");

-- CreateIndex
CREATE INDEX "child_point_entries_taskId_idx" ON "child_point_entries"("taskId");

-- CreateIndex
CREATE INDEX "audit_logs_familyId_createdAt_idx" ON "audit_logs"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_familyId_memberId_createdAt_idx" ON "audit_logs"("familyId", "memberId", "createdAt");

-- AddForeignKey
ALTER TABLE "child_reward_settings" ADD CONSTRAINT "child_reward_settings_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_rules" ADD CONSTRAINT "point_rules_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_tasks" ADD CONSTRAINT "child_tasks_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_tasks" ADD CONSTRAINT "child_tasks_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_tasks" ADD CONSTRAINT "child_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_tasks" ADD CONSTRAINT "child_tasks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_tasks" ADD CONSTRAINT "child_tasks_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_point_entries" ADD CONSTRAINT "child_point_entries_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_point_entries" ADD CONSTRAINT "child_point_entries_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_point_entries" ADD CONSTRAINT "child_point_entries_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "point_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_point_entries" ADD CONSTRAINT "child_point_entries_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "child_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_point_entries" ADD CONSTRAINT "child_point_entries_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_point_entries" ADD CONSTRAINT "child_point_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_point_entries" ADD CONSTRAINT "child_point_entries_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
