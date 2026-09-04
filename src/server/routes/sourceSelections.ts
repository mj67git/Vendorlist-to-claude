import express from "express";
import { AuditService } from "../../utils/auditService.js";
import { requirePrisma } from "../db/prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { sendHandlerError } from "../http/errors.js";
import { getClientIp, getUserAgent } from "../http/requestInfo.js";
import { STALE_COPY_MESSAGE, lockRecordWrite, staleCopy } from "../http/recordLock.js";
import { getVendorById } from "../repositories/vendorRepository.js";

/**
 * The recorded decision: which source we actually buy this material from.
 *
 * The comparison panel can only ever recommend. Under GxP the question an
 * auditor asks is "why did you buy from this supplier", so the reason is
 * mandatory and the change is audited like any other write.
 *
 * Keyed by the material's English name because that is how the category page
 * groups sources — a free-text key, which is why renaming a material orphans
 * the decision. Worth fixing; not fixed here.
 */

export function sourceSelectionRoutes(): express.Router {
  const router = express.Router();

  router.get("/api/source-selections", requireAuth, requirePermission("vendor.read"), async (req: any, res) => {
    try {
      const rows = await requirePrisma().sourceSelection.findMany();
      res.json(rows.map(r => ({
        materialKey: r.materialKey,
        category: r.category,
        vendorId: r.vendorId,
        reason: r.reason,
        decidedBy: r.decidedBy,
        decidedAt: r.decidedAt.toISOString(),
        // Carried so a later save can claim the copy it was made from.
        updatedAt: r.updatedAt.toISOString(),
      })));
    } catch (err: any) {
      console.error("Failed to fetch source selections:", err);
      res.status(500).json({ error: "دریافت انتخاب سورس‌ها با خطا مواجه شد." });
    }
  });

  /**
   * Record (or change) which source is bought for a material.
   *
   * The reason is mandatory: a recommendation the system produced is not a
   * decision anyone made, and "why this supplier" is exactly what an auditor
   * asks. Requires vendor.write — the same permission as registering a source.
   */
  router.put("/api/source-selections", requireAuth, requirePermission("vendor.select"), async (req: any, res) => {
    let release: (() => void) | null = null;
    try {
      const { materialKey, category, vendorId, reason } = req.body || {};
      if (!materialKey || !category || !vendorId) {
        return res.status(400).json({ error: "فیلدهای materialKey، category و vendorId الزامی هستند." });
      }
      if (!reason || String(reason).trim().length < 10) {
        return res.status(400).json({ error: "ثبت دلیل انتخاب الزامی است و باید حداقل ۱۰ کاراکتر باشد." });
      }

      const vendor = await getVendorById(vendorId);
      if (!vendor) return res.status(404).json({ error: "سورس یافت نشد." });

      // This row is keyed by material and category rather than by an id, so the
      // lock is taken by hand instead of through the middleware. Same reason as
      // everywhere else: the upsert below is a read-modify-write, and two
      // decisions recorded for one material at the same moment would otherwise
      // interleave, with the audit trail naming the wrong previous holder.
      release = await lockRecordWrite("source-selection", `${category}:${materialKey}`);

      const prisma = requirePrisma();
      const previous = await prisma.sourceSelection.findUnique({
        where: { materialKey_category: { materialKey, category } },
      });
      if (staleCopy(req, previous)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }

      const decidedBy = req.user.name || req.user.username;
      const saved = await prisma.sourceSelection.upsert({
        where: { materialKey_category: { materialKey, category } },
        create: { materialKey, category, vendorId, reason: String(reason).trim(), decidedBy },
        update: { vendorId, reason: String(reason).trim(), decidedBy, decidedAt: new Date() },
      });

      const now = new Date();
      await AuditService.createAuditRecord({
        auditId: `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "ارزیابی سورس‌ها",
        action: previous ? "UPDATE_SOURCE_SELECTION" : "CREATE_SOURCE_SELECTION",
        severity: "Warning",
        description: previous && previous.vendorId !== vendorId
          ? `سورس منتخب برای «${materialKey}» از یک تأمین‌کننده به «${vendor.name}» تغییر یافت.`
          : `«${vendor.name}» به‌عنوان سورس منتخب برای «${materialKey}» ثبت شد.`,
        entityType: "SourceSelection",
        entityId: `${category}:${materialKey}`,
        entityName: vendor.name,
        eventType: "Data Change",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: String(reason).trim(),
        beforeData: previous
          ? { vendorId: previous.vendorId, reason: previous.reason, decidedBy: previous.decidedBy }
          : null,
        afterData: { vendorId, reason: String(reason).trim(), decidedBy, materialKey, category },
      });

      res.json({
        success: true,
        selection: {
          materialKey: saved.materialKey, category: saved.category, vendorId: saved.vendorId,
          reason: saved.reason, decidedBy: saved.decidedBy, decidedAt: saved.decidedAt.toISOString(),
          updatedAt: saved.updatedAt.toISOString(),
        },
      });
    } catch (err: any) {
      console.error("Failed to save source selection:", err);
      res.status(500).json({ error: err.message });
    } finally {
      release?.();
    }
  });

  // Dynamic configuration endpoint for scoring weights & mapping criteria

  // Get all vendors (Unified Database)

  return router;
}
