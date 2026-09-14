import express from "express";
import { auditRowValues, diffFields, recordEvent } from "../../utils/auditEvents.js";
import { vendorSchema } from "../../utils/validation.js";
import { can, SOURCE_LIST_VIEWS, VIEW_PERMISSIONS, type Permission } from "../../utils/permissions.js";
import { readableVendors, readsEverySource } from "../../utils/decisionGuards.js";
import { requirePrisma } from "../db/prisma.js";
import { ircViolation, sopPartnerViolation } from "../domain/sourceRules.js";
import {
  applyAnalysisSection, applyContactSection, applyLogsSection, applyProfileSection,
  applyRiskSection, applyScoresSection, isRefusal, riskChanges, riskFacts, verdictEvent,
  type SectionOutcome,
} from "../domain/vendorSections.js";
import { settleSourceVerdict } from "../domain/sourceVerdict.js";
import { requireAnyPermission, requireAuth, requirePermission } from "../http/auth.js";
import { sendHandlerError } from "../http/errors.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, clampInt } from "../http/query.js";
import { STALE_COPY_MESSAGE, staleCopy } from "../http/recordLock.js";
import {
  countVendors, deleteVendorFromDb, getVendorById,
  getVendorChangesSince, getVendorsList, saveVendorToDb, serializeVendorWrites,
} from "../repositories/vendorRepository.js";

/**
 * The source records: the register this system exists to keep.
 *
 * A source is edited part by part — profile, contact, scores, laboratory
 * results, activity log, risk — because different departments own different
 * parts and a whole-object write would let one of them silently overwrite
 * another's column. Each part has its own `PATCH`, and `PUT /api/vendors/:id`
 * writes any combination of them in a single transaction for the case the
 * client actually has: one person pressing save on a form that spans several.
 * The rules themselves live once, in `domain/vendorSections.ts`.
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
 * Which views a source list can be opened as, and what each one requires.
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

/**
 * The reason a caller gave for the change, under either of the two names the
 * clients have used for it.
 */
function reasonFor(req: any): string | null {
  return req.body?.reasonForChange || req.body?.reason || null;
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

      /*
       * A named handful, for the background poll.
       *
       * `GET /api/vendors/changes` answers with the ids that moved and nothing
       * else, and the client's only way to spend them was to re-read the whole
       * register — nine megabytes on ten thousand sources, every thirty seconds
       * while a second operator kept saving. The rows are still filtered by
       * `readableVendors`, so asking for an id by name grants nothing that
       * listing would not.
       *
       * Capped, because this is a shortcut and not a second way to page: a
       * caller that needs more than a page of records needs the paged list.
       */
      const idsParam = typeof req.query.ids === "string" ? req.query.ids : null;
      if (idsParam !== null) {
        const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, MAX_PAGE_SIZE);
        if (ids.length === 0) {
          return res.json([]);
        }
        const rows = await getVendorsList(ids);
        return res.json(everything ? rows : readableVendors(req.account, rows));
      }
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
    
      // An id for a source that arrived without one. The branch that used to
      // stand here tested whether the record had a CAS or an IRC and then built
      // the identical id either way \u2014 the material-name slug it computed for the
      // "special" case was never read.
      v.id = v.id || `vend_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
    
      const existing = await getVendorById(v.id);

      const ircError = ircViolation((v as any).irc, (existing as any)?.irc);
      if (ircError) {
        return res.status(422).json({ error: ircError });
      }

      const sopError = await sopPartnerViolation(v as any, existing as any);
      if (sopError) {
        recordEvent(req, {
          event: "access.denied",
          entity: { type: "Source", id: v.id, name: (v as any).material || v.name || "سورس" },
          facts: { attempted: "ثبت سورس با فروشندهٔ فاقد گرید A", supplierId: (v as any).supplierId },
          reason: sopError,
        });
        return res.status(422).json({ error: sopError });
      }

      // The qualification is the server's to settle, not the caller's (rule
      // 11c). Runs after the guards above, so the verdict they judged is the
      // one the caller actually sent.
      await saveVendorToDb(settleSourceVerdict(v, { previous: existing, assertedStatus: req.body?.status }));
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
      const outcome = await applyProfileSection(
        req, current, current, req.body, reasonFor(req),
      );
      if (isRefusal(outcome)) return res.status(outcome.status).json(outcome.body);

      await saveVendorToDb(
        settleSourceVerdict(outcome.merged, { previous: current, assertedStatus: req.body?.status }),
        (current as any)?.updatedAt ?? null,
      );
      const result = await getVendorById(id);
      await outcome.audit(result);

      console.log(`[UnifiedDB] Saved fine-grained profile details for vendor: ${id}`);
      res.json({ success: true, part: "profile", vendor: result });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  /**
   * One save of a whole source, in one transaction.
   *
   * The six `PATCH` routes below stay exactly as they are and keep working —
   * this is what the client uses instead of calling several of them in a row.
   *
   * What the queue could not do:
   *  - **All or nothing.** A save that changed the profile, the scores and the
   *    risk assessment was three requests. A refusal or a dropped connection on
   *    the second left the first one stored and the third never sent, in a
   *    combination nobody asked for, and the client could not roll it back: by
   *    then only the server knew what had landed. Here the parts are checked
   *    first and written once — the first refusal abandons the save entirely.
   *  - **One version claim.** Each `PATCH` moved `updatedAt`, so the client had
   *    to thread the new timestamp from every response into the next request or
   *    be refused with a 409 that had nobody on the other side of it. One
   *    request makes one claim (rule 11a).
   *  - **One trail entry per thing that happened.** The audit rows are still
   *    written per part, because that is what they describe — but from a single
   *    re-read of the saved record, so they agree with each other.
   *
   * Absent means untouched: a part the payload does not carry is not written,
   * the same contract `persistVendorRelations` already has. The middleware only
   * keeps out callers entitled to none of the parts; which parts a caller may
   * actually write is decided per part, against what is stored (rule 14).
   */
  router.put("/api/vendors/:id", requireAuth,
    requireAnyPermission(
      "vendor.edit", "vendor.decide", "sample.decide", "vendor.analysis", "vendor.risk",
      "score.commercial", "score.qa", "score.planning", "score.finance",
    ),
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

      const sections = req.body?.sections;
      if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
        return res.status(400).json({ error: "Validation failed", details: "sections مورد انتظار است." });
      }
      const reason = reasonFor(req);

      /*
       * Order matters, and it is the order the queue used to send in.
       *
       * The profile decides the verdict and the scores feed it; the analysis
       * part merges onto whatever status the profile settled on rather than the
       * stored one. Reordering these would change what is saved, so the list is
       * fixed here rather than taken from the payload's key order.
       */
      const parts: Array<[string, (base: any, payload: any) => Promise<SectionOutcome>]> = [
        ["profile", (base, payload) => applyProfileSection(req, current, base, payload, reason)],
        ["contact", (base, payload) => applyContactSection(req, current, base, payload, reason)],
        ["scores", (base, payload) => applyScoresSection(req, current, base, payload, reason)],
        ["analysis", (base, payload) => applyAnalysisSection(req, current, base, payload, reason)],
        ["logs", (base, payload) => applyLogsSection(req, current, base, payload, reason)],
        ["risk", (base, payload) => applyRiskSection(req, current, base, payload, reason)],
      ];

      let merged: any = current;
      const applied: string[] = [];
      const audits: Array<(result: any) => Promise<void>> = [];

      for (const [name, apply] of parts) {
        const payload = sections[name];
        if (payload === undefined || payload === null) continue;
        const outcome = await apply(merged, payload);
        // Nothing has been written yet, so a refusal here costs the caller the
        // whole save — which is the point of it.
        if (isRefusal(outcome)) return res.status(outcome.status).json(outcome.body);
        merged = outcome.merged;
        audits.push(outcome.audit);
        applied.push(name);
      }

      if (applied.length === 0) {
        return res.status(400).json({ error: "Validation failed", details: "هیچ بخشی برای ذخیره ارسال نشده است." });
      }

      // After the guards, never before: a status the server itself computed
      // must not be charged to the caller (rule 11).
      await saveVendorToDb(
        settleSourceVerdict(merged, {
          previous: current,
          // Only a profile save states a verdict. When the payload carries no
          // profile the stored decision stands, exactly as on `PATCH /scores`.
          assertedStatus: sections.profile ? sections.profile.status : undefined,
        }),
        (current as any)?.updatedAt ?? null,
      );
      const result = await getVendorById(id);
      for (const audit of audits) await audit(result);

      res.json({ success: true, parts: applied, vendor: result });
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
      const outcome = await applyContactSection(
        req, current, current, req.body, reasonFor(req),
      );
      if (isRefusal(outcome)) return res.status(outcome.status).json(outcome.body);

      await saveVendorToDb(outcome.merged, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);
      await outcome.audit(result);

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
      const outcome = await applyScoresSection(
        req, current, current, req.body, reasonFor(req),
      );
      if (isRefusal(outcome)) return res.status(outcome.status).json(outcome.body);

      /*
       * The grade follows the scores, through the same rubric everything else
       * uses — and no `assertedStatus`: scores never decide. The merge spreads
       * the stored row, so a stale «rejected» would otherwise read as a fresh
       * verdict and re-latch the record that rule 11 exists to free.
       */
      await saveVendorToDb(
        settleSourceVerdict(outcome.merged, { previous: current }),
        (current as any)?.updatedAt ?? null,
      );
      const result = await getVendorById(id);
      await outcome.audit(result);

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
      const outcome = await applyLogsSection(
        req, current, current, req.body, reasonFor(req),
      );
      if (isRefusal(outcome)) return res.status(outcome.status).json(outcome.body);

      await saveVendorToDb(outcome.merged, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);
      await outcome.audit(result);

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
      const outcome = await applyAnalysisSection(
        req, current, current, req.body, reasonFor(req),
      );
      if (isRefusal(outcome)) return res.status(outcome.status).json(outcome.body);

      await saveVendorToDb(outcome.merged, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);
      await outcome.audit(result);

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
      const outcome = await applyRiskSection(
        req, current, current, req.body, reasonFor(req),
      );
      if (isRefusal(outcome)) return res.status(outcome.status).json(outcome.body);

      await saveVendorToDb(outcome.merged, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);
      await outcome.audit(result);

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
