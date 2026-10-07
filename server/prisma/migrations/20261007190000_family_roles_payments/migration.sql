-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('FATHER', 'MOTHER', 'CHILD');

-- CreateEnum
CREATE TYPE "PermissionKey" AS ENUM ('VIEW_EXPENSES', 'ADD_EXPENSE', 'EDIT_EXPENSE', 'DELETE_EXPENSE', 'VIEW_PAYMENTS', 'ADD_PAYMENT', 'EDIT_PAYMENT', 'DELETE_PAYMENT', 'VIEW_REPORTS', 'MANAGE_CHILDREN');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentCategory" AS ENUM ('BILL', 'TUITION', 'COURSE', 'SUBSCRIPTION', 'RENT', 'INTERNET', 'MOBILE', 'INSURANCE', 'INSTALLMENT', 'LOAN', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('ACTIVE', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DispatchKind" AS ENUM ('REMINDER', 'OVERDUE');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PAYMENT_REMINDER', 'PAYMENT_OVERDUE', 'INVITATION', 'PERMISSION_CHANGE', 'FAMILY_EVENT');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "createdById" UUID;

-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "createdById" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "familyId" UUID,
ADD COLUMN     "memberId" UUID,
ADD COLUMN     "profileImage" TEXT,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'FATHER',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh';

-- CreateTable
CREATE TABLE "family_invitations" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "memberId" UUID,
    "code" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" UUID NOT NULL,
    "acceptedById" UUID,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" "PermissionKey" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "assigneeId" UUID NOT NULL,
    "memberId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" "Currency" NOT NULL,
    "category" "PaymentCategory" NOT NULL DEFAULT 'OTHER',
    "frequency" "PaymentFrequency" NOT NULL DEFAULT 'MONTHLY',
    "customIntervalDays" INTEGER,
    "startDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "dueTime" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "state" "PaymentState" NOT NULL DEFAULT 'ACTIVE',
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderDaysBefore" INTEGER,
    "reminderTime" TEXT,
    "reminderAt" TIMESTAMP(3),
    "lastPaidAt" TIMESTAMP(3),
    "lastPaidById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,3) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidById" UUID,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reminders" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dueDate" DATE NOT NULL,
    "kind" "DispatchKind" NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "relatedEntityId" UUID,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "family_invitations_code_key" ON "family_invitations"("code");

-- CreateIndex
CREATE INDEX "family_invitations_familyId_status_idx" ON "family_invitations"("familyId", "status");

-- CreateIndex
CREATE INDEX "family_invitations_email_status_idx" ON "family_invitations"("email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_userId_key_key" ON "user_permissions"("userId", "key");

-- CreateIndex
CREATE INDEX "payments_familyId_deletedAt_state_dueDate_idx" ON "payments"("familyId", "deletedAt", "state", "dueDate");

-- CreateIndex
CREATE INDEX "payments_assigneeId_idx" ON "payments"("assigneeId");

-- CreateIndex
CREATE INDEX "payments_state_reminderAt_idx" ON "payments"("state", "reminderAt");

-- CreateIndex
CREATE INDEX "payments_state_dueAt_idx" ON "payments"("state", "dueAt");

-- CreateIndex
CREATE INDEX "payment_records_familyId_paidAt_idx" ON "payment_records"("familyId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_paymentId_dueDate_key" ON "payment_records"("paymentId", "dueDate");

-- CreateIndex
CREATE INDEX "payment_reminders_userId_idx" ON "payment_reminders"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reminders_paymentId_dueDate_kind_key" ON "payment_reminders"("paymentId", "dueDate", "kind");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_familyId_idx" ON "notifications"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_userId_idx" ON "push_tokens"("userId");

-- CreateIndex
CREATE INDEX "expenses_familyId_createdById_idx" ON "expenses"("familyId", "createdById");

-- CreateIndex
CREATE UNIQUE INDEX "users_memberId_key" ON "users"("memberId");

-- CreateIndex
CREATE INDEX "users_familyId_isActive_idx" ON "users"("familyId", "isActive");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_invitations" ADD CONSTRAINT "family_invitations_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_invitations" ADD CONSTRAINT "family_invitations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_invitations" ADD CONSTRAINT "family_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_invitations" ADD CONSTRAINT "family_invitations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_lastPaidById_fkey" FOREIGN KEY ("lastPaidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Data migration (keeps every existing row) ─────────────

-- Every family owner belongs to their own family as its FATHER / admin.
UPDATE "users" u SET "familyId" = f."id", "role" = 'FATHER'
FROM "families" f WHERE f."ownerId" = u."id";

-- Existing records were created by the family owner.
UPDATE "expenses" e SET "createdById" = f."ownerId"
FROM "families" f WHERE f."id" = e."familyId" AND e."createdById" IS NULL;
UPDATE "incomes" i SET "createdById" = f."ownerId"
FROM "families" f WHERE f."id" = i."familyId" AND i."createdById" IS NULL;

-- Carry the old reminders over as payments (the Payments module replaces them).
-- Next due date is computed from today in the family timezone; the reminder fires at the due time.
INSERT INTO "payments" (
  "id", "familyId", "createdById", "assigneeId", "memberId", "name", "amount", "currency", "category", "frequency",
  "startDate", "dueDate", "dueTime", "timezone", "dueAt", "state", "reminderEnabled", "reminderDaysBefore",
  "reminderTime", "reminderAt", "cancelledAt", "createdAt", "updatedAt"
)
SELECT
  r."id", r."familyId", f."ownerId", f."ownerId", r."memberId", r."title", COALESCE(r."amount", 0), f."currency",
  (CASE r."kind" WHEN 'LESSON' THEN 'TUITION' WHEN 'RENT' THEN 'RENT' WHEN 'BILL' THEN 'BILL' ELSE 'OTHER' END)::"PaymentCategory",
  (CASE r."repeat" WHEN 'ONCE' THEN 'ONCE' WHEN 'WEEKLY' THEN 'WEEKLY' ELSE 'MONTHLY' END)::"PaymentFrequency",
  d.due, d.due, r."time", f."timezone",
  ((d.due + r."time"::time) AT TIME ZONE f."timezone") AT TIME ZONE 'UTC',
  (CASE WHEN r."isActive" THEN 'ACTIVE' ELSE 'CANCELLED' END)::"PaymentState",
  r."isActive", 0, r."time",
  ((d.due + r."time"::time) AT TIME ZONE f."timezone") AT TIME ZONE 'UTC',
  CASE WHEN r."isActive" THEN NULL ELSE CURRENT_TIMESTAMP END,
  r."createdAt", CURRENT_TIMESTAMP
FROM "reminders" r
JOIN "families" f ON f."id" = r."familyId"
CROSS JOIN LATERAL (SELECT (CURRENT_TIMESTAMP AT TIME ZONE f."timezone")::date AS today) t
CROSS JOIN LATERAL (SELECT date_trunc('month', t.today)::date AS m0) m
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN r."repeat" = 'ONCE' THEN COALESCE(r."date", t.today)
    WHEN r."repeat" = 'WEEKLY' THEN t.today + ((COALESCE(r."weekday", 0) - EXTRACT(DOW FROM t.today)::int + 7) % 7)
    ELSE (
      SELECT CASE WHEN c0 >= t.today THEN c0 ELSE c1 END FROM (
        SELECT
          m.m0 + (LEAST(COALESCE(r."dayOfMonth", 1), EXTRACT(DAY FROM (m.m0 + INTERVAL '1 month - 1 day'))::int) - 1) AS c0,
          (m.m0 + INTERVAL '1 month')::date
            + (LEAST(COALESCE(r."dayOfMonth", 1), EXTRACT(DAY FROM (m.m0 + INTERVAL '2 month - 1 day'))::int) - 1) AS c1
      ) c
    )
  END AS due
) d;

-- Old reminders table is no longer used.
ALTER TABLE "reminders" DROP CONSTRAINT "reminders_familyId_fkey";
ALTER TABLE "reminders" DROP CONSTRAINT "reminders_memberId_fkey";
DROP TABLE "reminders";
DROP TYPE "ReminderKind";
DROP TYPE "ReminderRepeat";
