-- AlterTable
ALTER TABLE "users" ADD COLUMN "totpSecret" TEXT,
ADD COLUMN "totpLastStep" INTEGER;
