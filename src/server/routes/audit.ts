import express from "express";
import { AuditService } from "../../utils/auditService.js";
import { AUDIT_EVENT_GROUPS, type AuditEvent } from "../../utils/auditTaxonomy.js";
import { recordEvent } from "../../utils/auditEvents.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { sendHandlerError } from "../http/errors.js";

/**
 * Reading the change record.
 *
 * Read-only by design: `POST /api/audit-logs` used to exist and accepted a
 * record from any signed-in client, which made the trail weaker evidence than
 * one only the server writes. Every entry now comes from the handler that
 * performed the change.
 */

export function auditRoutes(): express.Router {
  const router = express.Router();

  /*
   * POST /api/audit-logs is gone deliberately.
   *
   * It accepted an audit record from any signed-in client, with only
   * requireAuth in front of it: the module, action, severity, description and
   * both before/after payloads were whatever the caller sent. Reading the trail
   * is gated by `audit.read`; writing to it was gated by nothing. An audit
   * trail whose entries can be authored by the client is weaker evidence than
   * one only the server writes, which is the whole point of having it
   * (project rule 2).
   *
   * The only caller was VendorForm, and both records it wrote were wrong — see
   * the note in that file. Every real change is already audited by the handler
   * that performs it, through AuditService.
   */

  router.get("/api/audit-logs", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
    try {

      // Clamped, not trusted. `page=-1` used to reach Prisma as a negative
      // `skip` and come back as a 500 carrying the raw query-engine error, and
      // `limit=999999999` was accepted — harmless with a few hundred rows, but
      // one such request against a year of audit data would pull the whole
      // table into memory.
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 20), 200);

      const filters: any = {};
      // The filter form offers user *names* (that is what /filters returns),
      // so matching only on userId silently returned nothing.
      if (req.query.userId) filters.user = req.query.userId as string;
      if (req.query.module && req.query.module !== "all") filters.module = req.query.module as string;
      // Coarse group = a fixed set of modules, enforced here rather than being
      // dropped on the floor like the old `eventType` parameter was.
      const group = req.query.group as string;
      if (group && group !== "all" && AUDIT_EVENT_GROUPS[group]) {
        filters.modules = AUDIT_EVENT_GROUPS[group].modules;
      }
      if (req.query.action && req.query.action !== "all") filters.action = req.query.action as string;
      if (req.query.severity && req.query.severity !== "all") filters.severity = req.query.severity as string;
      // Outcome: Success, Failed or Blocked. A refusal is the most interesting
      // record in the trail and used to be findable only by knowing that the
      // word "Blocked" had been spelled into the free-text action column.
      if (req.query.result && req.query.result !== "all") filters.result = req.query.result as string;
      if (req.query.entityId) filters.entityId = req.query.entityId as string;
      if (req.query.correlationId) filters.correlationId = req.query.correlationId as string;
      // An unparseable date used to become `Invalid Date` and blow up the query
      // with a 500 — which is exactly what the Jalali text the form sent did.
      const parseDate = (raw: unknown) => {
        if (!raw) return undefined;
        const d = new Date(raw as string);
        return isNaN(d.getTime()) ? undefined : d;
      };
      const startDate = parseDate(req.query.startDate);
      const endDate = parseDate(req.query.endDate);
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      // `quickFilter` is no longer read. It was accepted here, passed down and
      // then ignored by the PostgreSQL read path — the same silent-no-op the
      // old `eventType` parameter was — and no control in the UI ever set it.

      const query = (req.query.query as string || "").trim();
      // The table's sort choice, applied in SQL — see AuditService.orderFor.
      const sort = { by: req.query.sortBy as string, dir: req.query.sortDir as string };

      // Searching and listing are the same read with one more condition, and
      // both page in SQL. The search used to take a separate path that pulled a
      // fixed 100 rows and paged them in memory, so `total` reported the cap
      // rather than the number of matches.
      const result = await AuditService.getAuditLogs(filters, page, limit, sort, query);

      res.json(result);
    } catch (err: any) {
      console.error("Failed to fetch audit logs:", err);
      console.error("[audit] request failed:", err);
      res.status(500).json({ error: "خطای داخلی سرور. جزئیات در لاگ سرور ثبت شد." });
    }
  });

  router.get("/api/audit-logs/stats", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
    try {

      // Counted in SQL. This used to read ten thousand full rows — both JSON
      // payloads of each — to produce three integers and a clock time.
      res.json(await AuditService.getStats());
    } catch (err: any) {
      console.error("Failed to fetch audit stats:", err);
      console.error("[audit] request failed:", err);
      res.status(500).json({ error: "خطای داخلی سرور. جزئیات در لاگ سرور ثبت شد." });
    }
  });

  router.get("/api/audit-logs/filters", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
    try {

      // Distinct values off the index, not a full table read.
      res.json(await AuditService.getFilterOptions());
    } catch (err: any) {
      console.error("Failed to fetch filter options:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  /*
   * The rest of the chain this event belongs to. See requestContext.ts: every
   * record written while handling one request carries that request's id, so
   * "what else happened because of this?" is a lookup rather than a guess.
   *
   * Registered before `/:id` so the more specific path is not swallowed by it.
   */
  router.get("/api/audit-logs/:id/related", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
    try {
      res.json({ data: await AuditService.getRelatedEvents(req.params.id) });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.get("/api/audit-logs/:id", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
    try {

      const log = await AuditService.getAuditById(req.params.id);
      if (!log) {
        return res.status(404).json({ error: "Audit log not found" });
      }
      res.json(log);
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  /**
   * The one thing the browser is allowed to tell the trail about.
   *
   * Everything else in `audit_log` is written by the handler that made the
   * change, because a trail the client can author is weaker evidence than one
   * only the server writes (rule 2). But taking data *out* of the company —
   * a spreadsheet, a printed form — happens entirely in the browser: the rows
   * are already on the page, and no request is made to produce the file. There
   * is no server-side moment to record, so either the browser says so or the
   * one act that moves regulated data outside the system leaves no trace.
   *
   * The concession is kept as narrow as it can be. Three event names are
   * accepted and nothing else; the module, action, severity and wording still
   * come from the vocabulary, not from the caller; and the only things the
   * caller supplies are a short label and a row count, both bounded here. A
   * client cannot forge a deletion, a grade or a permission change through
   * this door — it can only claim it exported something.
   */
  const REPORTABLE: AuditEvent[] = ["data.exported", "data.printed", "data.backup_downloaded"];

  router.post("/api/audit/events", requireAuth, async (req: any, res) => {
    try {
      const { event, label, rows } = req.body || {};
      if (!REPORTABLE.includes(event)) {
        return res.status(400).json({ error: "این رویداد از سمت کلاینت قابل ثبت نیست." });
      }
      const name = typeof label === "string" ? label.trim().slice(0, 120) : "";
      // A row count is a number or it is nothing; a string here would end up in
      // the sentence as whatever the caller wrote.
      const count = Number.isFinite(rows) && rows >= 0 ? Math.floor(rows) : null;

      await recordEvent(req, {
        event,
        entity: { name: name || null },
        facts: { rows: count },
      });
      res.json({ success: true });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // ==========================================
  // --- User Management Endpoints ---
  // ==========================================

  return router;
}
