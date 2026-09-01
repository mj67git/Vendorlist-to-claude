import express from "express";
import { AuditService } from "../../utils/auditService.js";
import { AUDIT_EVENT_GROUPS } from "../../utils/auditTaxonomy.js";
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
      if (req.query.quickFilter && req.query.quickFilter !== "all") filters.quickFilter = req.query.quickFilter as string;

      const query = (req.query.query as string || "").trim();
      // The table's sort choice, applied in SQL — see AuditService.orderFor.
      const sort = { by: req.query.sortBy as string, dir: req.query.sortDir as string };
      let result;

      if (query) {
        const searched = await AuditService.searchAuditLogs(query, filters, sort);
        const skip = (page - 1) * limit;
        result = {
          data: searched.slice(skip, skip + limit),
          total: searched.length,
        };
      } else {
        result = await AuditService.getAuditLogs(filters, page, limit, sort);
      }

      res.json(result);
    } catch (err: any) {
      console.error("Failed to fetch audit logs:", err);
      console.error("[audit] request failed:", err);
      res.status(500).json({ error: "خطای داخلی سرور. جزئیات در لاگ سرور ثبت شد." });
    }
  });

  router.get("/api/audit-logs/stats", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
    try {

      const result = await AuditService.getAuditLogs({}, 1, 10000);
      const total = result.total;
      const critical = result.data.filter((l: any) => l.severity.toLowerCase() === "critical").length;
      const warning = result.data.filter((l: any) => l.severity.toLowerCase() === "warning").length;

      const uniqueUsersSet = new Set(result.data.map((l: any) => l.userId).filter(Boolean));
      const activeUsers = uniqueUsersSet.size || 1;

      const lastLog = result.data[0];
      let lastUpdated = "-";
      if (lastLog) {
        const d = new Date(lastLog.timestamp);
        lastUpdated = d.toLocaleTimeString('fa-IR', { hour12: false }) || d.toLocaleTimeString('en-US', { hour12: false });
      }

      res.json({
        total,
        critical,
        warning,
        activeUsers,
        lastUpdated
      });
    } catch (err: any) {
      console.error("Failed to fetch audit stats:", err);
      console.error("[audit] request failed:", err);
      res.status(500).json({ error: "خطای داخلی سرور. جزئیات در لاگ سرور ثبت شد." });
    }
  });

  router.get("/api/audit-logs/filters", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
    try {

      const result = await AuditService.getAuditLogs({}, 1, 10000);
      const uniqueUsers = Array.from(new Set(result.data.map((l: any) => l.userName || l.userId).filter(Boolean)));
      const uniqueModules = Array.from(new Set(result.data.map((l: any) => l.module).filter(Boolean)));
      res.json({
        uniqueUsers,
        uniqueModules
      });
    } catch (err: any) {
      console.error("Failed to fetch filter options:", err);
      res.status(500).json({ error: "Internal Server Error" });
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

  // ==========================================
  // --- User Management Endpoints ---
  // ==========================================

  return router;
}
