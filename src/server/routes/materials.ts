import express from "express";
import { STALE_COPY_MESSAGE, serializeWrites, staleCopy } from "../http/recordLock.js";
import { diffFields, recordEvent } from "../../utils/auditEvents.js";
import { findDuplicateMaterial, type MaterialKeyFields } from "../../utils/materialDuplicates.js";
import { requirePrisma } from "../db/prisma.js";
import { generateMaterialId } from "../domain/materialId.js";
import {
  asText, listMaterials, mapMaterialToClient, materialDataFromBody, rejectDuplicateMaterial,
} from "../repositories/materialRepository.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { sendHandlerError } from "../http/errors.js";

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
      res.json(await listMaterials());
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
      await recordEvent(req, {
        event: "material.created",
        entity: { id: materialId, name },
        facts: { nameEn, cas: data.cas },
        reason: reasonForChange || null,
      });

      res.json({ success: true, material: newMaterial });
    } catch (err: any) {
      console.error("Failed to create material:", err);
      res.status(500).json({ error: err.message });
    }
  });

  router.patch("/api/materials/:id", requireAuth, requirePermission("material.edit"), serializeWrites("material"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const b = req.body;
      const reasonForChange = b.reasonForChange;
      const prisma = requirePrisma();

      const current = await prisma.material.findUnique({ where: { id } });
      if (!current) {
        return res.status(404).json({ error: "ماده مورد نظر یافت نشد" });
      }
      if (staleCopy(req, current)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
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

      // Audit Log for Material Update. Only the fields that moved, and no row
      // at all when the save changed nothing.
      await recordEvent(req, {
        event: "material.updated",
        entity: { id, name: updatedMaterial.nameFa },
        changes: diffFields(originalData, updatedMaterial, Object.keys(updatedMaterial)),
        reason: reasonForChange || null,
      });

      res.json({ success: true, material: updatedMaterial });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.delete("/api/materials/:id", requireAuth, requirePermission("material.delete"), serializeWrites("material"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const reasonForChange = req.query.reasonForChange as string || "عدم استفاده مجدد در فرمولاسیون محصولات نهایی";
      const prisma = requirePrisma();

      const current = await prisma.material.findUnique({ where: { id } });
      if (!current) {
        return res.status(404).json({ error: "ماده مورد نظر یافت نشد" });
      }
      if (staleCopy(req, current)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }

      // Check dependency
      const usedCount = await prisma.vendorMaterial.count({ where: { materialId: id } });
      const isUsed = usedCount > 0;

      if (isUsed) {
        // A refused deletion is a security event, not a material event: the
        // material did not change, someone tried to remove one that is in use.
        await recordEvent(req, {
          event: "access.denied",
          entity: { type: "Material", id, name: current.name },
          facts: { attempted: "حذف ماده", usedBySources: usedCount },
        });

        return res.status(400).json({ error: "امکان حذف این ماده وجود ندارد. این ماده در یک یا چند Source ثبت شده است و حذف آن باعث از بین رفتن یکپارچگی اطلاعات و سوابق تاریخی سیستم می‌شود." });
      }

      await prisma.material.delete({ where: { id } });

      // Audit Log for Material Deletion — identity and reason, no copy of the
      // record that no longer exists (rule 16).
      await recordEvent(req, {
        event: "material.deleted",
        entity: { id, name: current.name },
        reason: reasonForChange,
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

  router.put("/api/materials/:id/specification", requireAuth, requirePermission("material.edit"), serializeWrites("material"), async (req: any, res) => {
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
      if (staleCopy(req, current)) return res.status(409).json({ error: STALE_COPY_MESSAGE });

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

      // The blob is never written into the audit row; only its name and size.
      await recordEvent(req, {
        event: "material.spec_uploaded",
        entity: { id, name: current.name },
        facts: {
          fileName,
          fileSize: fileSize ?? null,
          replaced: isReplacement ? current.specificationFile : null,
        },
        reason: reasonForChange || null,
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

  router.delete("/api/materials/:id/specification", requireAuth, requirePermission("material.edit"), serializeWrites("material"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const prisma = requirePrisma();
      const current = await prisma.material.findUnique({ where: { id } });
      if (!current) return res.status(404).json({ error: "ماده مورد نظر یافت نشد" });
      if (staleCopy(req, current)) return res.status(409).json({ error: STALE_COPY_MESSAGE });

      const updated = await prisma.material.update({
        where: { id },
        data: {
          specificationFile: null,
          specificationFileSize: null,
          specificationFileData: null,
          specificationUploadedAt: null,
        },
      });

      await recordEvent(req, {
        event: "material.spec_removed",
        entity: { id, name: current.name },
        facts: { fileName: current.specificationFile },
        reason: (req.query.reasonForChange as string) || null,
      });

      res.json({ success: true, material: mapMaterialToClient(updated) });
    } catch (err: any) {
      sendHandlerError(res, err);
    }
  });

  router.put("/api/materials/:id/status", requireAuth, requirePermission("material.edit"), serializeWrites("material"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { status, reasonForChange } = req.body;
      const prisma = requirePrisma();

      const current = await prisma.material.findUnique({ where: { id } });
      if (!current) {
        return res.status(404).json({ error: "ماده مورد نظر یافت نشد" });
      }
      if (staleCopy(req, current)) {
        return res.status(409).json({ error: STALE_COPY_MESSAGE });
      }

      const oldStatus = (current as any).status || "Active";
      const newStatus = status || "Suspended";
      // NOTE: the materials table has no status column yet; status change is
      // recorded in the audit trail only until a dedicated column is added.

      await recordEvent(req, {
        event: "material.status_changed",
        entity: { id, name: current.name },
        changes: [{ field: "status", from: oldStatus, to: newStatus }],
        reason: reasonForChange || null,
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
