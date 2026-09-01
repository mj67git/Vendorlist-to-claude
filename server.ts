import express from "express";
import path from "path";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { createServer as createViteServer } from "vite";
import { INITIAL_BUSINESS_PARTNERS_DB } from "./src/db_business_partners.js";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "./src/utils/auditService.js";
import { AUDIT_EVENT_GROUPS } from "./src/utils/auditTaxonomy.js";
import { canSupplySources, calculateGradeAndStatus } from "./src/utils/sopEvaluation.js";
import { findDuplicateMaterial, type MaterialKeyFields } from "./src/utils/materialDuplicates.js";
import {
  can,
  effectivePermissions,
  hasCustomPermissions,
  forbiddenScoreChanges,
  forbiddenRawScoreChanges,
  sanitizePermissions,
  roleTemplate,
  type Permission,
} from "./src/utils/permissions.js";
import { 
  vendorSchema,
  vendorProfileSchema,
  vendorContactSchema,
  vendorScoreSchema,
  vendorLogsSchema,
  vendorAnalysisSchema,
  vendorRiskSchema
} from "./src/utils/validation.js";
import {
  CALCULATION_WEIGHTS,
  GRADE_TIERS,
  calculateRoundedWeightedScore,
  calculateWeightedScore,
  rankVendor,
} from "./src/server/domain/vendorEvaluation.js";
import {
  generateSalt,
  hashPassword,
  verifyPassword,
} from "./src/server/security/passwordService.js";

function getVendorRank(vendorId: string, allVendors: any[]): number {
  return rankVendor(vendorId, allVendors, CALCULATION_WEIGHTS);
}

function parseDateSafely(dateStr: any): Date {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) {
    return isNaN(dateStr.getTime()) ? new Date() : dateStr;
  }
  
  try {
    let str = String(dateStr).trim();
    let d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d;
    }

    const pDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
    for (let i = 0; i < 10; i++) {
      str = str.replace(pDigits[i], String(i));
    }
    const aDigits = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
    for (let i = 0; i < 10; i++) {
      str = str.replace(aDigits[i], String(i));
    }

    str = str.replace(/،/g, ',');

    d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d;
    }

    return new Date();
  } catch (err) {
    return new Date();
  }
}

function generateMaterialId(cas: string | undefined, irc: string | undefined, materialName: string | undefined, materialEn: string | undefined): string {
  const isCasEmpty = !cas || cas === "N/A" || cas === "NA" || cas === "-";
  const isIrcEmpty = !irc || irc === "N/A" || irc === "NA" || irc === "-";
  
  const combinedName = `${materialName || ''}_${materialEn || ''}`.trim();

  if (isCasEmpty && isIrcEmpty && combinedName !== '_') {
    const cleanName = Buffer.from(combinedName).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    return `mat_NA_NA_${cleanName.substring(0, 25)}`.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  const baseId = `mat_${cas || 'NA'}_${irc || 'NA'}`;
  return baseId.replace(/[^a-zA-Z0-9_]/g, '_');
}

// Map a material DB row to the frontend Material shape (name -> nameFa, etc.).
// IRC receive/expiry dates are intentionally excluded: IRC belongs to the
// source (vendor), not the material catalogue.
function mapMaterialToClient(m: any) {
  return {
    id: m.id,
    nameFa: m.name,
    nameEn: m.nameEn,
    cas: m.cas,
    irc: m.irc,
    iupac: m.iupac || '',
    role: m.role || 'API',
    finalProduct: m.finalProduct || '',
    finalProductEn: m.finalProductEn || '',
    pharmacopoeia: m.pharmacopoeia || 'USP',
    standardNameFa: m.standardNameFa || '',
    standardNameEn: m.standardNameEn || '',
    // The blob itself is deliberately absent: it is fetched from
    // GET /api/materials/:id/specification/file (project rule 5).
    specificationFile: m.specificationFile || undefined,
    specificationFileSize: m.specificationFileSize ?? undefined,
    hasSpecificationFile: !!m.specificationFileData,
    specificationUploadedAt: m.specificationUploadedAt
      ? (m.specificationUploadedAt.toISOString?.() || m.specificationUploadedAt)
      : undefined,
    createdAt: m.createdAt ? (m.createdAt.toISOString?.() || m.createdAt) : new Date().toISOString(),
  };
}

// Build the persisted material columns from a client payload (nameFa -> name).
function materialDataFromBody(b: any) {
  return {
    name: (b.nameFa ?? b.name ?? '').trim(),
    nameEn: (b.nameEn ?? '').trim(),
    cas: b.cas || 'N/A',
    irc: b.irc || 'N/A',
    iupac: b.iupac || null,
    role: b.role || null,
    finalProduct: b.finalProduct || null,
    finalProductEn: b.finalProductEn || null,
    pharmacopoeia: b.pharmacopoeia || null,
    standardNameFa: b.standardNameFa || null,
    standardNameEn: b.standardNameEn || null,
    specificationFile: b.specificationFile || null,
  };
}

/**
 * Reject a material that duplicates one already in the repository.
 *
 * The repository form has checked this since it was written, but only in the
 * browser — so it was advice, not a rule (project rule 14). The decision itself
 * lives in `src/utils/materialDuplicates.ts` and is read by both sides, so the
 * two cannot drift apart.
 *
 * Returns the response body when the write must be refused, or null to proceed.
 * The rejection is audited like any other refused change, the way a blocked
 * delete already is.
 */
async function rejectDuplicateMaterial(
  prisma: PrismaClient,
  req: any,
  candidate: MaterialKeyFields,
  current: MaterialKeyFields | null,
): Promise<{ error: string; duplicateOf?: string } | null> {
  const rows = await prisma.material.findMany({
    select: { id: true, name: true, nameEn: true, cas: true, role: true, finalProductEn: true },
  });
  const existing: MaterialKeyFields[] = rows.map(m => ({
    id: m.id, nameFa: m.name, nameEn: m.nameEn, cas: m.cas, role: m.role, finalProductEn: m.finalProductEn,
  }));

  const hit = findDuplicateMaterial(candidate, existing, current);
  if (!hit) return null;

  const now = new Date();
  await AuditService.createAuditRecord({
    auditId: `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
    correlationId: crypto.randomUUID(),
    userId: req.user.username,
    userName: req.user.name,
    role: req.user.role,
    module: "مدیریت مواد",
    action: current ? "Update" : "Create",
    severity: "Warning",
    description: `ثبت مادهٔ تکراری رد شد: ${hit.reason}`,
    entityType: "Material",
    entityId: hit.material.id || "",
    entityName: hit.material.nameFa || hit.material.nameEn || "",
    reasonForChange: "Rejected duplicate material",
    beforeData: null,
    afterData: { attempted: candidate, duplicateOf: hit.material.id, rule: hit.field },
  });

  return { error: hit.reason, duplicateOf: hit.material.id };
}

function isValidPostgresUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string" || !url.trim()) return false;
  const trimmed = url.trim();
  if (
    trimmed.includes("username:password") ||
    trimmed.includes(":port") ||
    trimmed.includes("host:port") ||
    trimmed.includes("database_name") ||
    trimmed.includes("user:password@host")
  ) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      return false;
    }
    if (!parsed.hostname || parsed.hostname === "host" || parsed.hostname === "localhost.invalid") {
      return false;
    }
    if (parsed.port && (isNaN(Number(parsed.port)) || Number(parsed.port) <= 0 || Number(parsed.port) > 65535)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

let _prismaInstance: PrismaClient | null = null;
function getPrismaClient(): PrismaClient | null {
  if (!isValidPostgresUrl(process.env.DATABASE_URL)) {
    return null;
  }
  if (!_prismaInstance) {
    try {
      _prismaInstance = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
      });
      console.log("[Prisma] Lazily initialized PrismaClient for PostgreSQL.");
    } catch (err: any) {
      console.error("[Prisma] Failed to instantiate PrismaClient:", err.message);
      _prismaInstance = null;
    }
  }
  return _prismaInstance;
}

// PostgreSQL is the single source of truth. Fail fast (rather than silently
// falling back to file storage) so misconfiguration surfaces immediately.
function requirePrisma(): PrismaClient {
  const prisma = getPrismaClient();
  if (!prisma) {
    throw new Error(
      "DATABASE_URL is missing or invalid. A valid PostgreSQL connection is required.",
    );
  }
  return prisma;
}

// --- Mapping helpers between the frontend shapes and the normalized enums ---

const DECISION_TO_DB: Record<string, "Pass" | "Reject" | "ApprovedConditional"> = {
  "Pass": "Pass",
  "Reject": "Reject",
  "Approved Conditional": "ApprovedConditional",
};
const DECISION_FROM_DB: Record<string, string> = {
  "Pass": "Pass",
  "Reject": "Reject",
  "ApprovedConditional": "Approved Conditional",
};
const DEVIATION_VALUES = ["None", "NCR", "Deviation", "OOS", "CAPA", "OOT", "Complaint", "Other"];
const RISK_LEVELS = ["Low", "Medium", "High"];

function toDbDecision(d: any): "Pass" | "Reject" | "ApprovedConditional" {
  return DECISION_TO_DB[d] ?? "Pass";
}
function fromDbDecision(d: any): string {
  return DECISION_FROM_DB[d] ?? "Pass";
}
function toDbDeviation(r: any): any {
  return DEVIATION_VALUES.includes(r) ? r : "None";
}
function toDbRiskLevel(l: any): any {
  return RISK_LEVELS.includes(l) ? l : "Low";
}

// Persist a vendor's risk assessment (single row per vendor), analysis records
// and activity logs into their normalized tables. Each collection is fully
// replaced from the passed data so the read-modify-write endpoints stay
// consistent. A field left undefined is not touched (partial saves).
async function persistVendorRelations(prisma: PrismaClient, id: string, v: any): Promise<void> {
  const { riskAssessment, analysisRecords, activityLogs } = v;

  if (riskAssessment !== undefined) {
    await prisma.riskAssessment.deleteMany({ where: { vendorId: id } });
    if (riskAssessment) {
      await prisma.riskAssessment.create({
        data: {
          vendorId: id,
          materialCriticality: Number(riskAssessment.materialCriticality) || 0,
          detectability: Number(riskAssessment.detectability) || 0,
          probability: Number(riskAssessment.probability) || 0,
          sps: Number(riskAssessment.sps) || 0,
          riskScore: Number(riskAssessment.riskScore) || 0,
          sri: Number(riskAssessment.sri) || 0,
          riskLevel: toDbRiskLevel(riskAssessment.riskLevel),
          evaluationDate: riskAssessment.date || null,
          evaluator: riskAssessment.evaluator || null,
        },
      });
    }
  }

  if (analysisRecords !== undefined && Array.isArray(analysisRecords)) {
    await prisma.analysisRecord.deleteMany({ where: { vendorId: id } });
    for (const rec of analysisRecords) {
      await prisma.analysisRecord.create({
        data: {
          id: rec.id || crypto.randomUUID(),
          vendorId: id,
          recordDate: rec.date || null,
          qcCode: rec.qcCode || null,
          decision: toDbDecision(rec.decision),
          deviationReason: toDbDeviation(rec.deviationReason),
          comments: rec.comments || null,
          recordedBy: rec.recordedBy || null,
        },
      });
    }
  }

  if (activityLogs !== undefined && Array.isArray(activityLogs)) {
    await prisma.activityLog.deleteMany({ where: { vendorId: id } });
    for (const log of activityLogs) {
      await prisma.activityLog.create({
        data: {
          id: log.id || crypto.randomUUID(),
          vendorId: id,
          action: log.action || log.details || "بروزرسانی اطلاعات",
          user: log.user || "کاربر سیستم",
          createdAt: log.date ? parseDateSafely(log.date) : new Date(),
        },
      });
    }
  }
}

// --- Business Partner (Manufacturer / Supplier) mapping & persistence ---

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

function toDbPartnerType(t: any): any {
  return BP_TYPES.includes(t) ? t : "Manufacturer";
}
function toDbPartnerStatus(s: any): any {
  return BP_STATUSES.includes(s) ? s : "Active";
}
function toDbSopStatus(s: any): any {
  return s == null ? null : (SOP_STATUS_TO_DB[s] ?? null);
}

// Reconstruct the frontend BusinessPartner shape from a partner row that has
// its evaluation and SOP documents included.
function mapPartnerRow(row: any): any {
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
async function upsertBusinessPartner(prisma: PrismaClient, p: any): Promise<void> {
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
function buildPartnerAuditDescription(action: string, partner: any, before?: any): string {
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

async function getBusinessPartnersList(): Promise<any[]> {
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
function ircViolation(irc: unknown, previousIrc?: unknown): string | null {
  const value = typeof irc === "string" ? irc.trim() : "";
  const previous = typeof previousIrc === "string" ? previousIrc.trim() : "";
  if (value === previous) return null;
  if (value === "" || value === "N/A" || value === "NA" || value === "-") return null;
  if (/^\d{16}$/.test(value)) return null;
  return "کد IRC باید دقیقاً ۱۶ رقم عددی باشد.";
}

/**
 * Refuse a source whose supplier does not meet the SOP.
 *
 * The client greys these out, but that gate is cosmetic (project rule 14): the
 * record is only actually protected if the API refuses it too. Returns an error
 * message when the write must be rejected, or null when it may proceed.
 *
 * A supplier that is already attached to the record is left alone, so a source
 * saved before this rule existed stays editable rather than becoming
 * unsaveable.
 */
async function sopSupplierViolation(
  supplierId: string | null | undefined,
  previousSupplierId?: string | null,
): Promise<string | null> {
  if (!supplierId || supplierId === previousSupplierId) return null;
  const prisma = requirePrisma();
  const row = await prisma.businessPartner.findUnique({
    where: { id: supplierId },
    include: { evaluation: true },
  });
  if (!row) return "فروشندهٔ انتخاب‌شده در مخزن شرکای تجاری یافت نشد.";

  // Derive the grade from the score rather than trusting the stored grade
  // column, which is what the client does on load (reconcileSupplierEvaluation).
  // They disagree in the seeded data: bp_sup_2 is stored as grade B on a score
  // of 80, which the rubric grades A. Reading the column here would have
  // refused a supplier the form shows as selectable.
  const derivedGrade = row.evaluation
    ? calculateGradeAndStatus(row.evaluation.totalScore ?? 0, row.evaluation.grade !== "Not Evaluated").grade
    : undefined;

  const verdict = canSupplySources({
    type: row.type as string,
    status: row.status as string,
    evaluation: derivedGrade ? { grade: derivedGrade } : null,
  });
  return verdict.allowed ? null : `${row.name}: ${verdict.reason}`;
}

async function seedDefaultBusinessPartners() {
  const prisma = requirePrisma();
  const count = await prisma.businessPartner.count();
  if (count > 0) return;
  console.log("[BusinessPartners] Seeding default partners into PostgreSQL (first startup)...");
  for (const p of INITIAL_BUSINESS_PARTNERS_DB) {
    await upsertBusinessPartner(prisma, p);
  }
}

/**
 * Build the vendor objects the API serves.
 *
 * Pass `vendorId` to build just one. Without it every query below runs
 * unfiltered, which is correct for the list endpoint and ruinous for the
 * sixteen handlers that only ever wanted a single record: fetching one vendor
 * used to mean loading every vendor, every evaluation, every activity log and
 * every analysis result, then discarding all but one. The `where` clauses use
 * indexes that already exist on the schema.
 */
async function getVendorsList(vendorId?: string): Promise<any[]> {
  const prisma = requirePrisma();
  {
    // An empty `where` is a no-op, so the same code path serves both the full
    // list and a single record.
    const only: any = vendorId ? { vendorId } : {};
    const vendors = await prisma.vendor.findMany({ where: vendorId ? { id: vendorId } : {} });
    const vendorMaterials = await prisma.vendorMaterial.findMany({ where: only });
    // Materials are reached through the links above, so when building a single
    // vendor only the ones it actually references need loading.
    const materialIds = [...new Set(vendorMaterials.map(vm => vm.materialId).filter(Boolean))] as string[];
    const materials = await prisma.material.findMany({
      where: vendorId ? { id: { in: materialIds } } : {},
    });
    const evaluations = await prisma.evaluation.findMany({ where: only });
    const activityLogRows = await prisma.activityLog.findMany({ where: only, orderBy: { createdAt: "asc" } });
    const riskRows = await prisma.riskAssessment.findMany({ where: only });
    const analysisRows = await prisma.analysisRecord.findMany({ where: only, orderBy: { createdAt: "asc" } });

    const materialsMap = new Map<string, any>(materials.map(m => [m.id, m]));
    const evaluationsMap = new Map<string, any>(evaluations.map(ev => [ev.vendorId, ev]));

    const logsByVendor = new Map<string, any[]>();
    activityLogRows.forEach(log => {
      const existing = logsByVendor.get(log.vendorId) || [];
      existing.push({
        id: log.id,
        action: log.action,
        date: log.createdAt.toISOString(),
        user: log.user
      });
      logsByVendor.set(log.vendorId, existing);
    });

    const riskByVendor = new Map<string, any>();
    riskRows.forEach(r => {
      riskByVendor.set(r.vendorId, {
        materialCriticality: r.materialCriticality,
        detectability: r.detectability,
        probability: r.probability,
        sps: r.sps,
        riskScore: r.riskScore,
        sri: r.sri,
        riskLevel: r.riskLevel,
        date: r.evaluationDate || "",
        evaluator: r.evaluator || ""
      });
    });

    const analysisByVendor = new Map<string, any[]>();
    analysisRows.forEach(a => {
      const existing = analysisByVendor.get(a.vendorId) || [];
      existing.push({
        id: a.id,
        date: a.recordDate || "",
        qcCode: a.qcCode || "",
        decision: fromDbDecision(a.decision),
        deviationReason: a.deviationReason,
        comments: a.comments || "",
        recordedBy: a.recordedBy || ""
      });
      analysisByVendor.set(a.vendorId, existing);
    });

    // Indexed by vendor rather than scanned per vendor: the previous .find()
    // inside this loop made the list endpoint O(n²) — at 1,200 vendors that is
    // over a million comparisons for a single request.
    const linkByVendor = new Map<string, any>();
    for (const vm of vendorMaterials) {
      if (!linkByVendor.has(vm.vendorId)) linkByVendor.set(vm.vendorId, vm);
    }

    const result: any[] = [];
    for (const v of vendors) {
      const link = linkByVendor.get(v.id);
      const materialObj = link ? materialsMap.get(link.materialId) : null;
      const evalObj = evaluationsMap.get(v.id);

      let scoreObj = null;
      let rawScoresObj = null;
      let rejectionReasonsObj = null;

      if (evalObj) {
        try { scoreObj = evalObj.scores ? JSON.parse(evalObj.scores) : null; } catch {}
        try { rawScoresObj = evalObj.rawScores ? JSON.parse(evalObj.rawScores) : null; } catch {}
        try { rejectionReasonsObj = evalObj.rejectionReasons ? JSON.parse(evalObj.rejectionReasons) : null; } catch {}
        
        if (!scoreObj) {
          scoreObj = {
            commercial: evalObj.commercialScore,
            qa: evalObj.qaScore,
            planning: evalObj.planningScore,
            finance: evalObj.financeScore
          };
        }
      }

      const riskObj = riskByVendor.get(v.id) || null;
      const analysisArr: any[] = analysisByVendor.get(v.id) || [];

      let manufacturerId = (v as any).manufacturerId || null;
      let supplierId = (v as any).supplierId || null;
      let contactInfo = v.contactInfo || "";

      if (contactInfo && contactInfo.includes('__BP_METAUIUIUI_STUB__')) {
        // legacy support if any
      }
      if (contactInfo && contactInfo.includes('__BP_METAUI__:')) {
        const parts = contactInfo.split('\n__BP_METAUI__:');
        contactInfo = parts[0];
        const metaParts = (parts[1] || "").split(':');
        manufacturerId = manufacturerId || metaParts[0] || null;
        supplierId = supplierId || metaParts[1] || null;
      }

      result.push({
        id: v.id,
        name: v.name,
        nameEn: v.nameEn,
        country: v.country,
        contactInfo: contactInfo,
        manufacturerId,
        supplierId,
        registrationDate: v.registrationDate || "",
        status: v.status,
        grade: v.grade,
        initialSampleStatus: (v as any).initialSampleStatus || "",
        // The edit form validates against materialId, so it has to travel with
        // the vendor — without it every existing source failed validation with
        // "choose a material" even though one was linked.
        materialId: link ? link.materialId : null,
        material: materialObj ? materialObj.name : "نامشخص",
        materialEn: materialObj ? materialObj.nameEn : "Unknown",
        cas: materialObj ? materialObj.cas : "N/A",
        // IRC lives on the source. Rows written before that column existed only
        // have it on their material, so fall back there rather than blanking a
        // licence number that is really on file.
        irc: (v as any).irc ?? (materialObj ? materialObj.irc : "N/A"),
        // The source's own licence expiry, which is written by PATCH /contact
        // and audited on change but was never read back out. Everything that
        // reads it — the dashboard's expiring-licence card, the detail page,
        // the supplier overview — therefore saw nothing, so the feature looked
        // implemented and always reported zero.
        ircExpiryDate: v.ircExpiryDate ?? null,
        isSample: link ? link.isSample : false,
        category: link ? link.category : "foreign",
        scores: scoreObj,
        rawScores: rawScoresObj,
        rejectionReasons: rejectionReasonsObj,
        activityLogs: logsByVendor.get(v.id) || [],
        analysisRecords: analysisArr,
        riskAssessment: riskObj,
        lastAudit: ""
      });
    }
    return result;
  }
}

/**
 * The minimum needed to place a vendor in the ranking: an id, its scores, and
 * whether it is a sample (samples rank among samples).
 *
 * Ranking a single vendor used to call getVendorsList() twice — before and
 * after the save — which loaded every activity log and analysis record in the
 * database to produce one integer. The ranking logic itself is untouched;
 * rankVendor still receives objects of the shape it expects.
 */
async function getRankingSnapshot(): Promise<any[]> {
  const prisma = requirePrisma();
  const [links, evaluations] = await Promise.all([
    prisma.vendorMaterial.findMany({ select: { vendorId: true, isSample: true, category: true } }),
    prisma.evaluation.findMany({
      select: {
        vendorId: true, scores: true,
        commercialScore: true, qaScore: true, planningScore: true, financeScore: true,
      },
    }),
  ]);

  const linkByVendor = new Map<string, any>();
  for (const l of links) if (!linkByVendor.has(l.vendorId)) linkByVendor.set(l.vendorId, l);

  return evaluations.map(ev => {
    let scores: any = null;
    try { scores = ev.scores ? JSON.parse(ev.scores as any) : null; } catch { /* fall through */ }
    if (!scores) {
      scores = {
        commercial: ev.commercialScore, qa: ev.qaScore,
        planning: ev.planningScore, finance: ev.financeScore,
      };
    }
    const link = linkByVendor.get(ev.vendorId);
    return {
      id: ev.vendorId,
      scores,
      isSample: link ? link.isSample : false,
      category: link ? link.category : "foreign",
    };
  });
}

async function getVendorById(id: string): Promise<any> {
  const list = await getVendorsList(id);
  return list[0] || null;
}

async function saveVendorToDb(v: any): Promise<boolean> {
  const prisma = requirePrisma();
  {
    const {
      id, name, nameEn, country, contactInfo, registrationDate, status, grade,
      material, materialEn, cas, irc, isSample, category,
      scores, rawScores, rejectionReasons,
      activityLogs, analysisRecords, riskAssessment,
      manufacturerId, supplierId
    } = v;

    const serializedContactInfo = contactInfo ? 
      (contactInfo + (manufacturerId || supplierId ? `\n__BP_METAUI__:${manufacturerId || ''}:${supplierId || ''}` : '')) : 
      (manufacturerId || supplierId ? `\n__BP_METAUI__:${manufacturerId || ''}:${supplierId || ''}` : '');

    // risk assessment & analysis records are now stored in normalized tables
    // (see persistVendorRelations), not in the legacy vendor Text columns.
    const scoreText = scores ? JSON.stringify(scores) : null;
    const rawScoreText = rawScores ? JSON.stringify(rawScores) : null;
    const rejectText = rejectionReasons ? JSON.stringify(rejectionReasons) : null;

    const scoreObj = scores || { commercial: 0, qa: 0, planning: 0, finance: 0 };
    const roundedTotal = calculateRoundedWeightedScore(scoreObj, CALCULATION_WEIGHTS);

    await prisma.vendor.upsert({
      where: { id },
      update: {
        name: name || "Unknown",
        nameEn: nameEn || "Unknown",
        country: country || "نامشخص",
        contactInfo: serializedContactInfo,
        registrationDate: registrationDate || new Date().toISOString().split('T')[0],
        status: status || "new",
        grade: grade || null,
        initialSampleStatus: v.initialSampleStatus || null,
        irc: irc || null,
        riskAssessment: null,
        analysisRecords: null,
      },
      create: {
        id,
        name: name || "Unknown",
        nameEn: nameEn || "Unknown",
        country: country || "نامشخص",
        contactInfo: serializedContactInfo,
        registrationDate: registrationDate || new Date().toISOString().split('T')[0],
        status: status || "new",
        grade: grade || null,
        initialSampleStatus: v.initialSampleStatus || null,
        irc: irc || null,
        riskAssessment: null,
        analysisRecords: null,
      },
    });

    /**
     * Link to the material the form actually picked from the catalogue.
     *
     * The id used to be derived with `generateMaterialId(cas, irc, …)`, so the
     * source's IRC became part of the material's identity: registering a source
     * with an IRC minted a second material row for a substance already in the
     * catalogue (`mat_<cas>_<irc>` beside the real `M-…`) and linked the source
     * to that duplicate. Deriving is now only the fallback for legacy payloads
     * that carry no materialId, and the IRC is no longer part of it.
     */
    const materialId = v.materialId || generateMaterialId(cas, undefined, material, materialEn);
    const existingMaterial = await prisma.material.findUnique({ where: { id: materialId } });
    if (!existingMaterial) {
      // Only ever create the catalogue entry from a vendor payload; never
      // overwrite one, or saving a source would rewrite the master record.
      await prisma.material.create({
        data: {
          id: materialId,
          name: material || "نامشخص",
          nameEn: materialEn || "Unknown",
          cas: cas || "N/A",
          irc: "N/A",
        },
      });
    }

    // Delete any old links for this vendor that point to a different material
    await prisma.vendorMaterial.deleteMany({
      where: {
        vendorId: id,
        materialId: { not: materialId }
      }
    });

    /**
     * Upsert on (vendorId, materialId), not on the synthetic `link_<v>_<m>` id.
     *
     * Links created outside this function (seeds, imports) carry their own ids,
     * so keying the upsert on the synthetic one tried to *insert* a second row
     * for a pair that already exists and hit the unique constraint. It stayed
     * hidden only because the material id used to be derived from the payload,
     * which made the deleteMany above drop the existing link first.
     */
    await prisma.vendorMaterial.upsert({
      where: { vendorId_materialId: { vendorId: id, materialId } },
      update: {
        isSample: isSample ?? false,
        category: category || "foreign",
      },
      create: {
        id: `link_${id}_${materialId}`,
        vendorId: id,
        materialId: materialId,
        isSample: isSample ?? false,
        category: category || "foreign",
      },
    });

    const evalId = `eval_${id}_${materialId}`;
    await prisma.evaluation.upsert({
      where: { id: evalId },
      update: {
        period: "۱۴۰۵-Q1",
        commercialScore: scoreObj.commercial || 0,
        qaScore: scoreObj.qa || 0,
        planningScore: scoreObj.planning || 0,
        financeScore: scoreObj.finance || 0,
        totalScore: roundedTotal,
        grade: grade || "C",
        scores: scoreText,
        rawScores: rawScoreText,
        rejectionReasons: rejectText,
      },
      create: {
        id: evalId,
        vendorId: id,
        materialId: materialId,
        period: "۱۴۰۵-Q1",
        commercialScore: scoreObj.commercial || 0,
        qaScore: scoreObj.qa || 0,
        planningScore: scoreObj.planning || 0,
        financeScore: scoreObj.finance || 0,
        totalScore: roundedTotal,
        grade: grade || "C",
        scores: scoreText,
        rawScores: rawScoreText,
        rejectionReasons: rejectText,
      },
    });

    await persistVendorRelations(prisma, id, v);

    return true;
  }
}

async function deleteVendorFromDb(id: string): Promise<boolean> {
  const prisma = requirePrisma();
  try {
    // Evaluations, vendor-material links, risk assessments, analysis records
    // and activity logs cascade on the vendor delete via their foreign keys.
    await prisma.evaluation.deleteMany({ where: { vendorId: id } });
    await prisma.vendorMaterial.deleteMany({ where: { vendorId: id } });
    await prisma.vendor.delete({ where: { id } });
    return true;
  } catch (err: any) {
    // Prisma throws P2025 when the target row does not exist.
    if (err?.code === "P2025") {
      return false;
    }
    throw err;
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "internal-regulatory-compliance-secret-key-321";

// Default users provisioned into PostgreSQL on first startup (empty users table).
const DEFAULT_USERS: Array<{ username: string; password: string; role: string; name: string }> = [
  { username: "admin", password: "123456", role: "admin", name: "مدیر سیستم" },
  { username: "commercial", password: "123", role: "commercial", name: "واحد بازرگانی" },
  { username: "qa", password: "123", role: "qa", name: "واحد کیفیت" },
  { username: "planning", password: "123", role: "planning", name: "واحد برنامه‌ریزی و انبار" },
  { username: "finance", password: "123", role: "finance", name: "واحد مالی" },
];

const ALLOWED_USER_ROLES = ["admin", "lab", "commercial", "qa", "planning", "finance"] as const;
type UserRoleValue = (typeof ALLOWED_USER_ROLES)[number];

function normalizeUserRole(role: any): UserRoleValue {
  return ALLOWED_USER_ROLES.includes(role) ? role : "commercial";
}

// Shape returned to endpoints; mirrors the legacy in-memory user record so the
// route handlers (and verifyPassword) keep working against a { hash, salt } pair.
interface AppUser {
  username: string;
  name: string;
  role: string;
  password: { hash: string; salt: string };
  permissions: any;
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: Date | null;
}

function mapUserRow(row: any): AppUser {
  return {
    username: row.username,
    name: row.name,
    role: row.role,
    password: { hash: row.passwordHash, salt: row.passwordSalt },
    permissions: row.permissions ?? [],
    mustChangePassword: row.mustChangePassword !== false,
    // Both of these columns existed but were dropped here, which is why nothing
    // in the app could see them: an account could be marked inactive and still
    // sign in, and "last login" was never available to show.
    isActive: row.isActive !== false,
    lastLoginAt: row.lastLoginAt ?? null,
  };
}

async function getUserByUsername(username: string): Promise<AppUser | null> {
  const prisma = requirePrisma();
  const row = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
  return row ? mapUserRow(row) : null;
}

async function getAllUsers(): Promise<AppUser[]> {
  const prisma = requirePrisma();
  const rows = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(mapUserRow);
}

async function seedDefaultUsers() {
  const prisma = requirePrisma();
  const count = await prisma.user.count();
  if (count > 0) return;
  console.log("[UsersDB] Seeding default users into PostgreSQL (first startup)...");
  for (const u of DEFAULT_USERS) {
    const salt = generateSalt();
    await prisma.user.create({
      data: {
        username: u.username.toLowerCase(),
        name: u.name,
        role: normalizeUserRole(u.role) as any,
        passwordHash: hashPassword(u.password, salt),
        passwordSalt: salt,
        mustChangePassword: true,
      },
    });
  }
}

function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access Denied: Security token is missing or not provided" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    // 401, not 403: the token is missing or no longer verifies, which is a
    // failure to authenticate. 403 is reserved for a known user who is not
    // allowed to do this, so the client can tell the two apart.
    return res.status(401).json({ error: "Access Denied: Session integrity verification failed" });
  }
}

/**
 * Restrict a route to specific roles. Chain it after requireAuth, which is what
 * populates req.user from the token.
 *
 * The role checks the UI performs are for usability only: currentUser is read
 * from localStorage and can be edited in devtools, so the server has to be the
 * one that decides. Without this every signed-in user could reach the user
 * endpoints and grant themselves admin — which would undermine the audit trail,
 * since its value rests on access control being trustworthy.
 */
/**
 * Refuse changes that would leave nobody able to administer the system.
 *
 * Without these an admin can lock the whole organisation out of user
 * management with one click — demote or close the only admin account and there
 * is no longer any route back in short of editing the database by hand.
 * Returns a message when the change must be refused, or null when it is safe.
 */
async function checkAdminSafety(
  actor: { username: string },
  targetUsername: string,
  change: { role?: string; isActive?: boolean; deleting?: boolean },
): Promise<string | null> {
  const target = targetUsername.toLowerCase();
  const isSelf = actor.username.toLowerCase() === target;

  if (isSelf) {
    if (change.deleting) return "حذف حساب کاربری خودتان امکان‌پذیر نیست.";
    if (change.isActive === false) return "غیرفعال‌کردن حساب کاربری خودتان امکان‌پذیر نیست.";
    if (change.role && change.role !== "admin") return "تغییر نقش خودتان از مدیر سیستم امکان‌پذیر نیست.";
  }

  const losesAdmin =
    change.deleting || change.isActive === false || (change.role && change.role !== "admin");
  if (!losesAdmin) return null;

  const current = await getUserByUsername(target);
  if (!current || current.role !== "admin" || current.isActive === false) return null;

  const activeAdmins = await requirePrisma().user.count({
    where: { role: "admin" as any, isActive: true },
  });
  if (activeAdmins <= 1) {
    return "این تنها مدیر فعال سامانه است؛ ابتدا یک مدیر دیگر تعریف یا فعال کنید.";
  }
  return null;
}

/**
 * Restrict a route to the roles holding a permission, read from the shared
 * policy table that the UI reads too. The UI hides what a role cannot do; this
 * is what actually prevents it — a hidden button is still a reachable endpoint.
 */
/**
 * Refuse a permission change that would leave nobody able to administer users.
 *
 * `users.manage` is the way back in: strip it from the last account that holds
 * it and the only remaining route to user management is the database.
 */
async function checkPermissionSafety(
  actor: { username: string },
  targetUsername: string,
  nextPermissions: Permission[],
): Promise<string | null> {
  const target = targetUsername.toLowerCase();
  const keepsAdmin = nextPermissions.includes("users.manage");
  if (keepsAdmin) return null;

  if (actor.username.toLowerCase() === target) {
    return "برداشتن دسترسی «مدیریت کاربران» از حساب خودتان امکان‌پذیر نیست.";
  }

  const current = await getUserByUsername(target);
  if (!current || current.isActive === false) return null;
  if (!can(current, "users.manage")) return null;

  const others = (await getAllUsers()).filter(
    u => u.username.toLowerCase() !== target && u.isActive !== false && can(u, "users.manage"),
  );
  if (others.length === 0) {
    return "این تنها حساب دارای دسترسی «مدیریت کاربران» است؛ ابتدا این دسترسی را به کاربر دیگری بدهید.";
  }
  return null;
}

function requirePermission(permission: Permission) {
  return async function (req: any, res: any, next: any) {
    // The account is loaded rather than read off the token. The token lives for
    // seven days and carries only the role, so an admin's change to someone's
    // permissions would not take effect until it expired — which would defeat
    // the point of being able to change them. This is one primary-key lookup on
    // write requests; reads do not go through here.
    try {
      const account = await getUserByUsername(req.user?.username || "");
      if (!account || account.isActive === false) {
        return res.status(401).json({ error: "این حساب کاربری دیگر معتبر نیست." });
      }
      if (!can(account, permission)) {
        return res.status(403).json({
          error: "عدم دسترسی: سطح دسترسی شما اجازهٔ انجام این عملیات را نمی‌دهد.",
        });
      }
      req.account = account;
      next();
    } catch (err: any) {
      console.error("Permission check failed:", err);
      return res.status(500).json({ error: "بررسی سطح دسترسی با خطا مواجه شد." });
    }
  };
}

function requireRole(...roles: string[]) {
  return function (req: any, res: any, next: any) {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "عدم دسترسی: این عملیات فقط برای مدیران سیستم مجاز است.",
      });
    }
    next();
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // PostgreSQL is the single source of truth. Verify connectivity and provision
  // the default users on first startup before serving any request.
  if (!isValidPostgresUrl(process.env.DATABASE_URL)) {
    console.error(
      "[FATAL] DATABASE_URL is missing or invalid. A valid PostgreSQL connection is required to start the server.",
    );
  } else {
    try {
      await seedDefaultUsers();
    } catch (err: any) {
      console.error("[Startup] Failed to provision default users:", err.message);
    }
    try {
      await seedDefaultBusinessPartners();
    } catch (err: any) {
      console.error("[Startup] Failed to provision default business partners:", err.message);
    }
  }

  // --- API Routes ---

  // Health check - Returns simple status of the server
  app.get("/api/health", async (req, res) => {
    res.json({ 
      status: "ok", 
      timestamp: new Date() 
    });
  });

  function getClientIp(req: any): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = typeof forwarded === 'string' ? forwarded.split(',') : forwarded;
      return ips[0].trim();
    }
    return req.ip || req.connection?.remoteAddress || '127.0.0.1';
  }

  function getUserAgent(req: any): string {
    return req.headers['user-agent'] || 'Unknown Browser/Device';
  }

  // User Login (Authenticates users securely)
  app.post("/api/auth/login", async (req, res) => {
    try {
    const { username, password } = req.body;
    const ipAddress = getClientIp(req);
    const userAgent = getUserAgent(req);
    const now = new Date();
    const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    if (!username || !password) {
      AuditService.createAuditRecord({
        auditId,
        userId: username || "unknown",
        userName: username || "ناشناس",
        role: "guest",
        module: "احراز هویت",
        eventType: "Authentication",
        ipAddress,
        userAgent,
        entityType: "Security Event",
        entityId: username || "unknown",
        entityName: username || "ورود ناموفق",
        action: "FAILED_LOGIN",
        severity: "Warning",
        description: "تلاش ناموفق برای ورود به سیستم: عدم ارسال نام کاربری یا کلمه عبور",
        reasonForChange: "عدم ارسال مشخصات ورودی (Missing Credentials)",
        beforeData: null,
        afterData: { attemptedUsername: username || null }
      }).catch(err => console.error("Audit logging failed on failed login:", err));

      return res.status(400).json({ error: "نام کاربری و کلمهٔ عبور را وارد کنید." });
    }

    const matchedUser = await getUserByUsername(username);
    if (!matchedUser) {
      AuditService.createAuditRecord({
        auditId,
        userId: username,
        userName: username,
        role: "guest",
        module: "احراز هویت",
        eventType: "Authentication",
        ipAddress,
        userAgent,
        entityType: "Security Event",
        entityId: username,
        entityName: username,
        action: "FAILED_LOGIN",
        severity: "Warning",
        description: `تلاش ناموفق برای ورود به سیستم با نام کاربری ${username}: کاربر یافت نشد`,
        reasonForChange: "نام کاربری نادرست یا تعریف نشده در پایگاه داده",
        beforeData: null,
        afterData: { attemptedUsername: username }
      }).catch(err => console.error("Audit logging failed on failed login:", err));

      return res.status(401).json({ error: "نام کاربری یا کلمهٔ عبور نادرست است." });
    }

    const isPasswordCorrect = verifyPassword(password, matchedUser.password);

    if (!isPasswordCorrect) {
      AuditService.createAuditRecord({
        auditId,
        userId: matchedUser.username,
        userName: matchedUser.name,
        role: matchedUser.role,
        module: "احراز هویت",
        eventType: "Authentication",
        ipAddress,
        userAgent,
        entityType: "Security Event",
        entityId: matchedUser.username,
        entityName: matchedUser.name,
        action: "FAILED_LOGIN",
        severity: "Warning",
        description: `تلاش ناموفق برای ورود به سیستم با نام کاربری ${matchedUser.username}: کلمه عبور اشتباه است`,
        reasonForChange: "کلمه عبور وارد شده با هش ذخیره شده مطابقت ندارد",
        beforeData: null,
        afterData: { attemptedUsername: matchedUser.username }
      }).catch(err => console.error("Audit logging failed on failed login:", err));

      return res.status(401).json({ error: "نام کاربری یا کلمهٔ عبور نادرست است." });
    }

    // A deactivated account is refused here, after the password check, so the
    // response cannot be used to tell a closed account from a wrong password.
    if (matchedUser.isActive === false) {
      AuditService.createAuditRecord({
        auditId,
        userId: matchedUser.username,
        userName: matchedUser.name,
        role: matchedUser.role,
        module: "احراز هویت",
        eventType: "Authentication",
        ipAddress,
        userAgent,
        entityType: "Security Event",
        entityId: matchedUser.username,
        entityName: matchedUser.name,
        action: "FAILED_LOGIN",
        severity: "Warning",
        description: `تلاش برای ورود با حساب کاربری غیرفعال ${matchedUser.username}`,
        reasonForChange: "حساب کاربری توسط مدیر سیستم غیرفعال شده است",
        beforeData: null,
        afterData: { attemptedUsername: matchedUser.username }
      }).catch(err => console.error("Audit for inactive login failed:", err));

      return res.status(403).json({ error: "این حساب کاربری غیرفعال است. با مدیر سیستم تماس بگیرید." });
    }

    // Sign the JWT securely
    const token = jwt.sign(
      { username: matchedUser.username, role: matchedUser.role, name: matchedUser.name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Read the previous sign-in before overwriting it: what a person wants to
    // see when they log in is when they were *last* here, not the moment they
    // just arrived. It is returned once at login and then left alone, since
    // /api/auth/me deliberately does not send it back.
    const previousLoginAt = matchedUser.lastLoginAt ? new Date(matchedUser.lastLoginAt).toISOString() : null;

    requirePrisma().user
      .update({ where: { username: matchedUser.username.toLowerCase() }, data: { lastLoginAt: new Date() } })
      .catch(err => console.error("Failed to record last login:", err));

    const mustChangePassword = matchedUser.mustChangePassword !== false;

    // Log the login activity
    AuditService.createAuditRecord({
      auditId,
      userId: matchedUser.username,
      userName: matchedUser.name,
      role: matchedUser.role,
      module: "احراز هویت",
      eventType: "Authentication",
      ipAddress,
      userAgent,
      entityType: "Security Event",
      entityId: matchedUser.username,
      entityName: matchedUser.name,
      action: "LOGIN",
      severity: "Information",
      description: `ورود موفقیت‌آمیز کاربر ${matchedUser.name} (${matchedUser.username}) به سامانه`,
      reasonForChange: "احراز هویت موفق با کلمه عبور و تولید کلید JWT",
      beforeData: null,
      afterData: { username: matchedUser.username, role: matchedUser.role, name: matchedUser.name }
    }).catch(err => console.error("Audit logging failed on login:", err));

    res.json({
      success: true,
      token,
      user: {
        username: matchedUser.username,
        role: matchedUser.role,
        name: matchedUser.name,
        // The effective list, so the UI gates on exactly what the server will.
        permissions: effectivePermissions(matchedUser),
        // The client only ever receives the effective list, so it cannot work
        // out on its own whether that came from the role or from an override.
        permissionsCustom: hasCustomPermissions(matchedUser),
        previousLoginAt,
        mustChangePassword
      }
    });
    } catch (err: any) {
      // Always answer with JSON so the client never has to parse an HTML error
      // page (e.g. when the database is unreachable or not yet migrated).
      console.error("[Login] Unexpected failure:", err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({
          error: "خطای سرور در ورود — اتصال یا مهاجرت پایگاه‌داده را بررسی کنید (DATABASE_URL / migrate).",
        });
      }
    }
  });

  // User Logout endpoint
  app.post("/api/auth/logout", requireAuth, async (req: any, res) => {
    try {
      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const ipAddress = getClientIp(req);
      const userAgent = getUserAgent(req);

      await AuditService.createAuditRecord({
        auditId,
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "احراز هویت",
        eventType: "Authentication",
        ipAddress,
        userAgent,
        entityType: "Security Event",
        entityId: req.user.username,
        entityName: req.user.name,
        action: "LOGOUT",
        severity: "Information",
        description: `خروج موفقیت‌آمیز کاربر ${req.user.name} (${req.user.username}) از سامانه`,
        reasonForChange: "ارسال درخواست خروج صریح از سوی کاربر",
        beforeData: { sessionStatus: "Active" },
        afterData: { sessionStatus: "Logged Out" }
      });

      res.json({ success: true, message: "با موفقیت از سیستم خارج شدید" });
    } catch (err: any) {
      console.error("Logout audit log failed:", err);
      res.json({ success: true });
    }
  });

  // Change Password endpoint for security compliance
  app.post("/api/auth/change-password", requireAuth, async (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    const username = req.user.username;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "وارد کردن کلمه عبور فعلی و جدید الزامی است" });
    }

    if (newPassword === "123" || newPassword === "123456") {
      return res.status(400).json({ error: "کلمه عبور جدید نمی‌تواند رمز پیش‌فرض باشد" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "کلمه عبور جدید باید حداقل ۶ کاراکتر باشد" });
    }

    const matchedUser = await getUserByUsername(username);
    if (!matchedUser) {
      return res.status(404).json({ error: "کاربر یافت نشد" });
    }

    const isCurrentPasswordCorrect = verifyPassword(currentPassword, matchedUser.password);

    if (!isCurrentPasswordCorrect) {
      return res.status(400).json({ error: "کلمه عبور فعلی وارد شده نادرست است" });
    }

    // Change the password, hash and salt it, and persist
    const newSalt = generateSalt();
    await requirePrisma().user.update({
      where: { username: username.toLowerCase() },
      data: {
        passwordHash: hashPassword(newPassword, newSalt),
        passwordSalt: newSalt,
        mustChangePassword: false,
      },
    });

    // Log the password change activity
    const now = new Date();
    const year = now.getFullYear();
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const auditId = `AUD-${year}-${randomNum}`;
    AuditService.createAuditRecord({
      auditId,
      userId: req.user.username,
      userName: req.user.name,
      role: req.user.role,
      module: "مدیریت کاربران",
      action: "Update",
      severity: "Warning",
      description: `کلمه عبور کاربر ${req.user.name} با موفقیت بروزرسانی و امن‌سازی شد.`,
      entityType: "User",
      entityId: req.user.username,
      entityName: req.user.name,
      beforeData: { info: "کلمه عبور قبلی تغییر یافت" },
      afterData: { info: "کلمه عبور جدید با هش و سالت ذخیره شد" }
    }).catch(err => console.error("Audit logging failed on password change:", err));

    console.log(`[Security] Password successfully updated and hashed for user: ${username}`);
    res.json({ 
      success: true, 
      message: "کلمه عبور با موفقیت تغییر یافت",
      user: {
        username: matchedUser.username,
        role: matchedUser.role,
        name: matchedUser.name,
        permissions: effectivePermissions(matchedUser),
        mustChangePassword: false
      }
    });
  });

  // Fetch / verify logged in user's profile state
  // The client calls this on boot to re-check the account it restored from
  // localStorage. Role and name therefore come from the database rather than
  // from the token: the token is valid for seven days, so reading the role back
  // out of it would just echo whatever was true when the user signed in and
  // could never report a role change or a closed account.
  app.get("/api/auth/me", requireAuth, async (req: any, res) => {
    const username = req.user.username;
    const matchedUser = await getUserByUsername(username);

    // 401 here so authFetch ends the session: an account that was closed or
    // deactivated mid-session should be signed out on the next load rather than
    // keeping its access until the seven-day token runs out.
    if (!matchedUser || matchedUser.isActive === false) {
      return res.status(401).json({ error: "این حساب کاربری دیگر معتبر نیست." });
    }

    res.json({
      success: true,
      user: {
        username: matchedUser.username,
        role: matchedUser.role,
        name: matchedUser.name,
        permissions: effectivePermissions(matchedUser),
        // The client only ever receives the effective list, so it cannot work
        // out on its own whether that came from the role or from an override.
        permissionsCustom: hasCustomPermissions(matchedUser),
        mustChangePassword: matchedUser.mustChangePassword !== false
      }
    });
  });

  /**
   * The signed-in user's own recent activity.
   *
   * The audit trail itself is admin-only, but reading back what *you* did is
   * not a privileged act, and it is the fastest way for someone to notice
   * activity on their account that was not theirs. The filter is taken from the
   * token, never from the query string, so this cannot be pointed at anyone
   * else's history.
   */
  app.get("/api/auth/my-activity", requireAuth, async (req: any, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 8, 25);
      const result = await AuditService.getAuditLogs({ userId: req.user.username }, 1, limit);
      res.json({ success: true, data: result?.data ?? [], total: result?.total ?? 0 });
    } catch (err: any) {
      console.error("Failed to fetch own activity:", err);
      res.status(500).json({ error: "دریافت فعالیت اخیر با خطا مواجه شد." });
    }
  });

  // ==========================================
  // Source selection — the recorded purchasing decision per material
  // ==========================================

  app.get("/api/source-selections", requireAuth, requirePermission("vendor.read"), async (req: any, res) => {
    try {
      const rows = await requirePrisma().sourceSelection.findMany();
      res.json(rows.map(r => ({
        materialKey: r.materialKey,
        category: r.category,
        vendorId: r.vendorId,
        reason: r.reason,
        decidedBy: r.decidedBy,
        decidedAt: r.decidedAt.toISOString(),
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
  app.put("/api/source-selections", requireAuth, requirePermission("vendor.edit"), async (req: any, res) => {
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

      const prisma = requirePrisma();
      const previous = await prisma.sourceSelection.findUnique({
        where: { materialKey_category: { materialKey, category } },
      });

      const decidedBy = req.user.name || req.user.username;
      const saved = await prisma.sourceSelection.upsert({
        where: { materialKey_category: { materialKey, category } },
        create: { materialKey, category, vendorId, reason: String(reason).trim(), decidedBy },
        update: { vendorId, reason: String(reason).trim(), decidedBy, decidedAt: new Date() },
      });

      const now = new Date();
      await AuditService.createAuditRecord({
        auditId: `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        correlationId: crypto.randomUUID(),
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
        },
      });
    } catch (err: any) {
      console.error("Failed to save source selection:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Dynamic configuration endpoint for scoring weights & mapping criteria
  app.get("/api/config/evaluation", (req, res) => {
    res.json({
      weights: CALCULATION_WEIGHTS,
      tiers: GRADE_TIERS
    });
  });

  // Get all vendors (Unified Database)
  app.get("/api/vendors", requireAuth, requirePermission("vendor.read"), async (req: any, res) => {
    try {
      const list = await getVendorsList();
      res.json(list);
    } catch (error: any) {
      console.error("Failed to fetch vendors:", error);
      res.status(500).json({ error: "Failed to fetch vendors" });
    }
  });

  // Score history for a single vendor, reconstructed from the audit trail
  // (each scoring writes an audit record with before/after SPS). Available to
  // any authenticated user so the trend shows on the vendor detail page.
  app.get("/api/vendors/:id/score-history", requireAuth, requirePermission("vendor.read"), async (req: any, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  // Risk assessment history (reconstructed from audit trail)
  app.get("/api/vendors/:id/risk-history", requireAuth, requirePermission("vendor.read"), async (req: any, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  // Create or Update single vendor (Unified Database)
  app.post("/api/vendors", requireAuth, requirePermission("vendor.create"), async (req: any, res) => {
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
  app.patch("/api/vendors/:id/profile", requireAuth, requirePermission("vendor.edit"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
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

      await saveVendorToDb(updatedVendor);
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
      res.status(500).json({ error: err.message });
    }
  });

  // Update vendor contact details (Unified Database)
  app.patch("/api/vendors/:id/contact", requireAuth, requirePermission("vendor.edit"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
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
      await saveVendorToDb(updatedVendor);
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
      res.status(500).json({ error: err.message });
    }
  });

  // Update vendor scores & evaluations (Unified Database)
  app.patch("/api/vendors/:id/scores", requireAuth, async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
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

      await saveVendorToDb(updatedVendor);
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
      res.status(500).json({ error: err.message });
    }
  });

  // Update vendor activity logs (Unified Database)
  app.patch("/api/vendors/:id/logs", requireAuth, requirePermission("vendor.edit"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
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
      await saveVendorToDb(updatedVendor);
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
      res.status(500).json({ error: err.message });
    }
  });

  // Update vendor analysis records & logs (Unified Database)
  app.patch("/api/vendors/:id/analysis", requireAuth, requirePermission("vendor.analysis"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
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
      await saveVendorToDb(updatedVendor);
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
      res.status(500).json({ error: err.message });
    }
  });

  // Update vendor risk assessment (Unified Database)
  app.patch("/api/vendors/:id/risk", requireAuth, requirePermission("vendor.risk"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
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
      await saveVendorToDb(updatedVendor);
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
      res.status(500).json({ error: err.message });
    }
  });

  // Delete vendor (Unified Database)
  app.delete("/api/vendors/:id", requireAuth, requirePermission("vendor.delete"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const current = await getVendorById(id);
      if (!current) {
        return res.status(404).json({ error: "Vendor not found" });
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

  app.post("/api/audit-logs", requireAuth, async (req: any, res) => {
    try {
      const logData = req.body;
      const { user } = req;
      
      const newLog = {
        userId: user.username,
        userName: user.name,
        role: user.role,
        module: logData.module || "System",
        action: logData.action,
        entityType: logData.entityType,
        entityId: logData.entityId,
        entityName: logData.entityName,
        severity: logData.severity || "info",
        description: logData.description,
        reasonForChange: logData.reasonForChange || "",
        ipAddress: req.ip || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "",
        beforeValue: logData.beforeValue ? JSON.stringify(logData.beforeValue) : null,
        afterValue: logData.afterValue ? JSON.stringify(logData.afterValue) : null,
      };

      await AuditService.logEvent(newLog);
      return res.status(201).json({ success: true });
    } catch (err: any) {
      console.error("Failed to create audit log:", err);
      return res.status(500).json({ error: "Failed to create audit log" });
    }
  });

  app.get("/api/audit-logs", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
    try {

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

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
      res.status(500).json({ error: "Internal Server Error: " + err.message });
    }
  });

  app.get("/api/audit-logs/stats", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
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
      res.status(500).json({ error: "Internal Server Error: " + err.message });
    }
  });

  app.get("/api/audit-logs/filters", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
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

  app.get("/api/audit-logs/:id", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
    try {

      const log = await AuditService.getAuditById(req.params.id);
      if (!log) {
        return res.status(404).json({ error: "Audit log not found" });
      }
      res.json(log);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // --- User Management Endpoints ---
  // ==========================================

  app.get("/api/users", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const usersList = (await getAllUsers()).map(u => ({
        username: u.username,
        name: u.name,
        role: u.role,
        permissions: sanitizePermissions(u.permissions),
        effectivePermissions: effectivePermissions(u),
        mustChangePassword: u.mustChangePassword !== false,
        isActive: u.isActive !== false,
        lastLoginAt: u.lastLoginAt || null
      }));
      res.json(usersList);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/users", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const { username, name, role, password, permissions, reasonForChange } = req.body;
      if (!username || !name || !role) {
        return res.status(400).json({ error: "فیلدهای username، name و role الزامی هستند." });
      }

      // These rules used to live only in the React form, so the endpoint itself
      // accepted a username with spaces, a one-character password, an unknown
      // role (silently coerced to `commercial` while the response echoed back
      // the invalid one) and permission names that exist nowhere. Rule 14: the
      // server is where access rules are enforced, the form is only UX.
      const cleanName = String(name).trim();
      if (!cleanName) {
        return res.status(400).json({ error: "نام و نام خانوادگی الزامی است." });
      }
      const key = String(username).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,}$/.test(key)) {
        return res.status(400).json({
          error: "نام کاربری باید حداقل ۳ کاراکتر و فقط شامل حروف لاتین، عدد، نقطه، خط تیره یا زیرخط باشد.",
        });
      }
      if (!ALLOWED_USER_ROLES.includes(role)) {
        return res.status(400).json({
          error: `سمت سازمانی نامعتبر است. مقادیر مجاز: ${ALLOWED_USER_ROLES.join("، ")}`,
        });
      }
      // An omitted password falls back to the shared default, which the account
      // must change on first sign-in; a supplied one has to be a real password.
      if (password !== undefined && String(password).length < 6) {
        return res.status(400).json({ error: "کلمه عبور اولیه باید حداقل ۶ کاراکتر باشد." });
      }
      if (permissions !== undefined && !Array.isArray(permissions)) {
        return res.status(400).json({ error: "فیلد permissions باید یک آرایه باشد." });
      }

      if (await getUserByUsername(key)) {
        return res.status(400).json({ error: "کاربری با این نام کاربری قبلاً تعریف شده است." });
      }

      const uSalt = generateSalt();
      const uPassword = password || "123456";
      const newUser = {
        username: key,
        name: cleanName,
        role: role as UserRoleValue,
        // Unknown names are dropped rather than stored, exactly as in PATCH and
        // PUT /permissions — this was the one write path that skipped it.
        permissions: sanitizePermissions(permissions),
        mustChangePassword: true
      };

      await requirePrisma().user.create({
        data: {
          username: key,
          name: cleanName,
          role: newUser.role as any,
          passwordHash: hashPassword(uPassword, uSalt),
          passwordSalt: uSalt,
          permissions: newUser.permissions,
          mustChangePassword: true,
        },
      });

      // Log creation to Audit Trail
      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "CREATE_USER",
        severity: "Information",
        description: `کاربر جدید با نام کاربری ${key} و سمت ${newUser.role} توسط ${req.user.name} ایجاد شد.`,
        entityType: "User",
        entityId: key,
        entityName: cleanName,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange || "تعریف دسترسی پرسنل جدید فرآیندی",
        beforeData: null,
        afterData: { username: key, name: cleanName, role: newUser.role, permissions: newUser.permissions }
      });

      // The stored record, not the submitted one: the response used to echo the
      // request back, so an invalid role reached the client as if it had been
      // accepted and the table showed it until the next reload.
      res.json({
        success: true,
        user: {
          username: key,
          name: cleanName,
          role: newUser.role,
          permissions: newUser.permissions,
          effectivePermissions: effectivePermissions({ role: newUser.role, permissions: newUser.permissions } as any),
        },
      });
    } catch (err: any) {
      console.error("Failed to create user:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/users/:username", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const targetUsername = req.params.username.toLowerCase();
      const current = await getUserByUsername(targetUsername);
      if (!current) {
        return res.status(404).json({ error: "کاربر یافت نشد" });
      }

      const { name, role, permissions, isActive, reasonForChange } = req.body;
      const originalData = {
        name: current.name,
        role: current.role,
        permissions: current.permissions || [],
        isActive: current.isActive !== false,
      };

      const unsafe = await checkAdminSafety(req.user, targetUsername, { role, isActive });
      if (unsafe) return res.status(400).json({ error: unsafe });

      if (name) current.name = name;
      if (typeof isActive === "boolean") current.isActive = isActive;

      const roleChanged = !!role && role !== current.role;
      if (role) current.role = role;

      if (permissions) {
        current.permissions = sanitizePermissions(permissions);
      } else if (roleChanged) {
        // Moving someone to a new role clears their old exceptions. Carrying
        // them across would silently follow a person into a different job —
        // the new role's template is the honest starting point.
        current.permissions = [];
      }

      await requirePrisma().user.update({
        where: { username: targetUsername },
        data: {
          name: current.name,
          role: normalizeUserRole(current.role) as any,
          permissions: current.permissions ?? [],
          isActive: current.isActive !== false,
        },
      });

      // Log update to Audit Trail
      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "UPDATE_USER",
        severity: "Warning",
        description: `مشخصات حساب کاربری ${targetUsername} توسط ${req.user.name} ویرایش گردید.`,
        entityType: "User",
        entityId: targetUsername,
        entityName: current.name,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange || "بروزرسانی سمت سازمانی / دسترسی‌های سیستمی",
        beforeData: originalData,
        afterData: { name: current.name, role: current.role, permissions: current.permissions || [], isActive: current.isActive !== false }
      });

      res.json({
        success: true,
        permissionsReset: roleChanged && !permissions,
        user: {
          username: current.username, name: current.name, role: current.role,
          permissions: sanitizePermissions(current.permissions),
          effectivePermissions: effectivePermissions(current),
          isActive: current.isActive !== false,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/users/:username", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const targetUsername = req.params.username.toLowerCase();
      const current = await getUserByUsername(targetUsername);
      if (!current) {
        return res.status(404).json({ error: "کاربر یافت نشد" });
      }

      const unsafeDelete = await checkAdminSafety(req.user, targetUsername, { deleting: true });
      if (unsafeDelete) return res.status(400).json({ error: unsafeDelete });

      const reasonForChange = req.query.reasonForChange as string || "حذف دسترسی پرسنل تسویه شده";
      const beforeData = { username: current.username, name: current.name, role: current.role, permissions: current.permissions || [] };

      await requirePrisma().user.delete({ where: { username: targetUsername } });

      // Log deletion to Audit Trail
      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "DELETE_USER",
        severity: "Critical",
        description: `حساب کاربری پرسنل با نام کاربری ${targetUsername} توسط ${req.user.name} به طور کامل از سامانه حذف گردید.`,
        entityType: "User",
        entityId: targetUsername,
        entityName: current.name,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange,
        beforeData,
        afterData: null
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/users/:username/role", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const targetUsername = req.params.username.toLowerCase();
      const current = await getUserByUsername(targetUsername);
      if (!current) {
        return res.status(404).json({ error: "کاربر یافت نشد" });
      }

      const { role, reasonForChange } = req.body;
      if (!role) {
        return res.status(400).json({ error: "فیلد role الزامی است" });
      }
      if (!ALLOWED_USER_ROLES.includes(role)) {
        return res.status(400).json({
          error: `سمت سازمانی نامعتبر است. مقادیر مجاز: ${ALLOWED_USER_ROLES.join("، ")}`,
        });
      }

      const unsafeRole = await checkAdminSafety(req.user, targetUsername, { role });
      if (unsafeRole) return res.status(400).json({ error: unsafeRole });

      const oldRole = current.role;
      const oldPermissions = sanitizePermissions(current.permissions);
      const roleChanged = role !== oldRole;
      current.role = role;
      // The same rule PATCH follows: a new role starts from its own template,
      // so the previous job's exceptions do not follow the person. This route
      // used to keep them, which meant the two ways of changing a role left the
      // account in different states.
      if (roleChanged) current.permissions = [];
      await requirePrisma().user.update({
        where: { username: targetUsername },
        data: {
          role: role as any,
          ...(roleChanged ? { permissions: [] } : {}),
        },
      });

      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "ROLE_CHANGE",
        severity: "Critical",
        description: `تغییر سمت سازمانی کاربر ${targetUsername} از ${oldRole} به ${role} توسط ${req.user.name}`,
        entityType: "User",
        entityId: targetUsername,
        entityName: current.name,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange || "ارتقای سطح دسترسی سازمانی",
        beforeData: { role: oldRole, permissions: oldPermissions },
        afterData: { role, permissions: current.permissions ?? [] }
      });

      res.json({ success: true, role, permissionsReset: roleChanged && oldPermissions.length > 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // An admin sets a temporary password for someone who is locked out. The
  // account is flagged to change it on the next sign-in, so the admin never
  // ends up knowing a password the user keeps using.
  app.post("/api/users/:username/reset-password", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const targetUsername = req.params.username.toLowerCase();
      const current = await getUserByUsername(targetUsername);
      if (!current) {
        return res.status(404).json({ error: "کاربر یافت نشد" });
      }

      const { newPassword, reasonForChange } = req.body;
      if (!newPassword || String(newPassword).length < 6) {
        return res.status(400).json({ error: "کلمه عبور موقت باید حداقل ۶ کاراکتر باشد." });
      }
      if (newPassword === "123" || newPassword === "123456") {
        return res.status(400).json({ error: "کلمه عبور موقت نمی‌تواند رمز پیش‌فرض باشد." });
      }

      const newSalt = generateSalt();
      await requirePrisma().user.update({
        where: { username: targetUsername },
        data: {
          passwordHash: hashPassword(newPassword, newSalt),
          passwordSalt: newSalt,
          mustChangePassword: true,
        },
      });

      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "RESET_PASSWORD",
        severity: "Critical",
        description: `کلمه عبور حساب کاربری ${targetUsername} توسط ${req.user.name} بازنشانی شد و تغییر آن در ورود بعدی الزامی گردید.`,
        entityType: "User",
        entityId: targetUsername,
        entityName: current.name,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange || "بازنشانی کلمه عبور به درخواست کاربر",
        // The password itself is never recorded — only the fact of the reset.
        beforeData: { mustChangePassword: current.mustChangePassword !== false },
        afterData: { mustChangePassword: true, passwordReset: true }
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("Failed to reset password:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/users/:username/permissions", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const targetUsername = req.params.username.toLowerCase();
      const current = await getUserByUsername(targetUsername);
      if (!current) {
        return res.status(404).json({ error: "کاربر یافت نشد" });
      }

      const { permissions, reasonForChange } = req.body;
      if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: "فیلد permissions باید یک آرایه باشد." });
      }

      // Unknown names are dropped rather than stored, so a typo cannot end up
      // as a permission nobody can see in the dialog but that sits in the row.
      const cleaned = sanitizePermissions(permissions);

      // Same lockout class as role changes: nobody may strip the last account
      // that can still administer users, and nobody may strip their own.
      const unsafe = await checkPermissionSafety(req.user, targetUsername, cleaned);
      if (unsafe) return res.status(400).json({ error: unsafe });

      const oldPermissions = sanitizePermissions(current.permissions);
      current.permissions = cleaned;
      await requirePrisma().user.update({
        where: { username: targetUsername },
        data: { permissions: cleaned },
      });

      const now = new Date();
      const auditId = `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await AuditService.createAuditRecord({
        auditId,
        correlationId: crypto.randomUUID(),
        userId: req.user.username,
        userName: req.user.name,
        role: req.user.role,
        module: "مدیریت کاربران",
        action: "PERMISSION_CHANGE",
        severity: "Critical",
        description: `بروزرسانی مجوزهای دسترسی کاربر ${targetUsername} توسط مدیر سیستم`,
        entityType: "User",
        entityId: targetUsername,
        entityName: current.name,
        eventType: "Authorization",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        reasonForChange: reasonForChange || "تغییر اختیارات فرآیندی در ماژول‌های سامانه",
        beforeData: { permissions: oldPermissions },
        afterData: { permissions: cleaned }
      });

      res.json({ success: true, permissions: cleaned });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // --- Material Master Endpoints ---
  // ==========================================

  app.get("/api/materials", requireAuth, requirePermission("material.read"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const list = await prisma.material.findMany({ orderBy: { createdAt: "desc" } });
      res.json(list.map(mapMaterialToClient));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/materials", requireAuth, requirePermission("material.create"), async (req: any, res) => {
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

  app.patch("/api/materials/:id", requireAuth, requirePermission("material.edit"), async (req: any, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/materials/:id", requireAuth, requirePermission("material.delete"), async (req: any, res) => {
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
      res.status(500).json({ error: err.message });
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

  app.put("/api/materials/:id/specification", requireAuth, requirePermission("material.edit"), async (req: any, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/materials/:id/specification/file", requireAuth, requirePermission("material.read"), async (req: any, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/materials/:id/specification", requireAuth, requirePermission("material.edit"), async (req: any, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/materials/:id/status", requireAuth, requirePermission("material.edit"), async (req: any, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // --- Business Partner Endpoints ---
  // ==========================================

  app.get("/api/business-partners", requireAuth, requirePermission("partner.read"), async (req: any, res) => {
    try {
      const list = await getBusinessPartnersList();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SOP evaluation history for a supplier, reconstructed from the audit trail
  // (each partner change records the full partner, incl. its evaluation, in
  // afterData). Returns only points where an evaluation with a score exists.
  app.get("/api/business-partners/:id/evaluation-history", requireAuth, requirePermission("partner.read"), async (req: any, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  // Fetch a single SOP document's stored file on demand (kept out of the list
  // payload so the repository stays lightweight).
  app.get("/api/business-partners/:id/documents/:key/file", requireAuth, requirePermission("partner.read"), async (req: any, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/business-partners", requireAuth, requirePermission("partner.create"), async (req: any, res) => {
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
        correlationId: crypto.randomUUID(),
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

  app.put("/api/business-partners/:id", requireAuth, requirePermission("partner.edit"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const { id } = req.params;
      const existing = await prisma.businessPartner.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "شریک تجاری یافت نشد" });
      }
      const [before] = (await getBusinessPartnersList()).filter(p => p.id === id);
      await upsertBusinessPartner(prisma, { ...req.body, id });
      const [saved] = (await getBusinessPartnersList()).filter(p => p.id === id);

      await AuditService.createAuditRecord({
        auditId: `AUD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        correlationId: crypto.randomUUID(),
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
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/business-partners/:id", requireAuth, requirePermission("partner.delete"), async (req: any, res) => {
    try {
      const prisma = requirePrisma();
      const { id } = req.params;
      const existing = await prisma.businessPartner.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "شریک تجاری یافت نشد" });
      }

      const auditBase = {
        correlationId: crypto.randomUUID(),
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
      let blockedReason: string | null = null;
      if (existing.type === "Manufacturer") {
        const vendorRefs = await prisma.vendor.count({ where: { manufacturerId: id } });
        if (vendorRefs > 0) {
          blockedReason = "امکان حذف این تولیدکننده وجود ندارد. به یک یا چند Source اختصاص داده شده است.";
        }
      } else if (existing.type === "Supplier") {
        const vendorRefs = await prisma.vendor.count({ where: { OR: [{ supplierId: id }, { id }] } });
        if (vendorRefs > 0) {
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
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

const appPromise = startServer();

if (!process.env.VERCEL) {
  appPromise.then(app => {
    const PORT = 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  });
}

export default async function handler(req: express.Request, res: express.Response) {
  const app = await appPromise;
  return app(req, res);
}
