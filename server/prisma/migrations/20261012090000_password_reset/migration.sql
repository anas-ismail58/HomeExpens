-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PASSWORD_RESET_REQUEST';

-- AlterTable
ALTER TABLE "password_reset_tokens" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

