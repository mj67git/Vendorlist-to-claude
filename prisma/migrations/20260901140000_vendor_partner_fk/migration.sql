-- Make the source→partner link a real foreign key.
--
-- `manufacturer_id` and `supplier_id` were plain indexed strings: nothing at
-- the database level checked that they named a partner that exists, and for a
-- long time nothing wrote them at all (see 20260901120000). Now that the write
-- path fills them and the old markers have been migrated across, the reference
-- can be enforced where it belongs.
--
-- ON DELETE SET NULL, not CASCADE: a source outlives the partner record. It
-- carries its own evaluations, laboratory results and risk assessment, and
-- deleting all of that because a company record was removed would destroy GxP
-- history. The API's delete guard already refuses to remove a partner while a
-- source points at it, so this constraint is the backstop.

-- A constraint cannot be added over rows that already violate it. Any id left
-- pointing at a partner that no longer exists is a dangling reference created
-- while the guard was blind to the marker form; clear those first.
UPDATE vendors v
SET manufacturer_id = NULL
WHERE v.manufacturer_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM business_partners p WHERE p.id = v.manufacturer_id);

UPDATE vendors v
SET supplier_id = NULL
WHERE v.supplier_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM business_partners p WHERE p.id = v.supplier_id);

ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_manufacturer_id_fkey"
  FOREIGN KEY ("manufacturer_id") REFERENCES "business_partners"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "business_partners"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
