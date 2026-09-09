-- The audit trail gets a name for each event, indexes for the query the page
-- actually makes, and a guarantee that nothing rewrites history.
--
-- This migration is structural only: it does not update or delete a single
-- existing row. An audit history is the one table a migration must never
-- rewrite, and this file runs on every deployment, not just the test one.

-- 1. The event name, from the closed vocabulary in src/utils/auditTaxonomy.ts.
--    Nullable: rows written before today have no event, and neither do the call
--    sites still writing their own records.
ALTER TABLE "audit_log" ADD COLUMN "event" VARCHAR(60);

-- 2. Indexes. The first two answer filters that had none; the composites answer
--    the page's real question — the newest rows, narrowed by module or user —
--    which the single-column indexes could filter but not order.
CREATE INDEX "audit_log_event_idx" ON "audit_log"("event");
CREATE INDEX "audit_log_entity_type_idx" ON "audit_log"("entity_type");
CREATE INDEX "audit_log_timestamp_module_idx" ON "audit_log"("timestamp" DESC, "module");
CREATE INDEX "audit_log_timestamp_user_id_idx" ON "audit_log"("timestamp" DESC, "user_id");

-- 3. Append-only (ALCOA+). A trail that can be edited proves nothing.
--
--    The guarantee is the trigger, not the REVOKE: on a database where the
--    application connects as the table's owner (the common single-role setup,
--    and the one used here), privileges cannot be taken away from it —
--    has_table_privilege still reports UPDATE and DELETE. A row-level trigger
--    holds regardless of role. The REVOKE is kept for deployments that do run
--    the application under a separate, non-owning role.
--
--    TRUNCATE is deliberately left alone: a FOR EACH ROW trigger does not fire
--    on it, which is what keeps the test harness able to reset the table
--    between tests. Nothing in the application ever issues one.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update_delete ON "audit_log";
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DO $$
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON TABLE audit_log FROM %I', current_user);
EXCEPTION WHEN OTHERS THEN
  -- Owners and superusers keep the privilege whatever this says; the trigger is
  -- what enforces the rule for them.
  NULL;
END;
$$;
