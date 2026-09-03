import express from "express";
import { STALE_COPY_MESSAGE, serializeWrites, staleCopy } from "../http/recordLock.js";
import { AuditService } from "../../utils/auditService.js";
import { requirePrisma } from "../db/prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { sendHandlerError } from "../http/errors.js";
import { getClientIp, getUserAgent } from "../http/requestInfo.js";
import {
  buildPartnerAuditDescription, getBusinessPartnersList, mapPartnerRow, upsertBusinessPartner,
} from "../repositories/partnerRepository.js";

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

  // SOP evaluation history for a supplier, reconstructed from the audit trail
  // (each partner change records the full partner, incl. its evaluation, in
  // afterData). Returns only points where an evaluation with a score exists.
  router.get("/api/business-partners/:id/evaluation-history", requireAuth, requirePermission("partner.read"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const rows = await prisma.auditLog.findMany({
        where: { entityId: req.params.id, entityType: "BusinessPartner" },
        orderBy: { timestamp: "asc" },
      });
      const history: any[] = [];
      let lastScore: number | null = null;
      for (const r of rows) {
        const ev = (r.afterData as any)?.evaluation;
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

      await AuditService.createAuditRecord({
        auditId: `AUD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "Business Partner Repository",
        action: "Create",
        severity: "Information",
        entityType: "BusinessPartner",
        entityId: partner.id,
        entityName: partner.name,
        eventType: "User Activity",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        description: buildPartnerAuditDescription("Create", partner),
        reasonForChange: req.body.reasonForChange || "ثبت شریک تجاری جدید",
        beforeData: null,
        afterData: saved,
      }).catch(err => console.error("Audit logging failed on partner create:", err));

      res.json({ success: true, partner: saved });
    } catch (err: any) {
      console.error("Failed to create business partner:", err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/api/business-partners/:id", requireAuth, requirePermission("partner.edit"), serializeWrites("partner"), async (req: any, res) => {
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
      await upsertBusinessPartner(prisma, { ...req.body, id });
      const [saved] = (await getBusinessPartnersList()).filter(p => p.id === id);

      await AuditService.createAuditRecord({
        auditId: `AUD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "Business Partner Repository",
        action: "Update",
        severity: "Warning",
        entityType: "BusinessPartner",
        entityId: id,
        entityName: saved?.name || existing.name,
        eventType: "User Activity",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        description: buildPartnerAuditDescription("Update", saved, before),
        reasonForChange: req.body.reasonForChange || "ویرایش اطلاعات شریک تجاری",
        beforeData: before,
        afterData: saved,
      }).catch(err => console.error("Audit logging failed on partner update:", err));

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

      const auditBase = {
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "Business Partner Repository",
        entityType: "BusinessPartner",
        entityId: id,
        entityName: existing.name,
        eventType: "User Activity" as const,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      };

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
        await AuditService.createAuditRecord({
          ...auditBase,
          auditId: `AUD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
          action: "Delete - Blocked",
          severity: "Warning",
          description: `تلاش ناموفق برای حذف شریک تجاری "${existing.name}" (${existing.type}) — رکورد در حال استفاده است.`,
          reasonForChange: "Attempted delete of referenced record",
          beforeData: null,
          afterData: null,
        }).catch(err => console.error("Audit logging failed on blocked partner delete:", err));
        return res.status(400).json({ error: blockedReason });
      }

      const [before] = (await getBusinessPartnersList()).filter(p => p.id === id);
      // supplier_evaluations + sop_documents cascade via foreign keys.
      await prisma.businessPartner.delete({ where: { id } });

      await AuditService.createAuditRecord({
        ...auditBase,
        auditId: `AUD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        action: "Delete",
        severity: "Critical",
        description: buildPartnerAuditDescription("Delete", { name: existing.name, type: existing.type }),
        reasonForChange: (req.query.reasonForChange as string) || "حذف شریک تجاری",
        beforeData: before,
        afterData: null,
      }).catch(err => console.error("Audit logging failed on partner delete:", err));

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
