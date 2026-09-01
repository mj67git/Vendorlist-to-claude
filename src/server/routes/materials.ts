import express from "express";
import { AuditService } from "../../utils/auditService.js";
import { findDuplicateMaterial, type MaterialKeyFields } from "../../utils/materialDuplicates.js";
import { requirePrisma } from "../db/prisma.js";
import { generateMaterialId } from "../domain/materialId.js";
import {
  asText, mapMaterialToClient, materialDataFromBody, rejectDuplicateMaterial,
} from "../repositories/materialRepository.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { sendHandlerError } from "../http/errors.js";
import { getClientIp, getUserAgent } from "../http/requestInfo.js";

/**
 * The material master repository.
 *
 * A material is the substance; the source is who supplies it. Keeping them
 * apart is why the IRC licence lives on the source and not here — it belongs to
 * a supplier's permission to import, not to the chemical.
 *
 * The specification attachment is fetched on its own endpoint rather than
 * riding along with the list, for the same reason the SOP documents are.
 */

export function materialRoutes(): express.Router {
  const router = express.Router();

  router.get("/api/materials", requireAuth, requirePermission("material.read"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const list = await prisma.material.findMany({ orderBy: { createdAt: "desc" } });
      res.json(list.map(mapMaterialToClient));
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.post("/api/materials", requireAuth, requirePermission("material.create"), async (req: any, res) => {
    try {
      const b = req.body;
      const reasonForChange = b.reasonForChange;
      const data = materialDataFromBody(b);
      if (!data.name || !data.nameEn) {
        return res.status(400).json({ error: "وارد کردن نام فارسی و انگلیسی ماده الزامی است" });
      }

      const prisma = requirePrisma();
      const materialId = b.id || generateMaterialId(data.cas, data.irc, data.name, data.nameEn);

      const existing = await prisma.material.findUnique({ where: { id: materialId } });
      if (existing) {
        return res.status(400).json({ error: "ماده‌ای با این شناسه قبلاً در سیستم ثبت شده است" });
      }

      const duplicate = await rejectDuplicateMaterial(
        prisma, req,
        { id: materialId, nameFa: data.name, nameEn: data.nameEn, cas: data.cas, role: data.role, finalProductEn: data.finalProductEn },
        null,
      );
      if (duplicate) return res.status(409).json(duplicate);

      const created = await prisma.material.create({ data: { id: materialId, ...data } });
      const newMaterial = mapMaterialToClient(created);
      const name = data.name;
      const nameEn = data.nameEn;

      // Audit Log for Material Creation
      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت مواد",
        action: "Create",
        severity: "Information",
        description: `ماده دارویی جدید با عنوان ${name} (${nameEn}) به مستندات مرجع مواد اضافه شد.`,
        entityType: "Material",
        entityId: materialId,
        entityName: name,
        reasonForChange: reasonForChange || "تعریف محصول جدید جهت فرآیند ارزیابی تأمین‌کننده",
        beforeData: null,
        afterData: newMaterial
      });

      res.json({ success: true, material: newMaterial });
    } catch (err: any) {
      console.error("Failed to create material:", err);
      res.status(500).json({ error: err.message });
    }
  });

  router.patch("/api/materials/:id", requireAuth, requirePermission("material.edit"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const b = req.body;
      const reasonForChange = b.reasonForChange;
      const prisma = requirePrisma();

      const current = await prisma.material.findUnique({ where: { id } });
      if (!current) {
        return res.status(404).json({ error: "ماده مورد نظر یافت نشد" });
      }

      const originalData = mapMaterialToClient(current);
      // Merge: keep the current value when a field is not supplied.
      const incoming = materialDataFromBody({
        nameFa: b.nameFa ?? b.name ?? current.name,
        nameEn: b.nameEn ?? current.nameEn,
        cas: b.cas ?? current.cas,
        irc: b.irc ?? current.irc,
        iupac: b.iupac ?? current.iupac,
        role: b.role ?? current.role,
        finalProduct: b.finalProduct ?? current.finalProduct,
        finalProductEn: b.finalProductEn ?? current.finalProductEn,
        pharmacopoeia: b.pharmacopoeia ?? current.pharmacopoeia,
        standardNameFa: b.standardNameFa ?? current.standardNameFa,
        standardNameEn: b.standardNameEn ?? current.standardNameEn,
        // `??` everywhere else means "a field that is not supplied keeps its
        // value". For the attachment that read the wrong way: sending an
        // explicit null to detach the file kept the old name, so removing a
        // Specification never actually persisted. An explicit null clears here;
        // an absent key still keeps the current value.
        specificationFile: "specificationFile" in b ? b.specificationFile : current.specificationFile,
      });

      // Clearing the file name through a plain PATCH must not leave the blob
      // behind — the record would then claim no attachment while still storing
      // one.
      const clearedSpecification = !!current.specificationFile && !incoming.specificationFile;
      if (clearedSpecification) {
        Object.assign(incoming, {
          specificationFileSize: null,
          specificationFileData: null,
          specificationUploadedAt: null,
        });
      }

      const duplicate = await rejectDuplicateMaterial(
        prisma, req,
        { id, nameFa: incoming.name, nameEn: incoming.nameEn, cas: incoming.cas, role: incoming.role, finalProductEn: incoming.finalProductEn },
        { id, nameFa: current.name, nameEn: current.nameEn, cas: current.cas, role: current.role, finalProductEn: current.finalProductEn },
      );
      if (duplicate) return res.status(409).json(duplicate);

      const updated = await prisma.material.update({ where: { id }, data: incoming });
      const updatedMaterial = mapMaterialToClient(updated);

      // Audit Log for Material Update
      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت مواد",
        action: "Update",
        severity: "Information",
        description: `اطلاعات مستندات مرجع ماده دارویی ${current.name} بروزرسانی گردید.`,
        entityType: "Material",
        entityId: id,
        entityName: updatedMaterial.nameFa,
        reasonForChange: reasonForChange || "اصلاح مشخصات مرجع ماده",
        beforeData: originalData,
        afterData: updatedMaterial
      });

      res.json({ success: true, material: updatedMaterial });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.delete("/api/materials/:id", requireAuth, requirePermission("material.delete"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const reasonForChange = req.query.reasonForChange as string || "عدم استفاده مجدد در فرمولاسیون محصولات نهایی";
      const prisma = requirePrisma();

      const current = await prisma.material.findUnique({ where: { id } });
      if (!current) {
        return res.status(404).json({ error: "ماده مورد نظر یافت نشد" });
      }

      // Check dependency
      const usedCount = await prisma.vendorMaterial.count({ where: { materialId: id } });
      const isUsed = usedCount > 0;

      if (isUsed) {
        // Audit Log for Rejected Deletion
        const now = new Date();
        const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        await AuditService.createAuditRecord({
          auditId,
          correlationId: crypto.randomUUID(),
          userId: req.user.username,
          userName: req.user.name,
          role: req.user.role,
          module: "مدیریت مواد",
          action: "Delete",
          severity: "Critical",
          description: `تلاش ناموفق برای حذف ماده "${current.name}". ماده در سورس‌های ثبت‌شده استفاده شده است.`,
          entityType: "Material",
          entityId: id,
          entityName: current.name,
          reasonForChange: "Attempted delete of referenced record",
          beforeData: null,
          afterData: null
        });

        return res.status(400).json({ error: "امکان حذف این ماده وجود ندارد. این ماده در یک یا چند Source ثبت شده است و حذف آن باعث از بین رفتن یکپارچگی اطلاعات و سوابق تاریخی سیستم می‌شود." });
      }

      const beforeData = { name: current.name, nameEn: current.nameEn, cas: current.cas, irc: current.irc };

      await prisma.material.delete({ where: { id } });

      // Audit Log for Material Deletion
      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت مواد",
        action: "Delete",
        severity: "Critical",
        description: `ماده دارویی ${current.name} از بانک مستندات مرجع مواد حذف گردید.`,
        entityType: "Material",
        entityId: id,
        entityName: current.name,
        reasonForChange,
        beforeData,
        afterData: null
      });

      res.json({ success: true });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // ---------------------------------------------------------------------------
  // Specification attachment
  //
  // The form used to record only the file name: the user picked a document,
  // saw its name on the record, and nothing was ever stored. In a GxP system
  // that is a documentation claim with nothing behind it. The three endpoints
  // below store, serve and remove the actual file.
  //
  // The blob lives in a column and is fetched on demand, the same shape the SOP
  // documents use (project rule 5), so listing the repository never carries
  // base64.
  // ---------------------------------------------------------------------------

  /** Roughly the payload ceiling: express.json caps the body at 10mb, and a
   *  data URL is ~33% larger than the file it encodes. */
  const MAX_SPECIFICATION_BYTES = 7 * 1024 * 1024;

  router.put("/api/materials/:id/specification", requireAuth, requirePermission("material.edit"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { fileName, fileSize, fileDataUrl, reasonForChange } = req.body || {};
      const prisma = requirePrisma();

      if (!fileName || typeof fileDataUrl !== "string" || !fileDataUrl.startsWith("data:")) {
        return res.status(400).json({ error: "فایل ارسالی نامعتبر است." });
      }
      if (typeof fileSize === "number" && fileSize > MAX_SPECIFICATION_BYTES) {
        return res.status(413).json({ error: "حجم فایل بیش از حد مجاز (۷ مگابایت) است." });
      }

      const current = await prisma.material.findUnique({ where: { id } });
      if (!current) return res.status(404).json({ error: "ماده مورد نظر یافت نشد" });

      const isReplacement = !!current.specificationFileData;
      const updated = await prisma.material.update({
        where: { id },
        data: {
          specificationFile: fileName,
          specificationFileSize: typeof fileSize === "number" ? fileSize : null,
          specificationFileData: fileDataUrl,
          specificationUploadedAt: new Date(),
        },
      });

      const now = new Date();
      await AuditService.createAuditRecord({
        auditId: `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت مواد",
        action: "Update",
        severity: "Information",
        description: `${isReplacement ? "جایگزینی" : "بارگذاری"} فایل Specification برای ماده ${current.name} (${fileName}).`,
        entityType: "Material",
        entityId: id,
        entityName: current.name,
        reasonForChange: reasonForChange || (isReplacement ? "جایگزینی مدرک مشخصات فنی" : "بارگذاری مدرک مشخصات فنی"),
        // The blob is never written into the audit row; only what changed about it.
        beforeData: { specificationFile: current.specificationFile, specificationFileSize: current.specificationFileSize },
        afterData: { specificationFile: fileName, specificationFileSize: fileSize ?? null },
      });

      res.json({ success: true, material: mapMaterialToClient(updated) });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.get("/api/materials/:id/specification/file", requireAuth, requirePermission("material.read"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const material = await prisma.material.findUnique({ where: { id: req.params.id } });
      if (!material || !material.specificationFileData) {
        return res.status(404).json({ error: "فایلی برای این ماده یافت نشد" });
      }
      res.json({
        fileName: material.specificationFile,
        fileSize: material.specificationFileSize,
        fileDataUrl: material.specificationFileData,
      });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.delete("/api/materials/:id/specification", requireAuth, requirePermission("material.edit"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const prisma = requirePrisma();
      const current = await prisma.material.findUnique({ where: { id } });
      if (!current) return res.status(404).json({ error: "ماده مورد نظر یافت نشد" });

      const updated = await prisma.material.update({
        where: { id },
        data: {
          specificationFile: null,
          specificationFileSize: null,
          specificationFileData: null,
          specificationUploadedAt: null,
        },
      });

      const now = new Date();
      await AuditService.createAuditRecord({
        auditId: `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت مواد",
        action: "Delete",
        severity: "Warning",
        description: `فایل Specification ماده ${current.name} حذف شد (${current.specificationFile || "بدون نام"}).`,
        entityType: "Material",
        entityId: id,
        entityName: current.name,
        reasonForChange: (req.query.reasonForChange as string) || "حذف مدرک مشخصات فنی",
        beforeData: { specificationFile: current.specificationFile, specificationFileSize: current.specificationFileSize },
        afterData: null,
      });

      res.json({ success: true, material: mapMaterialToClient(updated) });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.put("/api/materials/:id/status", requireAuth, requirePermission("material.edit"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { status, reasonForChange } = req.body;
      const prisma = requirePrisma();

      const current = await prisma.material.findUnique({ where: { id } });
      if (!current) {
        return res.status(404).json({ error: "ماده مورد نظر یافت نشد" });
      }

      const oldStatus = (current as any).status || "Active";
      const newStatus = status || "Suspended";
      // NOTE: the materials table has no status column yet; status change is
      // recorded in the audit trail only until a dedicated column is added.

      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت مواد",
        action: "Update",
        severity: "Warning",
        description: `تغییر وضعیت انطباق کیفی ماده ${current.name} از ${oldStatus} به ${newStatus} به دلیل عدم رعایت الزامات فارماکوپه‌ای`,
        entityType: "Material",
        entityId: id,
        entityName: current.name,
        reasonForChange: reasonForChange || "عدم تمدید گواهینامه‌های GMP سورس سازنده",
        beforeData: { status: oldStatus },
        afterData: { status: newStatus }
      });

      res.json({ success: true, status: newStatus });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  // ==========================================
  // --- Business Partner Endpoints ---
  // ==========================================

  return router;
}
