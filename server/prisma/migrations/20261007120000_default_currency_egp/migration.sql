-- New families default to Egyptian pounds; existing families switch to EGP as well.
ALTER TABLE "families" ALTER COLUMN "currency" SET DEFAULT 'EGP';
UPDATE "families" SET "currency" = 'EGP' WHERE "currency" = 'SAR';
