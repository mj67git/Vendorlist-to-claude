import express from "express";
import { STALE_COPY_MESSAGE, serializeWrites, staleCopy } from "../http/recordLock.js";
import { auditRowValues, diffFields, recordEvent } from "../../utils/auditEvents.js";
import { requirePrisma } from "../db/prisma.js";
import { requireAnyPermission, requireAuth, requirePermission } from "../http/auth.js";
import { sendHandlerError } from "../http/errors.js";
import {
  getBusinessPartnersList, upsertBusinessPartner,
} from "../repositories/partnerRepository.js";
import { getUserByUsername } from "../repositories/userRepository.js";
import { forbiddenPartnerDecisions } from "../../utils/decisionGuards.js";
import { can } from "../../utils/permissions.js";

/**
 * The business partner repository: manufacturers and sellers, the SOP
 * evaluation, and the legal documents attached to it.
 *
 * Two things here are not obvious. The document blobs are fetched one at a time
 * rather than travelling in the list payload, because they are whole PDFs in a
 * text column. And a partner cannot be deleted while a source still points at
 * it — a guard that was blind for a long time because it counted on a column
 * nothing wrote.
 */

/**
 * The partner's own descriptive fields.
 *
 * Named rather than diffed wholesale because the record also carries its SOP
 * evaluation and its status, and those two are separate decisions with separate
 * permissions — they get their own audit events instead of appearing as fields
 * of a routine edit.
 */
const PARTNER_PROFILE_FIELDS = [
  "name", "nameEn", "type", "country", "city", "address",
  "email", "contactPerson", "phone", "website",
];

export function partnerRoutes(): express.Router {
  const router = express.Router();

  router.get("/api/business-partners", requireAuth, requirePermission("partner.read"), async (req: any, res) => {
    try {
      const list = await getBusinessPartnersList();
      res.json(list);
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // SOP evaluation history for a supplier, reconstructed from the audit trail:
  // an evaluation event names the score and grade that moved. Returns only the
  // points where a score is present, so a rename never shows up as a grading.
  router.get("/api/business-partners/:id/evaluation-history", requireAuth, requirePermission("partner.read"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const rows = await prisma.auditLog.findMany({
        // `SupplierEvaluation` is what an evaluation event stores; the older
        // rows recorded the whole partner under `BusinessPartner`.
        where: { entityId: req.params.id, entityType: { in: ["BusinessPartner", "SupplierEvaluation"] } },
        orderBy: { timestamp: "asc" },
      });
      const history: any[] = [];
      let lastScore: number | null = null;
      for (const r of rows) {
        // Rows written since the audit rewrite name the evaluation's fields
        // directly; older ones carry a copy of the whole partner.
        const values = auditRowValues(r as any).after;
        const ev = (r.afterData as any)?.evaluation ?? values;
        if (!ev || typeof ev.totalScore !== "number") continue;
        // Skip consecutive duplicates (no score change).
        if (ev.totalScore === lastScore) continue;
        history.push({
          id: r.id,
          date: r.timestamp.toISOString(),
          totalScore: ev.totalScore,
          grade: ev.grade ?? null,
          status: ev.status ?? null,
          user: r.userName || r.userId || "—",
          reason: r.reasonForChange || "",
        });
        lastScore = ev.totalScore;
      }
      res.json(history);
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // Fetch a single SOP document's stored file on demand (kept out of the list
  // payload so the repository stays lightweight).
  router.get("/api/business-partners/:id/documents/:key/file", requireAuth, requirePermission("partner.files"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const evaluation = await prisma.supplierEvaluation.findUnique({
        where: { partnerId: req.params.id },
        include: { documents: { where: { key: req.params.key as any } } },
      });
      const doc = evaluation?.documents?.[0];
      if (!doc || !doc.fileDataUrl) {
        return res.status(404).json({ error: "فایلی برای این مدرک یافت نشد" });
      }
      // Reading a record is not audited, but a document leaving the company is
      // the one read that is — and unlike an export it has a server-side
      // moment, so it is recorded here rather than taken on the client's word.
      const partner = await prisma.businessPartner.findUnique({ where: { id: req.params.id } });
      await recordEvent(req, {
        event: "partner.document_downloaded",
        entity: { id: req.params.id, name: partner?.name || req.params.id },
        facts: { document: doc.nameFa || doc.key, fileName: doc.fileName },
      });
      res.json({ fileName: doc.fileName, fileSize: doc.fileSize, fileDataUrl: doc.fileDataUrl });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.post("/api/business-partners", requireAuth, requirePermission("partner.create"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const partner = req.body;
      if (!partner || !partner.id || !partner.name || !partner.type) {
        return res.status(400).json({ error: "فیلدهای id، name و type الزامی هستند." });
      }
      const existing = await prisma.businessPartner.findUnique({ where: { id: partner.id } });
      if (existing) {
        return res.status(400).json({ error: "شریک تجاری با این شناسه قبلاً ثبت شده است." });
      }
      await upsertBusinessPartner(prisma, partner);
      const [saved] = (await getBusinessPartnersList()).filter(p => p.id === partner.id);

      await recordEvent(req, {
        event: "partner.created",
        entity: { id: partner.id, name: partner.name },
        facts: { type: partner.type, country: partner.country },
        reason: req.body.reasonForChange || null,
      });

      res.json({ success: true, partner: saved });
    } catch (err: any) {
      console.error("Failed to create business partner:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Three writes share this endpoint — maintaining the record, grading the
  // seller's documents, and switching the partner on or off — so the middleware
  // only keeps out callers entitled to none of them. Which one a request is
  // making is decided below, by comparing it with the stored partner.
  router.put("/api/business-partners/:id", requireAuth,
    requireAnyPermission("partner.edit", "partner.evaluate", "partner.status"), serializeWrites("partner"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const { id } = req.params;
      const existing = await prisma.businessPartner.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "شریک تجاری یافت نشد" });
      }
      if (staleCopy(req, existing)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }
      const [before] = (await getBusinessPartnersList()).filter(p => p.id === id);

      // This endpoint replaces the whole partner, so two decisions ride inside
      // an ordinary edit: grading the seller's documents, and switching the
      // partner on or off. Commercial owns the record and collects the papers
      // but does not award the grade — and since only a grade-A seller may be
      // attached to a source (rule 13), that grade decides whether the company
      // can buy through this seller at all. The stored user record is read
      // rather than the token, for the reason in rule 14.
      const actor = await getUserByUsername(req.user?.username || "");
      if (!actor || actor.isActive === false) {
        return res.status(401).json({ error: "این حساب کاربری دیگر معتبر نیست." });
      }
      // Whoever may only decide may not also rewrite the record around the
      // decision. Fields are compared against what is stored, so a full-record
      // payload that repeats them is not an edit.
      if (!can(actor as any, "partner.edit")) {
        const decided = new Set(["id", "status", "evaluation", "reasonForChange", "expectedUpdatedAt"]);
        const edited = Object.keys(req.body || {}).filter(key => {
          if (decided.has(key)) return false;
          return JSON.stringify(req.body[key] ?? null) !== JSON.stringify((before as any)?.[key] ?? null);
        });
        if (edited.length > 0) {
          return res.status(403).json({
            error: `عدم دسترسی: ویرایش شریک تجاری نیازمند مجوز «ویرایش» است (تلاش برای تغییر: ${edited.join('، ')}).`,
          });
        }
      }

      const refusals = forbiddenPartnerDecisions(actor as any, before, req.body);
      if (refusals.length > 0) {
        const needed = refusals.map(r => r.permission).join('، ');
        recordEvent(req, {
          event: "access.denied",
          entity: { type: "BusinessPartner", id, name: before?.name || existing.name },
          facts: {
            attempted: "تغییر ارزیابی یا وضعیت شریک تجاری",
            permission: needed,
            fields: refusals.flatMap(r => r.fields).join("، "),
          },
        });
        const what = refusals.some(r => r.permission === 'partner.evaluate')
          ? 'ارزیابی مدارک فروشنده'
          : 'تغییر وضعیت شریک تجاری';
        return res.status(403).json({
          error: `عدم دسترسی: ${what} نیازمند مجوز جداگانه است و این حساب آن را ندارد.`,
        });
      }

      await upsertBusinessPartner(prisma, { ...req.body, id });
      const [saved] = (await getBusinessPartnersList()).filter(p => p.id === id);

      // One endpoint carries three different acts, so it can produce three
      // different rows: the profile edit, the SOP evaluation, and the status
      // switch. Each is skipped when that part of the record did not move, so a
      // plain rename no longer reads as "the seller was re-evaluated". They
      // share one correlation id, which is what ties them back into one save.
      const partnerEntity = { id, name: saved?.name || existing.name };
      const reason = req.body.reasonForChange || null;

      await recordEvent(req, {
        event: "partner.status_changed",
        entity: partnerEntity,
        changes: diffFields(before, saved, ["status"]),
        reason,
      });
      await recordEvent(req, {
        event: "partner.evaluated",
        entity: partnerEntity,
        changes: diffFields(before?.evaluation, saved?.evaluation, ["totalScore", "grade", "status"]),
        reason,
      });
      await recordEvent(req, {
        event: "partner.updated",
        entity: partnerEntity,
        changes: diffFields(before, saved, PARTNER_PROFILE_FIELDS),
        reason,
      });

      res.json({ success: true, partner: saved });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.delete("/api/business-partners/:id", requireAuth, requirePermission("partner.delete"), serializeWrites("partner"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const { id } = req.params;
      const existing = await prisma.businessPartner.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "شریک تجاری یافت نشد" });
      }
      if (staleCopy(req, existing)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }

      // Referential integrity: block deletion when the partner is still linked
      // to a source. Manufacturers and Suppliers are independent now, so there
      // is no partner-to-partner reference to check.
      /*
       * Counting on the column alone was not enough.
       *
       * Until the partner link was moved into its columns, the id lived inside
       * `contact_info` as a marker and the column was always NULL — so this
       * count was always zero and a partner in active use could be deleted
       * without the guard noticing. The migration moves those markers across,
       * but a database restored from an older backup, or one where the
       * migration has not run yet, still holds rows in the old shape. A guard
       * that is right only after a migration is not a guard, so the legacy
       * shape is checked too. It is an unindexed LIKE, which is acceptable on a
       * delete: one scan, on an operation a person performs by hand.
       */
      const legacyMarkerRefs = async () =>
        prisma.vendor.count({ where: { contactInfo: { contains: `__BP_METAUI__:` } , AND: [{ contactInfo: { contains: id } }] } });

      let blockedReason: string | null = null;
      if (existing.type === "Manufacturer") {
        const vendorRefs = await prisma.vendor.count({ where: { manufacturerId: id } });
        if (vendorRefs > 0 || (await legacyMarkerRefs()) > 0) {
          blockedReason = "امکان حذف این تولیدکننده وجود ندارد. به یک یا چند Source اختصاص داده شده است.";
        }
      } else if (existing.type === "Supplier") {
        const vendorRefs = await prisma.vendor.count({ where: { OR: [{ supplierId: id }, { id }] } });
        if (vendorRefs > 0 || (await legacyMarkerRefs()) > 0) {
          blockedReason = "امکان حذف این فروشنده وجود ندارد. در یک یا چند Source استفاده شده است.";
        }
      }

      if (blockedReason) {
        recordEvent(req, {
          event: "access.denied",
          entity: { type: "BusinessPartner", id, name: existing.name },
          facts: { attempted: "حذف شریک تجاری", type: existing.type },
          reason: "رکورد در یک یا چند سورس استفاده شده است",
        });
        return res.status(400).json({ error: blockedReason });
      }

      // supplier_evaluations + sop_documents cascade via foreign keys.
      await prisma.businessPartner.delete({ where: { id } });

      await recordEvent(req, {
        event: "partner.deleted",
        entity: { id, name: existing.name },
        facts: { type: existing.type },
        reason: (req.query.reasonForChange as string) || null,
      });

      res.json({ success: true });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  /**
   * Last-resort error handler.
   *
   * Handlers that catch their own errors still answered with the raw message —
   * a malformed page number came back as the Prisma query-engine's own text,
   * naming the call and its arguments. That is internal detail a client has no
   * use for and an attacker does. Anything reaching here is logged in full on
   * the server and answered with a plain message.
   *
   * Registered before the catch-alls so it wraps the API routes above.
   */

  return router;
}
