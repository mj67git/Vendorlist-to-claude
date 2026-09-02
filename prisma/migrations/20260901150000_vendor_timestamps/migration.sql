-- Give the sources table the timestamps every other table already had.
--
-- `vendors` is the central record of the system and had neither `created_at`
-- nor `updated_at`. Without `updated_at` there is no way to notice that a row
-- changed between the moment a request read it and the moment it writes back —
-- and every one of the six source PATCH endpoints is a read-modify-write. The
-- in-process lock covers that within one Node process; this column is what lets
-- the check work when there is more than one (a second container, or the
-- serverless deployment, where a module-level Map protects nothing).
--
-- Existing rows are stamped with the current time: their real creation date is
-- not recoverable, and any value here is only ever compared for equality, never
-- read as history.

ALTER TABLE "vendors"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
