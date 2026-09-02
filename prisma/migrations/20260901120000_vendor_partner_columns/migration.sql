-- Move the partner link out of the contact-details text and into its columns.
--
-- `manufacturer_id` and `supplier_id` have existed (and been indexed) since the
-- normalisation migration, but nothing ever wrote them: saveVendorToDb appended
-- a `__BP_METAUI__:<manufacturer>:<supplier>` marker to `contact_info` instead.
-- The read path prefers the column and falls back to the marker, so the marker
-- was the real storage — inside a free-text field the user edits by hand, and
-- invisible to every query that joins on the column, including the guard that
-- refuses to delete a partner still in use.
--
-- This moves the values across and strips the marker from the visible text. It
-- only fills columns that are still NULL, so a row whose column already holds a
-- value keeps it: that column is what the application has been reading and
-- showing, and overwriting it from a stale marker would silently change which
-- company a source is attributed to.
--
-- Marker shape: "<contact text>\n__BP_METAUI__:<manufacturerId>:<supplierId>"
-- Either id may be empty. Both empty is possible on rows saved with no partner.

UPDATE vendors
SET manufacturer_id = NULLIF(split_part(split_part(contact_info, E'\n__BP_METAUI__:', 2), ':', 1), '')
WHERE contact_info LIKE '%' || E'\n__BP_METAUI__:' || '%'
  AND manufacturer_id IS NULL;

UPDATE vendors
SET supplier_id = NULLIF(split_part(split_part(contact_info, E'\n__BP_METAUI__:', 2), ':', 2), '')
WHERE contact_info LIKE '%' || E'\n__BP_METAUI__:' || '%'
  AND supplier_id IS NULL;

-- Now that the ids are in their columns, the marker is noise in a field people
-- read. split_part with index 1 returns the whole string when the separator is
-- absent, so rows without a marker are untouched.
UPDATE vendors
SET contact_info = split_part(contact_info, E'\n__BP_METAUI__:', 1)
WHERE contact_info LIKE '%' || E'\n__BP_METAUI__:' || '%';

-- A link pointing at a partner that no longer exists is not a link. Those rows
-- were created by the delete guard being blind to the marker, so clear them
-- rather than carry a dangling reference into the columns the guard now reads.
UPDATE vendors v
SET manufacturer_id = NULL
WHERE v.manufacturer_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM business_partners p WHERE p.id = v.manufacturer_id);

UPDATE vendors v
SET supplier_id = NULL
WHERE v.supplier_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM business_partners p WHERE p.id = v.supplier_id);
