-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "occurredAt" TIMESTAMP(3);

-- Add the home-lesson subcategory to existing family education categories.
INSERT INTO "subcategories" (
	"id",
	"categoryId",
	"key",
	"nameAr",
	"nameEn",
	"isActive",
	"sortOrder",
	"createdAt",
	"updatedAt"
)
SELECT
	gen_random_uuid(),
	"id",
	'home_tutoring',
	'الدروس المنزلية',
	'Home lessons',
	true,
	COALESCE((SELECT MAX("sortOrder") + 1 FROM "subcategories" WHERE "categoryId" = "categories"."id"), 0),
	CURRENT_TIMESTAMP,
	CURRENT_TIMESTAMP
FROM "categories"
WHERE "key" = 'education'
ON CONFLICT ("categoryId", "key") DO NOTHING;
