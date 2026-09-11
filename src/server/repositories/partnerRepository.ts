import type { PrismaClient } from "@prisma/client";
import { parseDateSafely } from "../db/coerce.js";
import { requirePrisma } from "../db/prisma.js";
import { INITIAL_BUSINESS_PARTNERS_DB } from "../../db_business_partners.js";
import { calculateDocScore, computeSupplierEvaluation } from "../../utils/sopEvaluation.js";

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
/**
 * `withFile` names the documents that have a stored file. It is passed in
 * rather than read off the row, because the row deliberately no longer carries
 * the blob that would answer the question.
 */
export function mapPartnerRow(row: any, withFile?: Set<string>): any {
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
        hasFile: withFile ? withFile.has(doc.id) : !!doc.fileDataUrl,
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

  // The evaluation and its documents are updated in place rather than deleted
  // and recreated.
  //
  // Recreating them meant every stored SOP file had to be read out of the
  // database, carried through this function and written back, on every edit of
  // any field of the partner — a name correction moved every PDF the supplier
  // had ever uploaded. Updating in place means a document whose file did not
  // change is never told about its file at all, so the blob stays where it is.
  if (p.type !== "Supplier" || !p.evaluation) {
    await prisma.supplierEvaluation.deleteMany({ where: { partnerId: p.id } });
    return;
  }

  const ev = p.evaluation;

  // The score, the grade and the status are computed from the documents, so
  // they are computed here rather than believed from the payload.
  //
  // They used to be stored exactly as sent, which made three numbers a caller
  // could simply assert: a direct request could submit approved documents and
  // store grade `D`, or the reverse. The attachment gate is safe either way
  // because it recalculates (rule 13), but the stored column disagreed with its
  // own documents until some client happened to load the record and reconcile
  // it. Same rubric, same function as the browser uses.
  const derived = computeSupplierEvaluation(ev.documents || {});
  const scored = {
    totalScore: derived.totalScore,
    grade: derived.grade,
    status: derived.status,
    updatedBy: ev.updatedBy || null,
  };

  const evaluation = await prisma.supplierEvaluation.upsert({
    where: { partnerId: p.id },
    update: scored,
    create: { partnerId: p.id, ...scored },
  });

  const docs = (ev.documents ? Object.values(ev.documents) : []) as any[];

  // A document the payload no longer mentions has been removed.
  //
  // `key` is an enum, so a payload carrying a key that is not one refuses here,
  // before anything is written. The previous shape deleted every document
  // first and only then discovered the bad key, which left the supplier with
  // no documents at all.
  await prisma.sopDocument.deleteMany({
    where: { evaluationId: evaluation.id, key: { notIn: docs.map(d => d.key) as any } },
  });

  for (const doc of docs) {
    const common = {
      nameFa: doc.nameFa || "",
      nameEn: doc.nameEn || "",
      status: toDbSopStatus(doc.status),
      // Per-document score, from the same rubric as the total above: it is a
      // function of the document's status, never a number the caller states.
      score: calculateDocScore(doc.status ?? null),
      uploadedAt: doc.uploadedAt ? parseDateSafely(doc.uploadedAt) : null,
    };

    // Three cases, and only the first two touch the file.
    //   a fresh blob      → store it
    //   no fileName       → the user removed the file, so clear it
    //   fileName, no blob → an unchanged reference; say nothing about the file
    const fileFields = doc.fileDataUrl
      ? { fileName: doc.fileName || null, fileSize: doc.fileSize ?? null, fileDataUrl: doc.fileDataUrl }
      : !doc.fileName
        ? { fileName: null, fileSize: null, fileDataUrl: null }
        : {};

    await prisma.sopDocument.upsert({
      where: { evaluationId_key: { evaluationId: evaluation.id, key: doc.key } },
      update: { ...common, ...fileFields },
      // On create there is no stored file to preserve, so an unchanged
      // reference has nothing behind it and the name is all there is.
      create: {
        evaluationId: evaluation.id,
        key: doc.key,
        ...common,
        fileName: doc.fileName || null,
        fileSize: doc.fileSize ?? null,
        fileDataUrl: doc.fileDataUrl || null,
      },
    });
  }
}

/**
 * Every SOP document field except the file itself.
 *
 * `include: { documents: true }` selects every column, and one of those columns
 * is the base64 of the uploaded PDF. Listing the partners therefore read every
 * stored SOP file out of the database and carried it into Node — to compute a
 * boolean saying a file exists. Postgres already keeps oversized text out of
 * the row (TOAST) and never touches it unless it is selected, so naming the
 * columns is the whole fix; there is nothing to move to another table.
 */
const DOCUMENT_FIELDS = {
  id: true, key: true, nameFa: true, nameEn: true, status: true,
  score: true, fileName: true, fileSize: true, uploadedAt: true,
} as const;

/** Which of those documents actually has a file, asked without reading one. */
async function documentIdsWithFile(prisma: any, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.sopDocument.findMany({
    where: { id: { in: ids }, NOT: { fileDataUrl: null } },
    select: { id: true },
  });
  return new Set(rows.map((r: any) => r.id));
}

export async function getBusinessPartnersList(): Promise<any[]> {
  const prisma = requirePrisma();
  const rows = await prisma.businessPartner.findMany({
    orderBy: { createdAt: "desc" },
    include: { evaluation: { include: { documents: { select: DOCUMENT_FIELDS } } } },
  });
  const docIds = rows.flatMap(r => (r.evaluation?.documents || []).map((d: any) => d.id));
  const withFile = await documentIdsWithFile(prisma, docIds);
  return rows.map(row => mapPartnerRow(row, withFile));
}

/**
 * Refuse a source whose IRC is not the 16-digit IFDA code.
 *
 * The form enforces this too, but that gate is cosmetic (project rule 14).
 * Empty is allowed — not every source has a licence on file yet — and a value
 * that is unchanged from what is already stored is left alone, so records
 * predating the rule (they carry placeholders like "N/A") stay editable.
 */

/**
 * Seven sample partners, for a demonstration database only.
 *
 * This used to run on every empty database, which meant a brand-new production
 * installation came up already holding BASF, Lonza and five other real company
 * names that nobody at the site had entered — and, worse, that a
 * `./deploy/reset-data.sh --all` put straight back on the next restart, so the
 * reset looked like it had failed. A delivered system starts empty and is
 * filled by the people who own the data.
 *
 * Set `VLSE_SEED_DEMO_DATA=true` to get them back for a demo or a test bed.
 */
export async function seedDefaultBusinessPartners() {
  if (process.env.VLSE_SEED_DEMO_DATA !== "true") return;
  const prisma = requirePrisma();
  const count = await prisma.businessPartner.count();
  if (count > 0) return;
  console.log("[BusinessPartners] Seeding demo partners (VLSE_SEED_DEMO_DATA=true)...");
  for (const p of INITIAL_BUSINESS_PARTNERS_DB) {
    await upsertBusinessPartner(prisma, p);
  }
}
