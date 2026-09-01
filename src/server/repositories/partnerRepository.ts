import type { PrismaClient } from "@prisma/client";
import { parseDateSafely } from "../db/coerce.js";
import { requirePrisma } from "../db/prisma.js";
import { INITIAL_BUSINESS_PARTNERS_DB } from "../../db_business_partners.js";

/**
 * Everything that reads or writes a business partner.
 *
 * Manufacturers and sellers are one flat table separated by `type`: a seller
 * does not belong to a manufacturer, and a source links to exactly one of them.
 * The SOP evaluation and its documents hang off a seller only.
 *
 * The document blobs are the reason `mapPartnerRow` is careful about what it
 * returns: the list payload carries `hasFile`, never the base64, which is
 * fetched per document on demand.
 *
 * Moved out of server.ts unchanged.
 */

const SOP_STATUS_TO_DB: Record<string, "Approved" | "PermitApproval" | "Expired" | "NotSubmitted"> = {
  "Approved": "Approved",
  "Permit Approval": "PermitApproval",
  "Expired": "Expired",
  "Not Submitted": "NotSubmitted",
};
const SOP_STATUS_FROM_DB: Record<string, string> = {
  "Approved": "Approved",
  "PermitApproval": "Permit Approval",
  "Expired": "Expired",
  "NotSubmitted": "Not Submitted",
};
const BP_TYPES = ["Manufacturer", "Supplier"];
const BP_STATUSES = ["Active", "Inactive", "Blacklisted"];

export function toDbPartnerType(t: any): any {
  return BP_TYPES.includes(t) ? t : "Manufacturer";
}
export function toDbPartnerStatus(s: any): any {
  return BP_STATUSES.includes(s) ? s : "Active";
}
export function toDbSopStatus(s: any): any {
  return s == null ? null : (SOP_STATUS_TO_DB[s] ?? null);
}

// Reconstruct the frontend BusinessPartner shape from a partner row that has
// its evaluation and SOP documents included.
export function mapPartnerRow(row: any): any {
  const base: any = {
    id: row.id,
    type: row.type,
    name: row.name,
    nameEn: row.nameEn || "",
    country: row.country,
    city: row.city || "",
    address: row.address || "",
    email: row.email || "",
    contactPerson: row.contactPerson || "",
    phone: row.phone || "",
    website: row.website || "",
    status: row.status,
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt,
  };

  if (row.evaluation) {
    const documents: Record<string, any> = {};
    for (const doc of row.evaluation.documents || []) {
      documents[doc.key] = {
        key: doc.key,
        nameFa: doc.nameFa,
        nameEn: doc.nameEn,
        status: doc.status ? SOP_STATUS_FROM_DB[doc.status] ?? null : null,
        score: doc.score,
        fileName: doc.fileName || undefined,
        // The heavy base64 blob is fetched lazily via the per-document file
        // endpoint; the list/detail payload only signals that a file exists.
        hasFile: !!doc.fileDataUrl,
        fileSize: doc.fileSize ?? undefined,
        uploadedAt: doc.uploadedAt?.toISOString?.() || doc.uploadedAt || undefined,
      };
    }
    base.evaluation = {
      documents,
      totalScore: row.evaluation.totalScore,
      grade: row.evaluation.grade,
      status: row.evaluation.status,
      updatedBy: row.evaluation.updatedBy || undefined,
      updatedAt: row.evaluation.updatedAt?.toISOString?.() || row.evaluation.updatedAt,
    };
  }

  return base;
}

// Fully (re)write a partner and its optional supplier evaluation + SOP docs.
export async function upsertBusinessPartner(prisma: PrismaClient, p: any): Promise<void> {
  const data = {
    type: toDbPartnerType(p.type),
    name: p.name || "Unknown",
    nameEn: p.nameEn || null,
    country: p.country || "نامشخص",
    city: p.city || null,
    address: p.address || null,
    email: p.email || null,
    contactPerson: p.contactPerson || null,
    phone: p.phone || null,
    website: p.website || null,
    status: toDbPartnerStatus(p.status),
  };

  await prisma.businessPartner.upsert({
    where: { id: p.id },
    update: data,
    create: { id: p.id, ...data },
  });

  // Since the list/detail payload no longer carries the base64 blob, capture
  // the existing document files before replacing the evaluation so an edit
  // that doesn't re-upload keeps the stored file instead of wiping it.
  const existingFiles = new Map<string, { fileDataUrl: string | null; fileName: string | null; fileSize: number | null }>();
  const prevEval = await prisma.supplierEvaluation.findUnique({
    where: { partnerId: p.id },
    include: { documents: true },
  });
  if (prevEval) {
    for (const d of prevEval.documents) {
      existingFiles.set(d.key, { fileDataUrl: d.fileDataUrl, fileName: d.fileName, fileSize: d.fileSize });
    }
  }

  // Replace the supplier evaluation (+ documents) if present.
  await prisma.supplierEvaluation.deleteMany({ where: { partnerId: p.id } });
  if (p.type === "Supplier" && p.evaluation) {
    const ev = p.evaluation;
    const created = await prisma.supplierEvaluation.create({
      data: {
        partnerId: p.id,
        totalScore: Number(ev.totalScore) || 0,
        grade: ev.grade || "Not Evaluated",
        status: ev.status || "Not Evaluated",
        updatedBy: ev.updatedBy || null,
      },
    });
    const docs = ev.documents ? Object.values(ev.documents) : [];
    for (const doc of docs as any[]) {
      const prior = existingFiles.get(doc.key);
      // fileName present but no fresh blob => unchanged reference, keep the
      // stored blob. fileName absent => the user removed the file, so drop it.
      const stillReferencesFile = !!doc.fileName;
      const fileName = doc.fileName || null;
      const fileDataUrl = doc.fileDataUrl || (stillReferencesFile ? prior?.fileDataUrl : null) || null;
      const fileSize = doc.fileSize ?? (stillReferencesFile && !doc.fileDataUrl ? prior?.fileSize : null) ?? null;
      await prisma.sopDocument.create({
        data: {
          evaluationId: created.id,
          key: doc.key,
          nameFa: doc.nameFa || "",
          nameEn: doc.nameEn || "",
          status: toDbSopStatus(doc.status),
          score: Number(doc.score) || 0,
          fileName,
          fileSize,
          fileDataUrl,
          uploadedAt: doc.uploadedAt ? parseDateSafely(doc.uploadedAt) : null,
        },
      });
    }
  }
}

// Build a human-readable audit description for a business-partner change,
// including supplier SOP evaluation changes (score / grade / status).
export function buildPartnerAuditDescription(action: string, partner: any, before?: any): string {
  let description = `${action} business partner: ${partner.name} (${partner.type})`;
  if (partner.type === "Supplier" && partner.evaluation) {
    const ev = partner.evaluation;
    if (action === "Create") {
      description += ` | SOP Score: ${ev.totalScore}/100, Grade: ${ev.grade}, Status: ${ev.status}`;
    } else if (action === "Update" && before?.evaluation) {
      const o = before.evaluation;
      const changes: string[] = [];
      if (o.totalScore !== ev.totalScore) changes.push(`Total Score: ${o.totalScore} -> ${ev.totalScore}`);
      if (o.grade !== ev.grade) changes.push(`Grade: ${o.grade} -> ${ev.grade}`);
      if (o.status !== ev.status) changes.push(`Supplier Status: ${o.status} -> ${ev.status}`);
      if (changes.length) description += ` | SOP Eval Changes (${changes.join(", ")})`;
    }
  }
  return description;
}

export async function getBusinessPartnersList(): Promise<any[]> {
  const prisma = requirePrisma();
  const rows = await prisma.businessPartner.findMany({
    orderBy: { createdAt: "desc" },
    include: { evaluation: { include: { documents: true } } },
  });
  return rows.map(mapPartnerRow);
}

/**
 * Refuse a source whose IRC is not the 16-digit IFDA code.
 *
 * The form enforces this too, but that gate is cosmetic (project rule 14).
 * Empty is allowed — not every source has a licence on file yet — and a value
 * that is unchanged from what is already stored is left alone, so records
 * predating the rule (they carry placeholders like "N/A") stay editable.
 */

export async function seedDefaultBusinessPartners() {
  const prisma = requirePrisma();
  const count = await prisma.businessPartner.count();
  if (count > 0) return;
  console.log("[BusinessPartners] Seeding default partners into PostgreSQL (first startup)...");
  for (const p of INITIAL_BUSINESS_PARTNERS_DB) {
    await upsertBusinessPartner(prisma, p);
  }
}
