-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subjects_familyId_isActive_idx" ON "subjects"("familyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_familyId_key_key" ON "subjects"("familyId", "key");

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

