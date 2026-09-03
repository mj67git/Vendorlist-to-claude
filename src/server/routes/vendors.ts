import express from "express";
import { AuditService } from "../../utils/auditService.js";
import { calculateGradeAndStatus } from "../../utils/sopEvaluation.js";
import {
  vendorAnalysisSchema, vendorContactSchema, vendorLogsSchema, vendorProfileSchema,
  vendorRiskSchema, vendorSchema, vendorScoreSchema,
} from "../../utils/validation.js";
import {
  canScoreDepartment, forbiddenRawScoreChanges, forbiddenScoreChanges,
} from "../../utils/permissions.js";
import { requirePrisma } from "../db/prisma.js";
import { ircViolation, sopSupplierViolation } from "../domain/sourceRules.js";
import {
  CALCULATION_WEIGHTS, GRADE_TIERS, calculateRoundedWeightedScore,
  calculateWeightedScore, rankVendor,
} from "../domain/vendorEvaluation.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { sendHandlerError } from "../http/errors.js";
import { getClientIp, getUserAgent } from "../http/requestInfo.js";
import { getUserByUsername } from "../repositories/userRepository.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, clampInt } from "../http/query.js";
import {
  countVendors, deleteVendorFromDb, getRankingSnapshot, getVendorById, getVendorRank,
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
 * The copy this caller edited is still the current one — or it is not.
 *
 * The per-request `updatedAt` precondition in `saveVendorToDb` only closes the
 * window between a handler's own read and its own write, which is the race
 * between two requests in flight at the same time. It says nothing about the
 * older and more common case: somebody opened a form, went to a meeting, and
 * saved an hour later over three edits made in between. The handler re-reads
 * the row, merges the incoming fields into it and writes — so the stale form
 * silently wins for every field it carries.
 *
 * So the client sends back the `updatedAt` it read, and this compares it with
 * the row as it stands now. A mismatch is refused with 409 before any work is
 * done, and the client re-reads and tells the operator.
 *
 * Absent means "not claimed": an older client, a script, or the create path
 * keeps exactly the behaviour it had. An unparseable value is treated the same
 * way rather than failing the request, because a broken clock must not make the
 * register unwritable.
 */
function staleCopy(req: any, current: any): boolean {
  const claimed = req?.body?.expectedUpdatedAt;
  if (typeof claimed !== "string" || claimed === "") return false;
  const asked = new Date(claimed);
  if (Number.isNaN(asked.getTime())) return false;
  const actual = current?.updatedAt ? new Date(current.updatedAt) : null;
  if (!actual || Number.isNaN(actual.getTime())) return false;
  return asked.getTime() !== actual.getTime();
}

const STALE_COPY_MESSAGE =
  "این رکورد هم‌زمان توسط شخص دیگری تغییر کرده است. نسخهٔ تازه بارگذاری شد؛ تغییر خود را دوباره اعمال کنید.";

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
      const paged = req.query.page !== undefined || req.query.limit !== undefined;
      if (!paged) {
        res.json(await getVendorsList());
        return;
      }

      // Clamped rather than rejected: a junk value should still answer with
      // something usable, and an unbounded `limit` would hand a caller the very
      // whole-table response paging exists to avoid.
      const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
      const limit = clampInt(req.query.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

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
      const { changed, total } = await getVendorChangesSince(since);
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
        const after: any = r.afterData || {};
        const before: any = r.beforeData || {};
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
        const after: any = r.afterData || {};
        const before: any = r.beforeData || {};
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
        AuditService.createAuditRecord({
          auditId: `AUD-SOP-${Date.now()}`,
          userId: req.user?.username,
          userName: req.user?.name || req.user?.username,
          role: req.user?.role,
          module: "Source Management",
          eventType: "Data Change",
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
          entityType: "Source",
          entityId: v.id,
          entityName: (v as any).material || v.name || "سورس",
          action: "Delete - Blocked",
          severity: "Warning",
          description: `ثبت سورس به دلیل عدم احراز شرایط SOP فروشنده رد شد: ${sopError}`,
          reasonForChange: "دستورالعمل SOP: فقط فروشندهٔ دارای گرید A قابل انتخاب است",
          beforeData: null,
          afterData: { supplierId: (v as any).supplierId, refusal: sopError },
        }).catch(err => console.error("Audit logging failed on SOP refusal:", err));
        return res.status(422).json({ error: sopError });
      }

      await saveVendorToDb(v);
      const updated = await getVendorById(v.id);

      // Audit Trail integration
      const isSource = !!(v.isSample || v.category === 'sample' || existing?.isSample || existing?.category === 'sample');
      const moduleName = isSource ? "Source Management" : "Supplier Management";
      const entityType = isSource ? "Source" : "Supplier";
      const entityName = isSource ? (updated.material || updated.name || "سورس") : (updated.name || "تامین‌کننده");
      const userObj = req.user || {};
      const reasonForChange = req.body.reasonForChange || req.body.reason || null;

      if (!existing) {
        // Create Operation
        const afterData = isSource ? {
          sourceName: updated.material || updated.name,
          supplier: updated.name,
          material: updated.material,
          category: updated.category,
          isSample: updated.isSample,
          initialSampleStatus: updated.initialSampleStatus || 'approved',
          approvalStatus: updated.status || 'approved',
          country: updated.country,
          contactInfo: updated.contactInfo
        } : {
          supplierName: updated.name,
          supplierNameEn: updated.nameEn,
          country: updated.country,
          contactInfo: updated.contactInfo,
          category: updated.category,
          status: updated.status,
          grade: updated.grade,
          riskLevel: updated.riskAssessment ? (typeof updated.riskAssessment === 'string' ? updated.riskAssessment : JSON.stringify(updated.riskAssessment)) : null
        };

        await AuditService.createAuditRecord({
          auditId: `AUD-${isSource ? 'SRC' : 'SUP'}-CRT-${Date.now()}`,
          userId: userObj.username || 'system',
          userName: userObj.name || userObj.username || 'کاربر سیستم',
          role: userObj.role || 'user',
          module: moduleName,
          entityType,
          entityId: updated.id,
          entityName,
          action: "Create",
          severity: "Information",
          description: isSource ? `ثبت سورس جدید "${entityName}"` : `ثبت تامین‌کننده جدید "${entityName}"`,
          reasonForChange: reasonForChange || (isSource ? "ثبت سورس جدید در سیستم" : "ثبت تامین‌کننده جدید در سیستم"),
          beforeData: null,
          afterData
        }).catch(err => console.error("Audit logging failed on POST /api/vendors create:", err));
      } else {
        // Update Operation - track diffs
        const beforeData: Record<string, any> = {};
        const afterData: Record<string, any> = {};

        const fieldsToTrack = [
          'name', 'nameEn', 'country', 'contactInfo', 'category', 'status', 'grade',
          'material', 'materialEn', 'cas', 'irc', 'isSample', 'initialSampleStatus'
        ];

        let isCritical = false;
        let hasChanges = false;

        fieldsToTrack.forEach(field => {
          const oldVal = existing[field];
          const newVal = updated[field];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            beforeData[field] = oldVal ?? null;
            afterData[field] = newVal ?? null;
            hasChanges = true;

            if (field === 'status' || field === 'grade' || field === 'initialSampleStatus') {
              if (newVal === 'rejected' || newVal === 'black list' || newVal === 'reject') {
                isCritical = true;
              }
            }
          }
        });

        if (hasChanges) {
          const severity = isCritical ? "Critical" : "Warning";
          await AuditService.createAuditRecord({
            auditId: `AUD-${isSource ? 'SRC' : 'SUP'}-UPD-${Date.now()}`,
            userId: userObj.username || 'system',
            userName: userObj.name || userObj.username || 'کاربر سیستم',
            role: userObj.role || 'user',
            module: moduleName,
            entityType,
            entityId: updated.id,
            entityName,
            action: "Update",
            severity,
            description: isSource ? `ویرایش سورس "${entityName}"` : `ویرایش تامین‌کننده "${entityName}"`,
            reasonForChange: reasonForChange || (isSource ? "ویرایش اطلاعات سورس" : "ویرایش اطلاعات تامین‌کننده"),
            beforeData,
            afterData
          }).catch(err => console.error("Audit logging failed on POST /api/vendors update:", err));
        }
      }

      // Dedicated Risk Assessment audit (enables risk-history reconstruction)
      try {
        const oldRisk = existing?.riskAssessment || null;
        const newRisk = updated?.riskAssessment || null;
        if (JSON.stringify(oldRisk) !== JSON.stringify(newRisk) && newRisk) {
          const riskCritical = newRisk.riskLevel === 'High';
          await AuditService.createAuditRecord({
            auditId: `AUD-${isSource ? 'SRC' : 'SUP'}-RSK-${Date.now()}`,
            userId: userObj.username || 'system',
            userName: newRisk.evaluator || userObj.name || userObj.username || 'کاربر سیستم',
            role: userObj.role || 'user',
            module: "Risk Management",
            entityType: "Risk Assessment",
            entityId: updated.id,
            entityName,
            action: oldRisk ? "Update" : "Create",
            severity: riskCritical ? "Critical" : "Warning",
            description: `ثبت/به‌روزرسانی ارزیابی ریسک "${entityName}" — سطح ریسک: ${newRisk.riskLevel}، RPN: ${newRisk.riskScore}، SRI: ${newRisk.sri}`,
            reasonForChange: reasonForChange || "ثبت ارزیابی ریسک FMEA",
            beforeData: oldRisk,
            afterData: newRisk
          }).catch(err => console.error("Audit logging failed on risk assessment:", err));
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
  router.patch("/api/vendors/:id/profile", requireAuth, requirePermission("vendor.edit"), serializeVendorWrites, async (req: any, res) => {
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
        AuditService.createAuditRecord({
          auditId: `AUD-IRC-${Date.now()}`,
          userId: req.user?.username,
          userName: req.user?.name || req.user?.username,
          role: req.user?.role,
          module: "Source Management",
          eventType: "Data Change",
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
          entityType: "Source",
          entityId: id,
          entityName: current.material || current.name || "سورس",
          action: "Delete - Blocked",
          severity: "Warning",
          description: `ویرایش سورس به دلیل نامعتبر بودن کد IRC رد شد: ${ircError}`,
          reasonForChange: "قاعدهٔ IRC: کد باید دقیقاً ۱۶ رقم عددی باشد",
          beforeData: { irc: (current as any).irc ?? null },
          afterData: { irc: (p as any).irc ?? null, refusal: ircError },
        }).catch(err => console.error("Audit logging failed on IRC refusal:", err));
        return res.status(422).json({ error: ircError });
      }

      const sopError = await sopSupplierViolation((updatedVendor as any).supplierId, (current as any).supplierId);
      if (sopError) {
        AuditService.createAuditRecord({
          auditId: `AUD-SOP-${Date.now()}`,
          userId: req.user?.username,
          userName: req.user?.name || req.user?.username,
          role: req.user?.role,
          module: "Source Management",
          eventType: "Data Change",
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
          entityType: "Source",
          entityId: id,
          entityName: current.material || current.name || "سورس",
          action: "Delete - Blocked",
          severity: "Warning",
          description: `ثبت سورس به دلیل عدم احراز شرایط SOP فروشنده رد شد: ${sopError}`,
          reasonForChange: "دستورالعمل SOP: فقط فروشندهٔ دارای گرید A قابل انتخاب است",
          beforeData: null,
          afterData: { supplierId: (updatedVendor as any).supplierId, refusal: sopError },
        }).catch(err => console.error("Audit logging failed on SOP refusal:", err));
        return res.status(422).json({ error: sopError });
      }

      await saveVendorToDb(updatedVendor, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);

      // Audit Trail Integration
      const isSource = !!(result.isSample || result.category === 'sample' || current.isSample || current.category === 'sample');
      const moduleName = isSource ? "Source Management" : "Supplier Management";
      const entityType = isSource ? "Source" : "Supplier";
      const entityName = isSource ? (result.material || result.name) : result.name;
      const userObj = req.user || {};
      const reasonForChange = req.body.reasonForChange || req.body.reason || null;

      const beforeData: Record<string, any> = {};
      const afterData: Record<string, any> = {};
      let isCritical = false;
      let hasChanges = false;

      Object.keys(p).forEach(key => {
        const oldVal = current[key];
        const newVal = result[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          beforeData[key] = oldVal ?? null;
          afterData[key] = newVal ?? null;
          hasChanges = true;
          if (key === 'status' || key === 'grade' || key === 'initialSampleStatus') {
            if (newVal === 'rejected' || newVal === 'black list' || newVal === 'reject') {
              isCritical = true;
            }
          }
        }
      });

      if (hasChanges) {
        const severity = isCritical ? "Critical" : "Warning";
        await AuditService.createAuditRecord({
          auditId: `AUD-${isSource ? 'SRC' : 'SUP'}-PRF-${Date.now()}`,
          userId: userObj.username || 'system',
          userName: userObj.name || userObj.username || 'کاربر سیستم',
          role: userObj.role || 'user',
          module: moduleName,
          entityType,
          entityId: id,
          entityName,
          action: "Update",
          severity,
          description: isSource ? `ویرایش پروفایل سورس "${entityName}"` : `ویرایش پروفایل تامین‌کننده "${entityName}"`,
          reasonForChange: reasonForChange || (isSource ? "بروزرسانی مشخصات سورس" : "بروزرسانی مشخصات تامین‌کننده"),
          beforeData,
          afterData
        }).catch(err => console.error("Audit logging failed on profile update:", err));
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
      const moduleName = isSource ? "Source Management" : "Supplier Management";
      const entityType = isSource ? "Source" : "Supplier";
      const entityName = isSource ? (result.material || result.name) : result.name;
      const userObj = req.user || {};

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
        await AuditService.createAuditRecord({
          auditId: `AUD-${isSource ? 'SRC' : 'SUP'}-CNT-${Date.now()}`,
          userId: userObj.username || 'system',
          userName: userObj.name || userObj.username || 'کاربر سیستم',
          role: userObj.role || 'user',
          module: moduleName,
          entityType,
          entityId: id,
          entityName,
          action: "Update",
          severity: "Warning",
          description: isSource ? `بروزرسانی اطلاعات تماس سورس "${entityName}"` : `بروزرسانی اطلاعات تماس تامین‌کننده "${entityName}"`,
          reasonForChange: req.body.reasonForChange || req.body.reason || "تغییر اطلاعات تماس یا آخرین تاریخ ممیزی",
          beforeData,
          afterData
        }).catch(err => console.error("Audit logging failed on contact update:", err));
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

      const allVendorsBefore = await getRankingSnapshot();
      const prevRank = getVendorRank(id, allVendorsBefore);

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

      const allVendorsAfter = await getRankingSnapshot();
      const newRank = getVendorRank(id, allVendorsAfter);

      const newScores = result.scores || { commercial: 0, qa: 0, planning: 0, finance: 0 };
      const newSPS = Math.round(
        calculateWeightedScore(newScores, CALCULATION_WEIGHTS) * 10,
      ) / 10;

      // Audit Trail Integration
      const isSource = !!(result.isSample || result.category === 'sample' || current.isSample || current.category === 'sample');
      const moduleName = isSource ? "Source Management" : "Supplier Management";
      const entityName = isSource ? (result.material || result.name) : result.name;
      const userObj = req.user || {};

      const isCritical = result.status === 'rejected' || result.grade === 'rejected' || result.grade === 'black list';
      const severity = isCritical ? "Critical" : "Warning";

      // 1. Audit SPS Score Update
      await AuditService.createAuditRecord({
        auditId: `AUD-${isSource ? 'SRC' : 'SUP'}-SCR-${Date.now()}`,
        userId: userObj.username || 'system',
        userName: userObj.name || userObj.username || 'کاربر سیستم',
        role: userObj.role || 'user',
        module: moduleName,
        entityType: "Score",
        entityId: id,
        entityName,
        action: "Update",
        severity,
        description: isSource 
          ? `ثبت ارزیابی و تغییر امتیاز SPS سورس "${entityName}" (SPS: ${prevSPS} -> ${newSPS}, Grade: ${prevGrade} -> ${result.grade})`
          : `ثبت ارزیابی و تغییر امتیاز SPS تامین‌کننده "${entityName}" (SPS: ${prevSPS} -> ${newSPS}, Grade: ${prevGrade} -> ${result.grade})`,
        reasonForChange: req.body.reasonForChange || req.body.reason || "ثبت/ویرایش امتیازات ارزیابی دوره‌ای بخش‌های مختلف",
        beforeData: {
          totalSPS: prevSPS,
          grade: prevGrade,
          qualityScore: prevScores.qa,
          financeScore: prevScores.finance,
          commercialScore: prevScores.commercial,
          planningScore: prevScores.planning,
          status: current.status
        },
        afterData: {
          totalSPS: newSPS,
          grade: result.grade,
          qualityScore: newScores.qa,
          financeScore: newScores.finance,
          commercialScore: newScores.commercial,
          planningScore: newScores.planning,
          status: result.status
        }
      }).catch(err => console.error("Audit logging failed on scores update:", err));

      // 2. Audit Ranking Change if Rank Position Changed
      if (prevRank !== newRank && prevRank > 0 && newRank > 0) {
        await AuditService.createAuditRecord({
          auditId: `AUD-RNK-SYS-${Date.now()}`,
          userId: 'system',
          userName: 'سیستم (خودکار)',
          role: 'system',
          module: moduleName,
          entityType: "Ranking",
          entityId: id,
          entityName,
          action: "System Calculation",
          severity: "Information",
          description: `تغییر خودکار رتبه تامین‌کننده/سورس "${entityName}" در جدول رتبه‌بندی (رتبه قبلی: ${prevRank}, رتبه جدید: ${newRank})`,
          reasonForChange: "SPS score recalculated",
          beforeData: {
            previousRank: prevRank,
            previousSPS: prevSPS,
            previousGrade: prevGrade
          },
          afterData: {
            newRank: newRank,
            newSPS: newSPS,
            newGrade: result.grade
          }
        }).catch(err => console.error("Audit logging failed on ranking change:", err));
      }

      console.log(`[UnifiedDB] Saved fine-grained scores details & updated business calculations for vendor: ${id}`);
      res.json({ success: true, part: "scores", vendor: result });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // Update vendor activity logs (Unified Database)
  router.patch("/api/vendors/:id/logs", requireAuth, requirePermission("vendor.edit"), serializeVendorWrites, async (req: any, res) => {
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
        const userObj = req.user || {};
        const now = new Date();
        await AuditService.createAuditRecord({
          auditId: `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
          correlationId: crypto.randomUUID(),
          userId: userObj.username || 'system',
          userName: userObj.name || userObj.username || 'کاربر سیستم',
          role: userObj.role || 'user',
          module: "Source Management",
          entityType: "ActivityLog",
          entityId: id,
          entityName: current.name || id,
          action: nextLogs.length >= prevLogs.length ? "Create" : "Delete",
          severity: nextLogs.length < prevLogs.length ? "Warning" : "Information",
          description: nextLogs.length >= prevLogs.length
            ? `ثبت سابقهٔ فعالیت برای سورس "${current.name || id}" (${prevLogs.length} → ${nextLogs.length} مورد)`
            : `حذف سابقهٔ فعالیت از سورس "${current.name || id}" (${prevLogs.length} → ${nextLogs.length} مورد)`,
          reasonForChange: (req.body?.reasonForChange as string) || "ویرایش سوابق فعالیت سورس",
          beforeData: { activityLogCount: prevLogs.length, activityLogs: prevLogs },
          afterData: { activityLogCount: nextLogs.length, activityLogs: nextLogs },
        }).catch(err => console.error("Audit logging failed on activity logs update:", err));
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

      const prevCounters = countDecisions(prevRecords);
      const newCounters = countDecisions(newRecords);

      let finalStatus = current.status;
      let isSystemAutoReject = false;
      let isSystemAutoRestore = false;

      const isSource = !!(current.isSample || current.category === "sample");

      if (isSource) {
        if (newCounters.reject >= 1) {
          finalStatus = "rejected";
          if (current.status !== "rejected" || prevCounters.reject === 0) {
            isSystemAutoReject = true;
          }
        } else {
          finalStatus = current.initialSampleStatus || "approved";
          if (current.status === "rejected" || prevCounters.reject >= 1) {
            isSystemAutoRestore = true;
          }
        }
      }

      const updatedVendor = {
        ...current,
        status: finalStatus,
        analysisRecords: newRecords,
        activityLogs: a.activityLogs ?? current.activityLogs
      };
      await saveVendorToDb(updatedVendor, (current as any)?.updatedAt ?? null);
      const result = await getVendorById(id);

      const userObj = req.user || {};
      const entityName = isSource ? (result.material || result.name) : result.name;
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
        const isReject = rec.decision === 'Reject';
        await AuditService.createAuditRecord({
          auditId: `AUD-LAB-CRT-${Date.now()}-${Math.floor(Math.random()*1000)}`,
          userId: userObj.username || 'system',
          userName: userObj.name || userObj.username || 'کاربر سیستم',
          role: userObj.role || 'lab',
          module: "Laboratory",
          entityType: "Laboratory Result",
          entityId: id,
          entityName: `${entityName} (کد QC: ${rec.qcCode || 'N/A'})`,
          action: "Create",
          severity: isReject ? "Critical" : "Information",
          description: `ثبت نتیجه آزمایشگاهی جدید برای سورس "${entityName}" با کد آزمون ${rec.qcCode || 'N/A'} (تصمیم: ${rec.decision})`,
          reasonForChange: reasonInput || "ثبت جدید آنالیز کنترل کیفیت",
          beforeData: null,
          afterData: {
            sourceId: id,
            sourceName: entityName,
            material: current.material || entityName,
            testName: rec.qcCode,
            testResult: rec.comments || 'مطابق مشخصات',
            decision: rec.decision,
            date: rec.date,
            recordedBy: rec.recordedBy || userObj.name,
            previousCounters: prevCounters,
            newCounters: newCounters
          }
        }).catch(err => console.error("Audit logging failed on lab result create:", err));
      }

      // Updated Record(s) Audit
      for (const rec of updatedRecs) {
        const prevRec = prevRecords.find((p: any) => p.id === rec.id) || {};
        const isReject = rec.decision === 'Reject';
        await AuditService.createAuditRecord({
          auditId: `AUD-LAB-UPD-${Date.now()}-${Math.floor(Math.random()*1000)}`,
          userId: userObj.username || 'system',
          userName: userObj.name || userObj.username || 'کاربر سیستم',
          role: userObj.role || 'lab',
          module: "Laboratory",
          entityType: "Laboratory Result",
          entityId: id,
          entityName: `${entityName} (کد QC: ${rec.qcCode || 'N/A'})`,
          action: "Update",
          severity: isReject ? "Critical" : "Warning",
          description: `ویرایش نتیجه آزمایشگاهی برای سورس "${entityName}" (تغییر تصمیم از ${prevRec.decision} به ${rec.decision})`,
          reasonForChange: reasonInput || "ویرایش آنالیز آزمایشگاه",
          beforeData: {
            sourceId: id,
            sourceName: entityName,
            material: current.material || entityName,
            testName: prevRec.qcCode,
            testResult: prevRec.comments,
            decision: prevRec.decision,
            date: prevRec.date,
            previousCounters: prevCounters
          },
          afterData: {
            sourceId: id,
            sourceName: entityName,
            material: current.material || entityName,
            testName: rec.qcCode,
            testResult: rec.comments,
            decision: rec.decision,
            date: rec.date,
            newCounters: newCounters
          }
        }).catch(err => console.error("Audit logging failed on lab result update:", err));
      }

      // Deleted Record(s) Audit
      for (const rec of deletedRecs) {
        await AuditService.createAuditRecord({
          auditId: `AUD-LAB-DEL-${Date.now()}-${Math.floor(Math.random()*1000)}`,
          userId: userObj.username || 'system',
          userName: userObj.name || userObj.username || 'کاربر سیستم',
          role: userObj.role || 'lab',
          module: "Laboratory",
          entityType: "Laboratory Result",
          entityId: id,
          entityName: `${entityName} (کد QC: ${rec.qcCode || 'N/A'})`,
          action: "Delete",
          severity: "Critical",
          description: `حذف نتیجه آزمایشگاهی سورس "${entityName}" با کد QC: ${rec.qcCode || 'N/A'} (تصمیم قبلی: ${rec.decision})`,
          reasonForChange: reasonInput || "حذف رکورد نتایج آزمایشگاه",
          beforeData: {
            sourceId: id,
            sourceName: entityName,
            material: current.material || entityName,
            testName: rec.qcCode,
            testResult: rec.comments,
            decision: rec.decision,
            date: rec.date,
            recordedBy: rec.recordedBy,
            previousCounters: prevCounters
          },
          afterData: {
            deleted: true,
            newCounters: newCounters
          }
        }).catch(err => console.error("Audit logging failed on lab result delete:", err));
      }

      // Fallback general audit if list array changed without specific diffs
      if (addedRecs.length === 0 && updatedRecs.length === 0 && deletedRecs.length === 0 && JSON.stringify(prevRecords) !== JSON.stringify(newRecords)) {
        await AuditService.createAuditRecord({
          auditId: `AUD-LAB-GEN-${Date.now()}`,
          userId: userObj.username || 'system',
          userName: userObj.name || userObj.username || 'کاربر سیستم',
          role: userObj.role || 'lab',
          module: "Laboratory",
          entityType: "Laboratory Result",
          entityId: id,
          entityName,
          action: "Update",
          severity: newCounters.reject > 0 ? "Critical" : "Warning",
          description: `بروزرسانی سوابق آزمایشگاهی سورس "${entityName}"`,
          reasonForChange: reasonInput || "بروزرسانی نتایج آنالیز",
          beforeData: { previousCounters: prevCounters, count: prevRecords.length },
          afterData: { newCounters: newCounters, count: newRecords.length }
        }).catch(err => console.error("Audit logging failed on general analysis update:", err));
      }

      // 2. Audit Sample Status Changes (System Auto Update or Restore)
      if (isSystemAutoReject) {
        await AuditService.createAuditRecord({
          auditId: `AUD-SRC-SYS-REJ-${Date.now()}`,
          userId: 'system',
          userName: 'سیستم (خودکار)',
          role: 'system',
          module: "Source Management",
          entityType: "Source",
          entityId: id,
          entityName,
          action: "System Update",
          severity: "Critical",
          description: `تغییر خودکار وضعیت موثر سورس "${entityName}" به علت ثبت نتیجه مردودی آزمایشگاه (Reject Count >= 1)`,
          reasonForChange: "Effective Sample Status changed automatically because Reject Count >= 1",
          beforeData: {
            previousStatus: current.status,
            previousEffectiveStatus: current.status,
            previousRejectCount: prevCounters.reject,
            previousPassCount: prevCounters.pass,
            previousConditionalCount: prevCounters.conditional
          },
          afterData: {
            newStatus: "rejected",
            newEffectiveStatus: "rejected",
            newRejectCount: newCounters.reject,
            newPassCount: newCounters.pass,
            newConditionalCount: newCounters.conditional
          }
        }).catch(err => console.error("Audit logging failed on auto reject status change:", err));
      } else if (isSystemAutoRestore) {
        await AuditService.createAuditRecord({
          auditId: `AUD-SRC-SYS-RST-${Date.now()}`,
          userId: 'system',
          userName: 'سیستم (خودکار)',
          role: 'system',
          module: "Source Management",
          entityType: "Source",
          entityId: id,
          entityName,
          action: "System Update",
          severity: "Warning",
          description: `بازگردانی خودکار وضعیت موثر سورس "${entityName}" به وضعیت اولیه (${finalStatus}) پس از برطرف شدن عدم‌تاییدهای آزمایشگاه`,
          reasonForChange: "No active laboratory rejection exists. Status restored from Initial Sample Status",
          beforeData: {
            previousStatus: current.status,
            previousEffectiveStatus: "rejected",
            previousRejectCount: prevCounters.reject,
            previousPassCount: prevCounters.pass,
            previousConditionalCount: prevCounters.conditional
          },
          afterData: {
            newStatus: finalStatus,
            newEffectiveStatus: finalStatus,
            initialSampleStatus: current.initialSampleStatus || "approved",
            newRejectCount: newCounters.reject,
            newPassCount: newCounters.pass,
            newConditionalCount: newCounters.conditional
          }
        }).catch(err => console.error("Audit logging failed on auto restore status change:", err));
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
      const moduleName = isSource ? "Source Management" : "Supplier Management";
      const entityName = isSource ? (result.material || result.name) : result.name;
      const userObj = req.user || {};

      const prevRisk = current.riskAssessment || null;
      const newRisk = result.riskAssessment || {};

      const isCreate = !prevRisk;
      const actionType = isCreate ? "Create" : "Update";
      const reasonInput = req.body.reasonForChange || req.body.reason || "ویرایش پارامترهای FMEA / RPN / SRI";

      const beforeObj = prevRisk ? {
        material: current.material || entityName,
        supplier: entityName,
        riskCategory: current.category || 'General',
        severity: prevRisk.materialCriticality ?? prevRisk.severity,
        occurrence: prevRisk.probability ?? prevRisk.occurrence,
        detectability: prevRisk.detectability ?? prevRisk.detection,
        rpn: prevRisk.riskScore ?? prevRisk.rpn,
        sri: prevRisk.sri,
        riskLevel: prevRisk.riskLevel,
        failureMode: prevRisk.failureMode,
        effect: prevRisk.effect,
        cause: prevRisk.cause,
        evaluator: prevRisk.evaluator,
        date: prevRisk.date
      } : null;

      const afterObj = {
        material: result.material || entityName,
        supplier: entityName,
        riskCategory: result.category || 'General',
        severity: newRisk.materialCriticality ?? newRisk.severity,
        occurrence: newRisk.probability ?? newRisk.occurrence,
        detectability: newRisk.detectability ?? newRisk.detection,
        rpn: newRisk.riskScore ?? newRisk.rpn,
        sri: newRisk.sri,
        riskLevel: newRisk.riskLevel,
        failureMode: newRisk.failureMode,
        effect: newRisk.effect,
        cause: newRisk.cause,
        evaluator: newRisk.evaluator,
        date: newRisk.date
      };

      // 1. User Change Audit
      await AuditService.createAuditRecord({
        auditId: `AUD-RSK-USR-${Date.now()}`,
        userId: userObj.username || 'system',
        userName: userObj.name || userObj.username || 'کاربر سیستم',
        role: userObj.role || 'user',
        module: "Risk Assessment",
        entityType: "Risk Assessment",
        entityId: id,
        entityName,
        action: actionType,
        severity: newRisk.riskLevel === 'High' ? "Critical" : "Warning",
        description: isCreate 
          ? `ثبت ارزیابی ریسک جدید (FMEA) برای سورس/تامین‌کننده "${entityName}"`
          : `ویرایش پارامترهای FMEA توسط کاربر برای سورس/تامین‌کننده "${entityName}"`,
        reasonForChange: reasonInput,
        beforeData: beforeObj,
        afterData: afterObj
      }).catch(err => console.error("Audit logging failed on user risk change:", err));

      // 2. System Calculation Audit (if RPN / SRI / Risk Level recalculated)
      const prevRPN = prevRisk?.riskScore ?? prevRisk?.rpn;
      const newRPN = newRisk.riskScore ?? newRisk.rpn;
      const prevSRI = prevRisk?.sri;
      const newSRI = newRisk.sri;
      const prevLevel = prevRisk?.riskLevel;
      const newLevel = newRisk.riskLevel;

      const rpnRecalculated = prevRisk && (prevRPN !== newRPN || prevSRI !== newSRI || prevLevel !== newLevel);

      if (rpnRecalculated) {
        await AuditService.createAuditRecord({
          auditId: `AUD-RSK-SYS-${Date.now()}`,
          userId: 'system',
          userName: 'سیستم (خودکار)',
          role: 'system',
          module: "Risk Assessment",
          entityType: "FMEA",
          entityId: id,
          entityName,
          action: "System Calculation",
          severity: newLevel === 'High' ? "Critical" : "Information",
          description: `محاسبه مجدد خودکار RPN / SRI و تعیین سطح ریسک (RPN: ${prevRPN} -> ${newRPN}, SRI: ${prevSRI} -> ${newSRI}, Level: ${prevLevel} -> ${newLevel})`,
          reasonForChange: "RPN recalculated automatically based on updated risk parameters",
          beforeData: {
            previousRPN: prevRPN,
            previousSRI: prevSRI,
            previousRiskLevel: prevLevel,
            previousSeverity: beforeObj?.severity,
            previousOccurrence: beforeObj?.occurrence,
            previousDetectability: beforeObj?.detectability
          },
          afterData: {
            newRPN: newRPN,
            newSRI: newSRI,
            newRiskLevel: newLevel,
            newSeverity: afterObj.severity,
            newOccurrence: afterObj.occurrence,
            newDetectability: afterObj.detectability
          }
        }).catch(err => console.error("Audit logging failed on system RPN calculation:", err));
      }

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
        const moduleName = isSource ? "Source Management" : "Supplier Management";
        const entityType = isSource ? "Source" : "Supplier";
        const entityName = isSource ? (current.material || current.name) : current.name;
        const userObj = req.user || {};

        await AuditService.createAuditRecord({
          auditId: `AUD-${isSource ? 'SRC' : 'SUP'}-DEL-${Date.now()}`,
          userId: userObj.username || 'system',
          userName: userObj.name || userObj.username || 'کاربر سیستم',
          role: userObj.role || 'user',
          module: moduleName,
          entityType,
          entityId: id,
          entityName,
          action: "Delete",
          severity: "Critical",
          description: isSource ? `حذف سورس "${entityName}"` : `حذف تامین‌کننده "${entityName}"`,
          reasonForChange: req.body?.reasonForChange || req.body?.reason || "حذف رکورد توسط کاربر",
          beforeData: current,
          afterData: null
        }).catch(err => console.error("Audit logging failed on delete vendor:", err));

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
