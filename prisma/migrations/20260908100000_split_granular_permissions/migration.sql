-- Split coarse module permissions into the granular matrix (1405/06/17).
--
-- Five permissions used to carry more than one business operation:
--   vendor.read   also meant the four read-only views built on vendor data
--                 (archive, supplier audit, samples, blacklist)
--   vendor.edit   also carried the final source verdict
--   vendor.analysis also carried the sample quality verdict
--   partner.edit  also carried supplier evaluation and supplier status
--   users.manage  also carried reading users, editing their permissions and
--                 resetting their passwords
--
-- The code expands those names on load, the same way LEGACY_PERMISSIONS does,
-- so no account loses access with or without this migration. This writes the
-- expansion into the stored rows once so the permission dialog shows real
-- ticks instead of access that only exists at read time — the stored list is
-- meant to be exactly what was saved (see migration 20260903120000).
--
-- Only rows with a non-empty exception list are touched. An empty list means
-- "follow the role template", and the templates live in code.

UPDATE "users"
SET "permissions" = "permissions" || '["archive.read","supplier-audit.read","sample.read","blacklist.read"]'::jsonb
WHERE jsonb_typeof("permissions") = 'array'
  AND "permissions" ? 'vendor.read';

UPDATE "users"
SET "permissions" = "permissions" || '["vendor.decide"]'::jsonb
WHERE jsonb_typeof("permissions") = 'array'
  AND "permissions" ? 'vendor.edit';

UPDATE "users"
SET "permissions" = "permissions" || '["sample.decide"]'::jsonb
WHERE jsonb_typeof("permissions") = 'array'
  AND "permissions" ? 'vendor.analysis';

UPDATE "users"
SET "permissions" = "permissions" || '["partner.evaluate","partner.status"]'::jsonb
WHERE jsonb_typeof("permissions") = 'array'
  AND "permissions" ? 'partner.edit';

UPDATE "users"
SET "permissions" = "permissions" || '["users.read","users.permissions","users.password"]'::jsonb
WHERE jsonb_typeof("permissions") = 'array'
  AND "permissions" ? 'users.manage';

-- `||` on two arrays concatenates, so a row that already names a child gets it
-- twice. Collapse every list to distinct values.
UPDATE "users" u
SET "permissions" = sub.deduped
FROM (
  SELECT "username", (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements("permissions")) AS deduped
  FROM "users"
  WHERE jsonb_typeof("permissions") = 'array' AND jsonb_array_length("permissions") > 0
) sub
WHERE u."username" = sub."username" AND sub.deduped IS NOT NULL;
