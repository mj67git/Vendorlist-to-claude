-- Keep the people who could already choose a source able to choose one.
--
-- Recording the chosen source for a material used to run under `vendor.edit`.
-- It now has a permission of its own, `vendor.select`, because the two are
-- different acts: editing keeps a record accurate, choosing says which supplier
-- the company buys a material from and carries a mandatory reason.
--
-- Splitting a permission silently takes access away from every account whose
-- stored exception list names the old one, so the list is expanded once, here,
-- exactly as migration 20260903120000 did when reading became a permission.
-- Accounts following their role template need nothing: the commercial template
-- carries the new permission from the start.
--
-- `vendor.write` is matched as well: it is the retired name that expands to
-- create plus edit, and a row still carrying it had the same access.
-- Rows that already name `vendor.select` are left alone.
UPDATE "users"
SET "permissions" = "permissions" || '["vendor.select"]'::jsonb
WHERE "permissions" IS NOT NULL
  AND jsonb_typeof("permissions") = 'array'
  AND "permissions" ?| array['vendor.edit','vendor.write']
  AND NOT ("permissions" ? 'vendor.select');
