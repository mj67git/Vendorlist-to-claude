import express from "express";
import { auditRowValues, diffFields, recordEvent } from "../../utils/auditEvents.js";
import { calculateGradeAndStatus } from "../../utils/sopEvaluation.js";
import {
  vendorAnalysisSchema, vendorContactSchema, vendorLogsSchema, vendorProfileSchema,
  vendorRiskSchema, vendorSchema, vendorScoreSchema,
} from "../../utils/validation.js";
import {
  can, canScoreDepartment, forbiddenRawScoreChanges, forbiddenScoreChanges,
  SOURCE_LIST_VIEWS, VIEW_PERMISSIONS, type Permission,
} from "../../utils/permissions.js";
import {
  forbiddenSampleScoring, forbiddenVerdictChange, readableVendors, readsEverySource, VERDICT_FIELDS,
} from "../../utils/decisionGuards.js";
import { requirePrisma } from "../db/prisma.js";
import { ircViolation, sopSupplierViolation } from "../domain/sourceRules.js";
import {
  CALCULATION_WEIGHTS, GRADE_TIERS, calculateRoundedWeightedScore,
  calculateWeightedScore, rankVendor,
} from "../domain/vendorEvaluation.js";
import { requireAnyPermission, requireAuth, requirePermission } from "../http/auth.js";
import { sendHandlerError } from "../http/errors.js";
import { getUserByUsername } from "../repositories/userRepository.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, clampInt } from "../http/query.js";
import { STALE_COPY_MESSAGE, staleCopy } from "../http/recordLock.js";
import {
  countVendors, deleteVendorFromDb, getVendorById,
  getVendorChangesSince, getVendorsList, saveVendorToDb, serializeVendorWrites,
} from "../repositories/vendorRepository.js";

/**
 * The source records: the register this system exists to keep.
 *
 * Six PATCH endpoints instead of one PUT, because a source is edited by
 * different departments in different places and a whole-object write would let
 * one of them silently overwrite another's column.
 *
 * Every one of them is a read-modify-write, which is why they all carry
 * `serializeVendorWrites` — and why `saveVendorToDb` is handed the `updatedAt`
 * the handler read, so a second writer working from a stale copy is refused
 * with 409 instead of quietly winning.
 *
 * Score and risk history are reconstructed from `audit_log` rather than stored
 * twice; the audit trail already holds every before/after pair.
 */

/**
 * Which event a source save actually is.
 *
 * `PATCH /profile` and `POST /vendors` replace the whole record, so a
 * disqualification and a change of phone number arrive through the same door —
 * the same reason the permission guard has to compare the payload with what is
 * stored (rule 14). Reading the verdict off the saved record keeps the trail
 * saying «رد صلاحیت» where a person would say it, instead of filing it as one
 * more edit. Returns null for an ordinary edit.
 */
function verdictEvent(before: any, after: any): "source.disqualified" | "source.reinstated" | null {
  const rejected = (v: any) => v?.status === "rejected" || v?.grade === "rejected" || v?.grade === "black list";
  if (rejected(after) && !rejected(before)) return "source.disqualified";
  if (!rejected(after) && rejected(before)) return "source.reinstated";
  return null;
}

/** The FMEA parameters worth naming, under the names the risk history reads. */
function riskChanges(before: any, after: any) {
  const flatten = (r: any) => r && {
    rpn: r.riskScore ?? r.rpn,
    sri: r.sri,
    riskLevel: r.riskLevel,
    severity: r.materialCriticality ?? r.severity,
    occurrence: r.probability ?? r.occurrence,
    detectability: r.detectability ?? r.detection,
  };
  return diffFields(flatten(before), flatten(after), [
    "rpn", "sri", "riskLevel", "severity", "occurrence", "detectability",
  ]);
}

/**
 * The assessment as it now stands.
 *
 * Repeated alongside the changes because the risk history plots a point per
 * row, and a save that moved only the risk level would otherwise leave the
 * chart without an RPN to draw.
 */
function riskFacts(risk: any) {
  return {
    riskLevel: risk?.riskLevel ?? null,
    riskScore: risk?.riskScore ?? risk?.rpn ?? null,
    sri: risk?.sri ?? null,
    materialCriticality: risk?.materialCriticality ?? risk?.severity ?? null,
    probability: risk?.probability ?? risk?.occurrence ?? null,
    detectability: risk?.detectability ?? risk?.detection ?? null,
  };
}

/**
 * Refuse a payload that decides something the caller may not decide.
 *
 * `vendor.edit` and `vendor.analysis` open endpoints that replace the whole
 * record, so the qualification verdict rides along inside an ordinary edit.
 * This compares it against what is stored, answers 403 when the caller is not
 * entitled to the change, and records the attempt — a blocked write is evidence
 * too, the same reasoning as the IRC and SOP refusals below.
 *
 * Returns true when the request has been answered and the handler must stop.
 */
async function refuseUnauthorisedVerdict(
  req: any, res: any, current: any, incoming: any,
  options: { requireEditForTheRest?: boolean } = {},
): Promise<boolean> {
  // The stored user record, not the token: a seven-day JWT carries only the
  // role, so a permission taken away today would otherwise keep working until
  // it expired (rule 14).
  const actor = await getUserByUsername(req.user?.username || "");
  if (!actor || actor.isActive === false) {
    res.status(401).json({ error: "این حساب کاربری دیگر معتبر نیست." });
    return true;
  }
  // The other half of the same question: this route also accepts ordinary
  // edits, and the middleware could only ask whether the caller may do *one* of
  // the two. Whoever holds the verdict but not `vendor.edit` may state the
  // verdict and nothing else.
  if (options.requireEditForTheRest && !can(actor as any, "vendor.edit")) {
    // An empty field and an absent one are the same fact here: the form posts
    // `''` where the record holds null, and treating that as an edit would
    // refuse every verdict that arrives through the whole-record form.
    const settled = (value: any) => JSON.stringify(value === '' || value === undefined ? null : value);
    const otherChanges = Object.keys(incoming || {}).filter(key => {
      if (VERDICT_FIELDS.includes(key as any) || key === 'reasonForChange' || key === 'reason') return false;
      if (key === 'expectedUpdatedAt') return false;
      return settled(incoming[key]) !== settled(current?.[key]);
    });
    if (otherChanges.length > 0) {
      res.status(403).json({
        error: `عدم دسترسی: ویرایش سورس نیازمند مجوز «ویرایش سورس» است (تلاش برای تغییر: ${otherChanges.join('، ')}).`,
      });
      return true;
    }
  }

  const refusal = forbiddenVerdictChange(actor as any, current, incoming);
  if (!refusal) return false;

  const isSample = refusal.permission === 'sample.decide';
  const what = isSample ? "تصمیم کیفی نمونه" : "رد صلاحیت یا بازگردانی سورس";
  recordEvent(req, {
    event: "access.denied",
    entity: {
      type: isSample ? "Sample" : "Source",
      id: current.id,
      name: current.material || current.name || "سورس",
    },
    facts: { attempted: what, permission: refusal.permission, fields: refusal.fields.join("، ") },
  });

  res.status(403).json({
    error: `عدم دسترسی: ${what} نیازمند مجوز جداگانه است و این حساب آن را ندارد.`,
  });
  return true;
}

/**
 * The read-only views that are their own permission.
 *
 * The archive and the supplier directory read the same rows as the category
 * pages, so there is no row filter that expresses them — what distinguishes
 * them is the view being opened. The client names the view it is loading and
 * the server answers whether that account may open it, which is what keeps the
 * tick in the permission form from being decoration (rule 14).
 */
const GATED_VIEWS: Record<string, Permission> = Object.fromEntries(
  SOURCE_LIST_VIEWS.map(view => [view, VIEW_PERMISSIONS[view]]),
);

/**
 * The same answer as `getVendorChangesSince`, for an account that is served
 * fewer rows.
 *
 * Derived state cannot be filtered in SQL (rule 11), so this reads the list and
 * filters it — one full read per poll, for restricted accounts only. It is the
 * price of the count agreeing with the list the same account is given.
 */
async function visibleChangesSince(actor: any, since: Date | null) {
  const visible = readableVendors(actor, await getVendorsList());
  const changed = visible
    .map(v => ({ id: v.id, updatedAt: v.updatedAt ?? null }))
    .filter(row => {
      if (!since) return false;
      const at = row.updatedAt ? new Date(row.updatedAt) : null;
      return !!at && !Number.isNaN(at.getTime()) && at > since;
    });
  return { changed, total: visible.length };
}

export function vendorRoutes(): express.Router {
  const router = express.Router();

  /**
   * The source list, whole or a page at a time.
   *
   * Without `page` this answers with the plain array it always has. Sixteen
   * places in this file, the Excel export, the dashboard aggregates and the
   * archive all read the complete set, and every one of them would have to
   * become a server-side aggregate before the full list could be taken away —
   * so it stays, and paging is something a caller opts into.
   *
   * With `page` the answer is an envelope carrying the total, which is how a
   * caller knows whether to ask for another one. The client uses this to load
   * the list progressively: the first page paints while the rest arrive, rather
   * than the whole table being assembled, serialized and parsed before anything
   * appears.
   */
  router.get("/api/vendors", requireAuth, requirePermission("vendor.read"), async (req: any, res) => {
    try {
      const view = typeof req.query.view === "string" ? req.query.view : null;
      if (view !== null) {
        const needed = GATED_VIEWS[view];
        if (!needed) {
          return res.status(400).json({ error: "نمای درخواستی معتبر نیست." });
        }
        if (!can(req.account, needed)) {
          return res.status(403).json({
            error: "عدم دسترسی: سطح دسترسی شما اجازهٔ باز کردن این نما را نمی‌دهد.",
          });
        }
      }

      // Samples and the blacklist are categories of source rather than separate
      // tables, so an account without those reads is served fewer rows — the
      // permission has to be a filter here, or the whole register arrives and
      // only the page declines to draw it.
      const everything = readsEverySource(req.account);
      const paged = req.query.page !== undefined || req.query.limit !== undefined;
      if (!paged) {
        const rows = await getVendorsList();
        res.json(everything ? rows : readableVendors(req.account, rows));
        return;
      }

      // Clamped rather than rejected: a junk value should still answer with
      // something usable, and an unbounded `limit` would hand a caller the very
      // whole-table response paging exists to avoid.
      const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
      const limit = clampInt(req.query.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

      if (!everything) {
        // A restricted account cannot be paged in the database, because being
        // blacklisted is derived rather than stored (rule 11) and there is no
        // column to filter on. The window is taken after filtering instead, so
        // the totals it reports are the totals of what this account can see —
        // paging over an unfiltered count would hand out short pages and a
        // number that disagrees with them.
        const visible = readableVendors(req.account, await getVendorsList());
        const start = (page - 1) * limit;
        res.json({
          items: visible.slice(start, start + limit),
          total: visible.length,
          page, limit,
          pages: Math.max(1, Math.ceil(visible.length / limit)),
        });
        return;
      }

      const total = await countVendors();
      const items = await getVendorsList(undefined, { skip: (page - 1) * limit, take: limit });
      res.json({ items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
    } catch (error: any) {
      console.error("Failed to fetch vendors:", error);
      res.status(500).json({ error: "Failed to fetch vendors" });
    }
  });

  /**
   * What changed since a moment — the poll that keeps a second operator's copy
   * fresh without a page reload.
   *
   * Deliberately tiny: ids, timestamps and a count. The client decides what to
   * do with the answer, because only the client knows whether somebody is in
   * the middle of typing into a form (rule 8: an edit in progress is never
   * thrown away by a background refresh).
   *
   * A missing or unparseable `since` answers with the count and an empty list
   * rather than 400: the caller's next poll carries `serverTime` from this one,
   * so a bad clock or a first call self-corrects instead of failing.
   */
  router.get("/api/vendors/changes", requireAuth, requirePermission("vendor.read"), async (req: any, res) => {
    try {
      const raw = typeof req.query.since === "string" ? new Date(req.query.since) : null;
      const since = raw && !Number.isNaN(raw.getTime()) ? raw : null;
      // A restricted account is polled against what it can see. The client
      // notices a deletion by the total changing, so a count that includes rows
      // this account is never sent would make every sample write look like a
      // deletion and trigger a pointless refetch on the hour.
      const { changed, total } = readsEverySource(req.account)
        ? await getVendorChangesSince(since)
        : await visibleChangesSince(req.account, since);
      // The client's next `since` comes from here, not from its own clock: the
      // two machines disagree, and a browser running a minute fast would ask
      // for a window that has not happened yet and miss every write inside it.
      res.json({ serverTime: new Date().toISOString(), total, changed });
    } catch (error: any) {
      console.error("Failed to read vendor changes:", error);
      res.status(500).json({ error: "Failed to read vendor changes" });
    }
  });

  // Score history for a single vendor, reconstructed from the audit trail
  // (each scoring writes an audit record with before/after SPS). Available to
  // any authenticated user so the trend shows on the vendor detail page.
  router.get("/api/vendors/:id/score-history", requireAuth, requirePermission("vendor.read"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const rows = await prisma.auditLog.findMany({
        where: { entityId: req.params.id, entityType: "Score" },
        orderBy: { timestamp: "asc" },
      });
      const history = rows.map((r) => {
        // `auditRowValues` reads both shapes: the named changes written since
        // the audit rewrite, and the whole-record copies stored before it.
        const { before, after } = auditRowValues(r as any);
        return {
          id: r.id,
          date: r.timestamp.toISOString(),
          totalSPS: typeof after.totalSPS === "number" ? after.totalSPS : null,
          previousSPS: typeof before.totalSPS === "number" ? before.totalSPS : null,
          grade: after.grade ?? null,
          scores: after.scores ?? null,
          user: r.userName || r.userId || "—",
          reason: r.reasonForChange || "",
        };
      });
      res.json(history);
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // Risk assessment history (reconstructed from audit trail)
  router.get("/api/vendors/:id/risk-history", requireAuth, requirePermission("vendor.read"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const rows = await prisma.auditLog.findMany({
        where: { entityId: req.params.id, entityType: "Risk Assessment" },
        orderBy: { timestamp: "asc" },
      });
      const history = rows.map((r) => {
        const { before, after } = auditRowValues(r as any);
        return {
          id: r.id,
          date: r.timestamp.toISOString(),
          riskLevel: after.riskLevel ?? null,
          previousRiskLevel: before.riskLevel ?? null,
          riskScore: typeof after.riskScore === "number" ? after.riskScore : null,
          sri: typeof after.sri === "number" ? after.sri : null,
          materialCriticality: after.materialCriticality ?? null,
          probability: after.probability ?? null,
          detectability: after.detectability ?? null,
          sps: after.sps ?? null,
          user: r.userName || r.userId || "—",
          reason: r.reasonForChange || "",
        };
      });
      res.json(history);
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // Create or Update single vendor (Unified Database)
  router.post("/api/vendors", requireAuth, requirePermission("vendor.create"), async (req: any, res) => {
    try {
      const validationResult = vendorSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Validation failed", details: validationResult.error.issues });
      }
    
      const v = validationResult.data;
    
      // Fix material ID generation to prevent replacing when cas/irc are empty
      if (!v.cas && !v.irc && v.material) {
        const matNameClean = v.material.replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '_');
        v.id = v.id || `vend_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
      } else {
        v.id = v.id || `vend_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
      }
    
      const existing = await getVendorById(v.id);

      const ircError = ircViolation((v as any).irc, (existing as any)?.irc);
      if (ircError) {
        return res.status(422).json({ error: ircError });
      }

      const sopError = await sopSupplierViolation((v as any).supplierId, (existing as any)?.supplierId);
      if (sopError) {
        recordEvent(req, {
          event: "access.denied",
          entity: { type: "Source", id: v.id, name: (v as any).material || v.name || "سورس" },
          facts: { attempted: "ثبت سورس با فروشندهٔ فاقد گرید A", supplierId: (v as any).supplierId },
          reason: sopError,
        });
        return res.status(422).json({ error: sopError });
      }

      await saveVendorToDb(v);
      const updated = await getVendorById(v.id);

      // Audit Trail integration
      const isSource = !!(v.isSample || v.category === 'sample' || existing?.isSample || existing?.category === 'sample');
      const entityType = isSource ? "Source" : "Supplier";
      const entityName = isSource ? (updated.material || updated.name || "سورس") : (updated.name || "تامین‌کننده");
      const reasonForChange = req.body.reasonForChange || req.body.reason || null;

      if (!existing) {
        // Create Operation
        await recordEvent(req, {
          event: "source.created",
          entity: { type: entityType, id: updated.id, name: entityName },
          facts: { material: updated.material, supplier: updated.name, category: updated.category },
          reason: reasonForChange || null,
        });
      } else {
        // Update Operation - track diffs
        const beforeData: Record<string, any> = {};
        const afterData: Record<string, any> = {};

        const fieldsToTrack = [
          'name', 'nameEn', 'country', 'contactInfo', 'category', 'status', 'grade',
          'material', 'materialEn', 'cas', 'irc', 'isSample', 'initialSampleStatus'
        ];

        let hasChanges = false;

        fieldsToTrack.forEach(field => {
          const oldVal = existing[field];
          const newVal = updated[field];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            beforeData[field] = oldVal ?? null;
            afterData[field] = newVal ?? null;
            hasChanges = true;
          }
        });

        if (hasChanges) {
          await recordEvent(req, {
            event: verdictEvent(existing, updated) || "source.updated",
            entity: { type: entityType, id: updated.id, name: entityName },
            changes: diffFields(beforeData, afterData, Object.keys(afterData)),
            reason: reasonForChange || null,
          });
        }
      }

      // Dedicated Risk Assessment audit (enables risk-history reconstruction)
      try {
        const oldRisk = existing?.riskAssessment || null;
        const newRisk = updated?.riskAssessment || null;
        if (JSON.stringify(oldRisk) !== JSON.stringify(newRisk) && newRisk) {
          await recordEvent(req, {
            event: "risk.assessed",
            entity: { type: "Risk Assessment", id: updated.id, name: entityName },
            changes: riskChanges(oldRisk, newRisk),
            facts: riskFacts(newRisk),
            reason: reasonForChange || null,
          });
        }
      } catch (e) {
        console.error("Risk audit block error:", e);
      }

      console.log(`[UnifiedDB] Saved monolithic vendor payload: ${v.id}`);
      res.json({ success: true, vendor: updated });
    } catch (error: any) {
      console.error("Failed to save vendor:", error);
      res.status(500).json({ error: "Failed to save vendor" });
    }
  });

  // Update vendor profile (Unified Database)
  // Not one permission: this endpoint carries both the ordinary edit and the
  // qualification verdict, and which one a request is making is only knowable
  // by comparing it with the stored record. `refuseUnauthorisedVerdict` splits
  // them; the middleware only keeps out callers entitled to neither.
  router.patch("/api/vendors/:id/profile", requireAuth,
    requireAnyPermission("vendor.edit", "vendor.decide", "sample.decide"), serializeVendorWrites, async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (staleCopy(req, current)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }
      const validationResult = vendorProfileSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Validation failed", details: validationResult.error.issues });
      }
      const p = validationResult.data;
      if (await refuseUnauthorisedVerdict(req, res, current, p, { requireEditForTheRest: true })) return;
      const updatedVendor = {
        ...current,
        ...p
      };

      const ircError = ircViolation((p as any).irc, (current as any).irc);
      if (ircError) {
        // Recorded, like the SOP refusal below it. A blocked write is evidence
        // too — it says someone tried to put an invalid licence number on a
        // regulated record — and auditing one refusal but not the other made
        // the trail inconsistent about what counts as an event.
        recordEvent(req, {
          event: "access.denied",
          entity: { type: "Source", id, name: current.material || current.name || "سورس" },
          facts: { attempted: "ثبت کد IRC نامعتبر" },
          reason: ircError,
        });
        return res.status(422).json({ error: ircError });
      }

      const sopError = await sopSupplierViolation((updatedVendor as any).supplierId, (current as any).supplierId);
      if (sopError) {
        recordEvent(req, {
          event: "access.denied",
          entity: { type: "Source", id, name: current.material || current.name || "سورس" },
          facts: {
            attempted: "اتصال فروشندهٔ فاقد گرید A به سورس",
            supplierId: (updatedVendor as any).supplierId,
          },
          reason: sopError,
        });
        return res.status(422).json({ error: sopError });
      }

      await saveVendorToDb(updatedVendor, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);

      // Audit Trail Integration
      const isSource = !!(result.isSample || result.category === 'sample' || current.isSample || current.category === 'sample');
      const entityType = isSource ? "Source" : "Supplier";
      const entityName = isSource ? (result.material || result.name) : result.name;
      const reasonForChange = req.body.reasonForChange || req.body.reason || null;

      const beforeData: Record<string, any> = {};
      const afterData: Record<string, any> = {};
      let hasChanges = false;

      Object.keys(p).forEach(key => {
        const oldVal = current[key];
        const newVal = result[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          beforeData[key] = oldVal ?? null;
          afterData[key] = newVal ?? null;
          hasChanges = true;
        }
      });

      if (hasChanges) {
        // A qualification verdict travels inside an ordinary profile save, so
        // which event this is depends on what moved — the same comparison the
        // permission guard makes (rule 14).
        await recordEvent(req, {
          event: verdictEvent(current, result) || "source.updated",
          entity: { type: entityType, id, name: entityName },
          changes: diffFields(beforeData, afterData, Object.keys(afterData)),
          reason: reasonForChange || null,
        });
      }

      console.log(`[UnifiedDB] Saved fine-grained profile details for vendor: ${id}`);
      res.json({ success: true, part: "profile", vendor: result });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // Update vendor contact details (Unified Database)
  router.patch("/api/vendors/:id/contact", requireAuth, requirePermission("vendor.edit"), serializeVendorWrites, async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (staleCopy(req, current)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }
      const validationResult = vendorContactSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Validation failed", details: validationResult.error.issues });
      }
      const c = validationResult.data;
      const updatedVendor = {
        ...current,
        contactInfo: c.contactInfo ?? current.contactInfo,
        lastAudit: c.lastAudit ?? current.lastAudit,
        ircExpiryDate: c.ircExpiryDate ?? current.ircExpiryDate
      };
      await saveVendorToDb(updatedVendor, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);

      // Audit Trail Integration
      const isSource = !!(result.isSample || result.category === 'sample' || current.isSample || current.category === 'sample');
      const entityType = isSource ? "Source" : "Supplier";
      const entityName = isSource ? (result.material || result.name) : result.name;

      const beforeData: Record<string, any> = {};
      const afterData: Record<string, any> = {};
      let hasChanges = false;

      if (current.contactInfo !== result.contactInfo) {
        beforeData.contactInfo = current.contactInfo;
        afterData.contactInfo = result.contactInfo;
        hasChanges = true;
      }
      if (current.lastAudit !== result.lastAudit) {
        beforeData.lastAudit = current.lastAudit;
        afterData.lastAudit = result.lastAudit;
        hasChanges = true;
      }
      if (current.ircExpiryDate !== result.ircExpiryDate) {
        beforeData.ircExpiryDate = current.ircExpiryDate;
        afterData.ircExpiryDate = result.ircExpiryDate;
        hasChanges = true;
      }

      if (hasChanges) {
        await recordEvent(req, {
          event: "source.updated",
          entity: { type: entityType, id, name: entityName },
          changes: diffFields(beforeData, afterData, Object.keys(afterData)),
          reason: req.body.reasonForChange || req.body.reason || null,
        });
      }

      console.log(`[UnifiedDB] Saved fine-grained contact details for vendor: ${id}`);
      res.json({ success: true, part: "contact", vendor: result });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // Update vendor scores & evaluations (Unified Database)
  router.patch("/api/vendors/:id/scores", requireAuth, serializeVendorWrites, async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (staleCopy(req, current)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }
      const validationResult = vendorScoreSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Validation failed", details: validationResult.error.issues });
      }
      const s = validationResult.data;

      // A simple allow/deny on this route is not enough. It replaces the whole
      // scores object rather than patching one field, so a caller entitled to
      // send it could carry another department's score along in the payload.
      // Compare against what is stored and refuse anything they may not touch.
      const scorer = await getUserByUsername(req.user?.username || "");
      if (!scorer || scorer.isActive === false) {
        return res.status(401).json({ error: "این حساب کاربری دیگر معتبر نیست." });
      }
      const offending = [
        ...forbiddenScoreChanges(scorer, current.scores as any, s.scores as any),
        ...forbiddenRawScoreChanges(scorer, current.rawScores as any, s.rawScores as any),
      ];
      if (offending.length > 0) {
        const unique = [...new Set(offending)].join('، ');
        return res.status(403).json({
          error: `عدم دسترسی: شما تنها مجاز به ثبت امتیاز دپارتمان خود هستید (تلاش برای تغییر: ${unique}).`,
        });
      }

      // A sample has no departmental score to give. Refused rather than
      // dropped: a request that stores nothing must not answer 200, or the
      // caller records a scoring that never happened.
      const scoredSample = forbiddenSampleScoring(current, s);
      if (scoredSample.length > 0) {
        recordEvent(req, {
          event: "access.denied",
          entity: { type: "Vendor", id, name: current.name },
          facts: {
            attempted: "امتیازدهی دپارتمانی به نمونه",
            fields: scoredSample.join("، "),
          },
        });
        return res.status(422).json({
          error: "نمونه با نظر آزمایشگاه تصمیم‌گیری می‌شود و امتیاز دپارتمانی نمی‌گیرد.",
        });
      }

      // The stated grounds for a rejection travel with the scores, so the
      // verdict has to be checked on this route as well as on the profile.
      if (await refuseUnauthorisedVerdict(req, res, current, s)) return;

      const prevScores = current.scores || { commercial: 0, qa: 0, planning: 0, finance: 0 };
      const prevSPS = Math.round(
        calculateWeightedScore(prevScores, CALCULATION_WEIGHTS) * 10,
      ) / 10;
      const prevGrade = current.grade || 'unrated';

      const updatedVendor = {
        ...current,
        scores: s.scores ?? current.scores,
        rawScores: s.rawScores ?? current.rawScores,
        rejectionReasons: s.rejectionReasons ?? current.rejectionReasons
      };

      // Calculate grade automatically based on newly patched scores
      if (updatedVendor.scores) {
        const scoreObj = updatedVendor.scores;
        const rounded = calculateRoundedWeightedScore(scoreObj, CALCULATION_WEIGHTS);

        let calcGrade = updatedVendor.grade;
        let calcStatus = updatedVendor.status;

        if (updatedVendor.isSample) {
          if (updatedVendor.status === 'rejected' || updatedVendor.grade === 'rejected' || updatedVendor.grade === 'black list') {
            updatedVendor.status = 'rejected';
            updatedVendor.grade = 'rejected';
          }
        } else {
          for (const tier of GRADE_TIERS) {
            if (rounded >= tier.min) {
              calcGrade = tier.grade === 'black list' ? 'rejected' : tier.grade;
              calcStatus = tier.status;
              break;
            }
          }
          updatedVendor.grade = calcGrade;
          updatedVendor.status = calcStatus;
        }
      }

      await saveVendorToDb(updatedVendor, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);

      const newScores = result.scores || { commercial: 0, qa: 0, planning: 0, finance: 0 };
      const newSPS = Math.round(
        calculateWeightedScore(newScores, CALCULATION_WEIGHTS) * 10,
      ) / 10;

      // Audit Trail Integration
      const isSource = !!(result.isSample || result.category === 'sample' || current.isSample || current.category === 'sample');
      const entityName = isSource ? (result.material || result.name) : result.name;


      // 1. Audit SPS Score Update. The department scores travel as one field
      // because they are saved as one object; `facts` repeats the resulting SPS
      // and grade so the score history can plot a point from any recorded row.
      const scoreChanges = diffFields(
        { totalSPS: prevSPS, grade: prevGrade, scores: prevScores, status: current.status },
        { totalSPS: newSPS, grade: result.grade, scores: newScores, status: result.status },
        ["totalSPS", "grade", "scores", "status"],
      );
      await recordEvent(req, {
        event: "source.scored",
        entity: { type: "Score", id, name: entityName },
        changes: scoreChanges,
        facts: scoreChanges.length > 0 ? { totalSPS: newSPS, grade: result.grade, scores: newScores } : undefined,
        reason: req.body.reasonForChange || req.body.reason || null,
      });

      // The rank is derived from the SPS that was just recorded, so a second
      // row saying it moved adds a line to the trail without adding a fact to
      // it. Dropped with the rewrite (rule 16: no event that reports a
      // recalculation of what the previous row already states).

      console.log(`[UnifiedDB] Saved fine-grained scores details & updated business calculations for vendor: ${id}`);
      res.json({ success: true, part: "scores", vendor: result });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // Update vendor activity logs (Unified Database)
  // Appending to the activity log is a byproduct of acting on the record, not
  // an edit of its own: the sample verdict writes its line here, and quality
  // holds `sample.decide` without `vendor.edit`, so a single permission on this
  // route refused the second half of a decision the same request had just been
  // allowed to make. Whoever may only decide may only append — removing an
  // entry is still an edit, and that is enforced below.
  router.patch("/api/vendors/:id/logs", requireAuth,
    requireAnyPermission("vendor.edit", "vendor.decide", "sample.decide", "vendor.analysis"),
    serializeVendorWrites, async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (staleCopy(req, current)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }
      const validationResult = vendorLogsSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Validation failed", details: validationResult.error.issues });
      }
      const l = validationResult.data;

      // Only `vendor.edit` may rewrite history. For everyone else the submitted
      // list has to start with the stored one, entry for entry: new lines at the
      // end are the record of what they did, while a changed or missing line is
      // somebody editing the trail with a permission that was granted for a
      // decision.
      if (l.activityLogs && !can(req.account, "vendor.edit")) {
        const before = (current.activityLogs || []) as any[];
        const after = l.activityLogs as any[];
        const appendOnly = after.length >= before.length
          && before.every((entry, i) => JSON.stringify(entry) === JSON.stringify(after[i]));
        if (!appendOnly) {
          return res.status(403).json({
            error: "عدم دسترسی: تغییر یا حذف سوابق فعالیت نیازمند مجوز «ویرایش سورس» است.",
          });
        }
      }

      const updatedVendor = {
        ...current,
        activityLogs: l.activityLogs ?? current.activityLogs
      };
      await saveVendorToDb(updatedVendor, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);

      // This was the only write endpoint in the API that left no audit record,
      // so editing or deleting an entry in a source's activity log was the one
      // change in the system with no trace behind it.
      const prevLogs = current.activityLogs || [];
      const nextLogs = updatedVendor.activityLogs || [];
      if (JSON.stringify(prevLogs) !== JSON.stringify(nextLogs)) {
        await recordEvent(req, {
          event: "source.updated",
          entity: { type: "ActivityLog", id, name: current.name || id },
          changes: [{ field: "activityLogCount", from: prevLogs.length, to: nextLogs.length }],
          reason: (req.body?.reasonForChange as string) || null,
        });
      }
      res.json({ success: true, part: "logs", vendor: result });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // Update vendor analysis records & logs (Unified Database)
  router.patch("/api/vendors/:id/analysis", requireAuth, requirePermission("vendor.analysis"), serializeVendorWrites, async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (staleCopy(req, current)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }
      const validationResult = vendorAnalysisSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Validation failed", details: validationResult.error.issues });
      }
      const a = validationResult.data;
      const prevRecords: any[] = current.analysisRecords || [];
      const newRecords: any[] = a.analysisRecords ?? prevRecords;

      // Helper function to count laboratory decisions
      const countDecisions = (recs: any[]) => {
        let pass = 0;
        let conditional = 0;
        let reject = 0;
        for (const r of recs) {
          const d = (r.decision || '').toLowerCase();
          if (d === 'reject' || d === 'mardi' || d === 'مردود') {
            reject++;
          } else if (d === 'approved conditional' || d === 'conditional' || d === 'مشروط') {
            conditional++;
          } else if (d === 'pass' || d === 'approved' || d === 'قبول') {
            pass++;
          }
        }
        return { pass, conditional, reject };
      };

      const newCounters = countDecisions(newRecords);

      // Saving a laboratory record no longer moves a sample's status.
      //
      // This endpoint used to stamp a sample 'rejected' as soon as one Reject
      // record arrived, and — worse — restore it to `initialSampleStatus ||
      // "approved"` as soon as that record was deleted, so a sample could be
      // approved by nobody twice over. A record is evidence; the verdict is a
      // decision a person records with a reason (the sample decision box), and
      // it reaches the server as an ordinary status change with its own audit
      // entry. The counters below are still computed: they are what the general
      // analysis audit entry reports.
      const finalStatus = current.status;
      const isSystemAutoReject = false;
      const isSystemAutoRestore = false;

      /** Samples are named by their material on the audit trail, sources by company. */
      const isSampleRecord = !!(current.isSample || current.category === "sample");

      const updatedVendor = {
        ...current,
        status: finalStatus,
        analysisRecords: newRecords,
        activityLogs: a.activityLogs ?? current.activityLogs
      };
      await saveVendorToDb(updatedVendor, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);

      const entityName = isSampleRecord ? (result.material || result.name) : result.name;
      const reasonInput = req.body.reasonForChange || req.body.reason || null;

      // 1. Audit Laboratory Result Events (Create, Update, Delete)
      const prevIds = new Set(prevRecords.map((r: any) => r.id));
      const newIds = new Set(newRecords.map((r: any) => r.id));

      const addedRecs = newRecords.filter((r: any) => !prevIds.has(r.id));
      const deletedRecs = prevRecords.filter((r: any) => !newIds.has(r.id));
      const updatedRecs = newRecords.filter((r: any) => {
        if (!prevIds.has(r.id)) return false;
        const prev = prevRecords.find((p: any) => p.id === r.id);
        return JSON.stringify(prev) !== JSON.stringify(r);
      });

      // Added Record(s) Audit
      for (const rec of addedRecs) {
        await recordEvent(req, {
          event: "lab.result_added",
          entity: { type: "Laboratory Result", id, name: entityName },
          facts: { qcCode: rec.qcCode || null, decision: rec.decision, date: rec.date },
          reason: reasonInput || null,
        });
      }

      // Updated Record(s) Audit
      for (const rec of updatedRecs) {
        const prevRec = prevRecords.find((p: any) => p.id === rec.id) || {};
        await recordEvent(req, {
          event: "lab.result_updated",
          entity: { type: "Laboratory Result", id, name: entityName },
          changes: diffFields(prevRec, rec, ["decision", "qcCode", "date", "comments"]),
          facts: { qcCode: rec.qcCode || null },
          reason: reasonInput || null,
        });
      }

      // Deleted Record(s) Audit — the QC code and the verdict that was removed,
      // not a copy of the record (rule 16).
      for (const rec of deletedRecs) {
        await recordEvent(req, {
          event: "lab.result_removed",
          entity: { type: "Laboratory Result", id, name: entityName },
          facts: { qcCode: rec.qcCode || null, decision: rec.decision },
          reason: reasonInput || null,
        });
      }

      // Fallback when the list changed without any record being added, edited
      // or removed — a reordering, say. Reported as a count so the row still
      // says something rather than repeating the list.
      if (addedRecs.length === 0 && updatedRecs.length === 0 && deletedRecs.length === 0
        && JSON.stringify(prevRecords) !== JSON.stringify(newRecords)) {
        await recordEvent(req, {
          event: "lab.result_updated",
          entity: { type: "Laboratory Result", id, name: entityName },
          changes: [{ field: "analysisRecordCount", from: prevRecords.length, to: newRecords.length }],
          reason: reasonInput || null,
        });
      }

      // 2. The effective status the lab result drove. Recorded as the same
      // disqualification and reinstatement a person can make, because that is
      // what it is — only the actor differs, and the actor is a column.
      if (isSystemAutoReject) {
        await recordEvent(req, {
          event: "source.disqualified",
          actor: { username: "system", name: "سیستم (خودکار)", role: "system" },
          entity: { type: "Source", id, name: entityName },
          changes: [{ field: "status", from: current.status, to: "rejected" }],
          facts: { rejectCount: newCounters.reject },
          reason: "ثبت نتیجهٔ مردود آزمایشگاه",
        });
      } else if (isSystemAutoRestore) {
        await recordEvent(req, {
          event: "source.reinstated",
          actor: { username: "system", name: "سیستم (خودکار)", role: "system" },
          entity: { type: "Source", id, name: entityName },
          changes: [{ field: "status", from: "rejected", to: finalStatus }],
          reason: "دیگر نتیجهٔ مردود فعالی وجود ندارد",
        });
      }

      console.log(`[UnifiedDB] Saved fine-grained analysis record & Phase 5 Audit logged for vendor: ${id}`);
      res.json({ success: true, part: "analysis", vendor: result });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // Update vendor risk assessment (Unified Database)
  router.patch("/api/vendors/:id/risk", requireAuth, requirePermission("vendor.risk"), serializeVendorWrites, async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (staleCopy(req, current)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }
      const validationResult = vendorRiskSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Validation failed", details: validationResult.error.issues });
      }
      const r = validationResult.data;
      const updatedVendor = {
        ...current,
        riskAssessment: r.riskAssessment ?? current.riskAssessment
      };
      await saveVendorToDb(updatedVendor, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);

      // Audit Trail Integration
      const isSource = !!(result.isSample || result.category === 'sample' || current.isSample || current.category === 'sample');
      const entityName = isSource ? (result.material || result.name) : result.name;

      const prevRisk = current.riskAssessment || null;
      const newRisk = result.riskAssessment || {};

      const reasonInput = req.body.reasonForChange || req.body.reason || "ویرایش پارامترهای FMEA / RPN / SRI";

      // 1. User Change Audit
      await recordEvent(req, {
        event: "risk.assessed",
        entity: { type: "Risk Assessment", id, name: entityName },
        // The FMEA parameters only: `beforeObj` also carries the material and
        // the supplier, which do not change here and are named in the columns.
        changes: riskChanges(prevRisk, newRisk),
        facts: riskFacts(newRisk),
        reason: reasonInput || null,
      });

      // The RPN, the SRI and the risk level are computed from the severity,
      // occurrence and detectability that the row above already records, so a
      // second "recalculated" row restated the first one. Dropped with the
      // rewrite.

      console.log(`[UnifiedDB] Saved fine-grained risk assessment & FMEA audit for vendor: ${id}`);
      res.json({ success: true, part: "risk", vendor: result });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // Delete vendor (Unified Database)
  router.delete("/api/vendors/:id", requireAuth, requirePermission("vendor.delete"), serializeVendorWrites, async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (staleCopy(req, current)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }

      const success = await deleteVendorFromDb(id);
      if (success) {
        const isSource = !!(current.isSample || current.category === 'sample');
          const entityType = isSource ? "Source" : "Supplier";
        const entityName = isSource ? (current.material || current.name) : current.name;
  
        await recordEvent(req, {
          event: "source.deleted",
          entity: { type: entityType, id, name: entityName },
          reason: req.body?.reasonForChange || req.body?.reason || null,
        });

        console.log(`[UnifiedDB] Deleted vendor relational files: ${id}`);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Vendor not found" });
      }
    } catch (error: any) {
      console.error("Failed to delete vendor:", error);
      res.status(500).json({ error: "Failed to delete vendor" });
    }
  });

  // ==========================================
  // --- Audit Trail Endpoints ---
  // ==========================================

  return router;
}
