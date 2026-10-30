-- AlterTable
ALTER TABLE "bank_entries" ADD COLUMN     "privateEntryId" UUID,
ADD COLUMN     "source" "VaultSource" NOT NULL DEFAULT 'OTHER';

-- CreateIndex
CREATE UNIQUE INDEX "bank_entries_privateEntryId_key" ON "bank_entries"("privateEntryId");

-- AddForeignKey
ALTER TABLE "bank_entries" ADD CONSTRAINT "bank_entries_privateEntryId_fkey" FOREIGN KEY ("privateEntryId") REFERENCES "private_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

