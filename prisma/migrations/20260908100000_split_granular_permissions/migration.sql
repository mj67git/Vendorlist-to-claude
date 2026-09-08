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
-- This migration is what keeps those accounts whole: the application does NOT
-- expand a live permission on load. It did briefly, and that made the split
-- unexpressible — an administrator who left «مدیریت کاربران» ticked and cleared
-- «تعیین سطح دسترسی» got the second one handed back on the next read, the same
-- failure as the read heuristic migration 20260903120000 removed. So the
-- expansion happens once, here, and from then on a stored list means exactly
-- what it says. (A retired name such as `material.write` is still expanded on
-- load, because nothing ever rewrote those rows.)
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
