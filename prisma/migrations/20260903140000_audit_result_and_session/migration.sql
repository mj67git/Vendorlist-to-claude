-- The outcome of the recorded action, and which sign-in it came from.
--
-- The trail could say who changed what, but not whether the attempt succeeded.
-- A refusal is the single most interesting record in a regulated audit trail —
-- "who tried to delete this and was stopped" is the question the log exists to
-- answer — and it was expressed only by convention, in the free text of the
-- `action` column ("Delete - Blocked", "FAILED_LOGIN"). Convention buried in
-- free text is not something a filter can rely on.
--
-- `session_id` names the sign-in behind the action, so a run of changes can be
-- attributed to one session rather than only to an account. It stays NULL for
-- tokens issued before this change, which is honest: those sessions carried no
-- identifier and inventing one afterwards would be a fabricated record.
--
-- Deliberately NOT added: a `request_id` column. The request identifier is
-- `correlation_id`, which as of the same change is minted once per request
-- rather than once per record. A second column holding the same value would
-- only invite the two to disagree.
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "result" VARCHAR(20);
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "session_id" VARCHAR(50);

-- Existing rows, classified from the vocabulary they were written with. This
-- is the same rule the write path now applies, so old and new records read
-- alike; anything that matches neither pattern completed, because a handler
-- that refused an action never wrote a record with any other action name.
UPDATE "audit_log" SET "result" = 'Blocked' WHERE "result" IS NULL AND "action" ILIKE '%blocked%';
-- Note what is NOT here: `Reject`. A QC rejection is an action that succeeded
-- and whose subject is a rejection; calling it a failed action would put the
-- laboratory's own decisions in the same bucket as refused sign-ins.
UPDATE "audit_log" SET "result" = 'Failed'  WHERE "result" IS NULL AND "action" ILIKE '%failed%';
UPDATE "audit_log" SET "result" = 'Success' WHERE "result" IS NULL;

CREATE INDEX IF NOT EXISTS "audit_log_result_idx" ON "audit_log"("result");
CREATE INDEX IF NOT EXISTS "audit_log_session_id_idx" ON "audit_log"("session_id");
