import type { PrismaClient } from "@prisma/client";
import { AuditService } from "../../utils/auditService.js";
import { findDuplicateMaterial, type MaterialKeyFields } from "../../utils/materialDuplicates.js";
import { requirePrisma } from "../db/prisma.js";
import { generateMaterialId } from "../domain/materialId.js";

/**
 * Turning a material row into what the client expects, and a request body into
 * a row.
 *
 * `mapMaterialToClient` is the reason the specification blob never rides along
 * with a list: it reports `hasSpecificationFile` and leaves the base64 where it
 * is. `rejectDuplicateMaterial` is the guard that stops the catalogue forking
 * into two entries for one substance — and it audits the refusal, because a
 * blocked write is evidence too.
 */

/**
 * `hasFile` overrides the row when given, so a caller that deliberately did not
 * select the blob can still answer the question honestly.
 */
export function mapMaterialToClient(m: any, hasFile?: boolean) {
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
    hasSpecificationFile: hasFile ?? !!m.specificationFileData,
    specificationUploadedAt: m.specificationUploadedAt
      ? (m.specificationUploadedAt.toISOString?.() || m.specificationUploadedAt)
      : undefined,
    createdAt: m.createdAt ? (m.createdAt.toISOString?.() || m.createdAt) : new Date().toISOString(),
    // Carried to the client so a save can claim the copy it edited; the server
    // refuses with 409 when the row has moved on (http/recordLock.ts).
    updatedAt: m.updatedAt ? (m.updatedAt.toISOString?.() || m.updatedAt) : undefined,
  };
}

/** Read a field as text whatever the client sent, so a number or an object in
 *  `nameFa` becomes a validation failure rather than "…trim is not a function"
 *  thrown deep in the handler and served as a 500. */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';   // arrays and objects are not names
}

export function materialDataFromBody(b: any) {
  const body = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  return {
    name: asText(body.nameFa ?? body.name),
    nameEn: asText(body.nameEn),
    cas: asText(body.cas) || 'N/A',
    irc: asText(body.irc) || 'N/A',
    iupac: asText(body.iupac) || null,
    role: asText(body.role) || null,
    finalProduct: asText(body.finalProduct) || null,
    finalProductEn: asText(body.finalProductEn) || null,
    pharmacopoeia: asText(body.pharmacopoeia) || null,
    standardNameFa: asText(body.standardNameFa) || null,
    standardNameEn: asText(body.standardNameEn) || null,
    specificationFile: asText(body.specificationFile) || null,
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
export async function rejectDuplicateMaterial(
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

/**
 * Every material field except the specification blob.
 *
 * The list endpoint used to select whole rows, so every stored specification
 * PDF was read out of the database and carried into Node on every load of the
 * materials page — for a payload that has never included one (project rule 5).
 * Postgres keeps oversized text out of the row already and does not touch it
 * unless it is named, so leaving it out of the SELECT is the entire fix.
 *
 * The single-record handlers still read whole rows. That is one blob for the
 * one material being worked on, which is bounded; this is about the list, where
 * the cost multiplies by the size of the catalogue.
 */
const MATERIAL_FIELDS = {
  id: true, name: true, nameEn: true, cas: true, irc: true, iupac: true,
  role: true, finalProduct: true, finalProductEn: true, pharmacopoeia: true,
  standardNameFa: true, standardNameEn: true, specificationFile: true,
  specificationFileSize: true, specificationUploadedAt: true, createdAt: true,
  // Read on every list because a save claims it back (http/recordLock.ts).
  updatedAt: true,
} as const;

export async function listMaterials(): Promise<any[]> {
  const prisma = requirePrisma();
  const rows = await prisma.material.findMany({
    orderBy: { createdAt: "desc" },
    select: MATERIAL_FIELDS,
  });
  // Which of them has a file, asked without reading one.
  const withFile = new Set(
    (await prisma.material.findMany({
      where: { NOT: { specificationFileData: null } },
      select: { id: true },
    })).map(r => r.id),
  );
  return rows.map(m => mapMaterialToClient(m, withFile.has(m.id)));
}
