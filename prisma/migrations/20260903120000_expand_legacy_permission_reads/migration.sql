-- Make stored permission lists mean exactly what they say.
--
-- Reading became a permission of its own (`vendor.read`, `material.read`,
-- `partner.read`) after per-user exception lists already existed, so a list
-- saved before that names writes and scores but no reads. To keep those
-- accounts working, `effectivePermissions` treated ANY list without a read as
-- one of those old rows and added the reads back at read time.
--
-- That heuristic cannot tell an old row from a deliberate restriction. An
-- administrator who turns every module off and leaves only the department's
-- scoring tick saves a list with no read in it — and gets the reads handed back
-- silently, so the dialog shows the change as if it had never been made.
--
-- So the expansion happens once, here, to the rows it was actually meant for,
-- and the code then treats every stored list as exact. Existing accounts keep
-- precisely the access they have today; what changes is that a list saved from
-- now on is obeyed.

UPDATE "users"
SET "permissions" = "permissions" || '["vendor.read","material.read","partner.read","partner.files"]'::jsonb
WHERE "permissions" IS NOT NULL
  AND jsonb_typeof("permissions") = 'array'
  AND jsonb_array_length("permissions") > 0
  AND NOT ("permissions" ?| array['vendor.read','material.read','partner.read','partner.files']);
