-- IP, device and event type are metadata about an audit event, not part of the
-- change it records. They were being written into `after_data`, so the
-- before/after comparison listed them as added fields on every record. Their
-- own columns keep the change data clean; the values already stored inside
-- `after_data` are lifted out here so old records read the same way.
ALTER TABLE "audit_log" ADD COLUMN "ip_address" VARCHAR(64);
ALTER TABLE "audit_log" ADD COLUMN "user_agent" TEXT;
ALTER TABLE "audit_log" ADD COLUMN "event_type" VARCHAR(50);

-- `after_data` is not always an object: some rows hold a scalar or an array,
-- and both `->>` and the `-` operator fail on those.
UPDATE "audit_log"
SET "ip_address" = "after_data" ->> 'ipAddress',
    "user_agent" = "after_data" ->> 'userAgent',
    "event_type" = "after_data" ->> 'eventType'
WHERE "after_data" IS NOT NULL AND jsonb_typeof("after_data") = 'object';

-- and out of the change data, so the diff shows only what actually changed
UPDATE "audit_log"
SET "after_data" = "after_data" - 'ipAddress' - 'userAgent' - 'eventType'
WHERE "after_data" IS NOT NULL AND jsonb_typeof("after_data") = 'object';
