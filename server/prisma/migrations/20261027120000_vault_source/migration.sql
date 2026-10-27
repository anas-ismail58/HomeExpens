-- CreateEnum
CREATE TYPE "VaultSource" AS ENUM ('SALARY', 'PRIVATE', 'OTHER');

-- AlterTable
ALTER TABLE "vault_entries" ADD COLUMN     "privateEntryId" UUID,
ADD COLUMN     "source" "VaultSource" NOT NULL DEFAULT 'OTHER';

-- CreateIndex
CREATE UNIQUE INDEX "vault_entries_privateEntryId_key" ON "vault_entries"("privateEntryId");

-- AddForeignKey
ALTER TABLE "vault_entries" ADD CONSTRAINT "vault_entries_privateEntryId_fkey" FOREIGN KEY ("privateEntryId") REFERENCES "private_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Deposits made before the source existed came off the salary: keep them that way.
UPDATE "vault_entries" SET "source" = 'SALARY';
