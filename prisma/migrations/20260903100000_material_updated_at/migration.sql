-- Give the materials table the `updated_at` the concurrency check needs.
--
-- `materials` had `created_at` only. Its PATCH endpoint is a read-modify-write
-- like every other one here, so without this column there is no way to tell
-- that a row moved between the moment a form was opened and the moment it is
-- saved — the stale form simply wins for every field it carries.
--
-- Existing rows are stamped with the current time: their real last-edit date is
-- not recoverable, and the value is only ever compared for equality, never read
-- as history.

ALTER TABLE "materials"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
