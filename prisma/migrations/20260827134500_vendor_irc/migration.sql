-- The IRC licence number belongs to the source, not to the material catalogue.
-- AlterTable
ALTER TABLE "vendors" ADD COLUMN "irc" TEXT;

-- Backfill: carry each source's IRC over from the material it is linked to,
-- but only when that material actually holds a code (the placeholder values
-- "N/A" / "NA" / "-" carry no information).
UPDATE "vendors" v
SET "irc" = m."irc"
FROM "vendor_materials" vm
JOIN "materials" m ON m."id" = vm."material_id"
WHERE vm."vendor_id" = v."id"
  AND m."irc" IS NOT NULL
  AND m."irc" NOT IN ('N/A', 'NA', '-', '');
