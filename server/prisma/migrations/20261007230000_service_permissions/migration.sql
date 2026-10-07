-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PermissionKey" ADD VALUE 'SERVICE_LESSONS';
ALTER TYPE "PermissionKey" ADD VALUE 'SERVICE_RECURRING';
ALTER TYPE "PermissionKey" ADD VALUE 'SERVICE_HOUSEHOLD';
ALTER TYPE "PermissionKey" ADD VALUE 'VIEW_INCOME';

