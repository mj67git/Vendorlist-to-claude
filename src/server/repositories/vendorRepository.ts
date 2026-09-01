import type { PrismaClient } from "@prisma/client";
import { AuditService } from "../../utils/auditService.js";
import { calculateGradeAndStatus } from "../../utils/sopEvaluation.js";
import { resolvePartnerLink, stripPartnerMarker } from "../domain/partnerLink.js";
import { parseDateSafely } from "../db/coerce.js";
import { requirePrisma } from "../db/prisma.js";
import { generateMaterialId } from "../domain/materialId.js";
import {
  CALCULATION_WEIGHTS,
  calculateRoundedWeightedScore,
  rankVendor,
} from "../domain/vendorEvaluation.js";

/**
 * Everything that reads or writes a source.
 *
 * A "source" is one company offering one material — the central aggregate of
 * this system — and it lives across six tables. These functions are the only
 * place that knows how to assemble one from those tables and take one apart
 * again, which is why they belong together and away from the routing.
 *
 * Moved out of server.ts unchanged. One thing to keep in view while reading:
 * every write here is a read-modify-write of the whole aggregate, so the
 * ordering rules — `lockVendorWrite` and the `expectedUpdatedAt` precondition
 * in `saveVendorToDb` — are load-bearing, not decoration.
 */

export function getVendorRank(vendorId: string, allVendors: any[]): number {
  return rankVendor(vendorId, allVendors, CALCULATION_WEIGHTS);
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

export function toDbDecision(d: any): "Pass" | "Reject" | "ApprovedConditional" {
  return DECISION_TO_DB[d] ?? "Pass";
}
export function fromDbDecision(d: any): string {
  return DECISION_FROM_DB[d] ?? "Pass";
}
export function toDbDeviation(r: any): any {
  return DEVIATION_VALUES.includes(r) ? r : "None";
}
export function toDbRiskLevel(l: any): any {
  return RISK_LEVELS.includes(l) ? l : "Low";
}

// Persist a vendor's risk assessment (single row per vendor), analysis records
// and activity logs into their normalized tables. Each collection is fully
// replaced from the passed data so the read-modify-write endpoints stay
// consistent. A field left undefined is not touched (partial saves).
export async function persistVendorRelations(prisma: PrismaClient, id: string, v: any): Promise<void> {
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
export async function getVendorsList(vendorId?: string): Promise<any[]> {
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

      // The column wins; the marker inside contact_info is only a fallback for
      // rows written before the link had columns (see domain/partnerLink).
      const { contactInfo, manufacturerId, supplierId } = resolvePartnerLink(
        { manufacturerId: (v as any).manufacturerId, supplierId: (v as any).supplierId },
        v.contactInfo,
      );

      result.push({
        id: v.id,
        name: v.name,
        nameEn: v.nameEn,
        country: v.country,
        contactInfo: contactInfo,
        manufacturerId,
        supplierId,
        registrationDate: v.registrationDate || "",
        // Carried so a handler can hand it back as the precondition for its
        // write; the client never needs to look at it.
        updatedAt: (v as any).updatedAt ?? null,
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
export async function getRankingSnapshot(): Promise<any[]> {
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

export async function getVendorById(id: string): Promise<any> {
  const list = await getVendorsList(id);
  return list[0] || null;
}

/**
 * Serialise the mutating requests that touch one source.
 *
 * Every `PATCH /api/vendors/:id/*` route reads the whole vendor, changes one
 * part of it and writes the whole thing back. Two of them in flight at once —
 * two users, two tabs, or a retry arriving beside the original — both read the
 * same starting state and the slower write puts back its own stale copy of
 * everything the faster one had just changed. Verified before this existed: a
 * contact update racing a score update lost the contact change 5 times out of
 * 5, silently, with both requests answering 200.
 *
 * The client already queues its own writes (see the sync queue in App.tsx), but
 * that only orders one browser tab against itself. This is the server-side half:
 * requests for the same source id run one after another, requests for different
 * sources still run in parallel.
 *
 * Scope worth knowing: this is an in-process lock, so it covers one Node
 * process — the way this application is deployed (a single container, or PM2 in
 * fork mode). Running several instances behind a load balancer would need a
 * database-level lock instead, because each process would hold its own map.
 */
const vendorWriteChain = new Map<string, Promise<void>>();

export function lockVendorWrite(id: string): Promise<() => void> {
  const previous = vendorWriteChain.get(id) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>(resolve => {
    release = () => {
      // Only clear the map when nobody queued behind us, so a later waiter does
      // not find a deleted chain and start in parallel with the one after it.
      if (vendorWriteChain.get(id) === mine) vendorWriteChain.delete(id);
      resolve();
    };
  });
  vendorWriteChain.set(id, previous.then(() => mine));
  return previous.then(() => release);
}

/** Express middleware form: holds the lock until the response is done. */
export async function serializeVendorWrites(req: any, res: any, next: any) {
  const id = req.params?.id;
  if (!id) return next();

  const release = await lockVendorWrite(id);
  let released = false;
  const done = () => {
    if (released) return;
    released = true;
    release();
  };
  // 'close' covers a client that disconnects mid-request, which 'finish' does
  // not — without it an aborted request would hold the lock for ever.
  res.once("finish", done);
  res.once("close", done);
  next();
}

/**
 * Another writer changed this source between the read and the write.
 *
 * The endpoints all do a read-modify-write, so two overlapping requests make
 * the slower one write back its stale copy — which is how a deleted laboratory
 * result used to come back after a reload. The per-vendor in-process lock stops
 * that inside one Node process; this is what stops it when there is more than
 * one, which the serverless deployment always has and a second container would.
 */
export class VendorConflictError extends Error {
  constructor() {
    super('این رکورد هم‌زمان توسط شخص دیگری تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.');
    this.name = 'VendorConflictError';
  }
}

export async function saveVendorToDb(
  v: any,
  /**
   * The `updatedAt` the caller read before it started modifying. When given,
   * the write only lands if the row still carries that value; otherwise it is
   * refused rather than silently overwriting the other writer's work. Callers
   * that legitimately write without a prior read (the create path) omit it.
   */
  expectedUpdatedAt?: Date | null,
): Promise<boolean> {
  const prisma = requirePrisma();
  {
    const {
      id, name, nameEn, country, contactInfo, registrationDate, status, grade,
      material, materialEn, cas, irc, isSample, category,
      scores, rawScores, rejectionReasons,
      activityLogs, analysisRecords, riskAssessment,
      manufacturerId, supplierId
    } = v;

    /*
     * The partner link goes in its own columns.
     *
     * It used to be smuggled into `contact_info` as a `__BP_METAUI__:mfg:sup`
     * marker while `manufacturer_id` and `supplier_id` — which exist, and are
     * indexed — were never written at all. That produced three failures:
     *
     *   1. Reading prefers the column and falls back to the marker, so once a
     *      column held anything, later changes to the link were invisible: the
     *      write updated the marker and the read kept returning the stale
     *      column. A source could show one company's name and stay linked to
     *      another.
     *   2. `DELETE /api/business-partners/:id` counts dependants with
     *      `where: { supplierId: id }`. Against an always-NULL column that
     *      count is always zero, so a partner in active use could be deleted
     *      with the guard reporting nothing depends on it.
     *   3. The marker sat inside a field the user edits by hand, so editing the
     *      contact details could corrupt or drop the link.
     *
     * Old rows are migrated by 20260901120000_vendor_partner_columns; the read
     * path keeps its marker fallback for anything that migration missed.
     */
    const serializedContactInfo = stripPartnerMarker(contactInfo);
    const manufacturerLink = manufacturerId || null;
    const supplierLink = supplierId || null;

    // risk assessment & analysis records are now stored in normalized tables
    // (see persistVendorRelations), not in the legacy vendor Text columns.
    const scoreText = scores ? JSON.stringify(scores) : null;
    const rawScoreText = rawScores ? JSON.stringify(rawScores) : null;
    const rejectText = rejectionReasons ? JSON.stringify(rejectionReasons) : null;

    const scoreObj = scores || { commercial: 0, qa: 0, planning: 0, finance: 0 };
    const roundedTotal = calculateRoundedWeightedScore(scoreObj, CALCULATION_WEIGHTS);

    if (expectedUpdatedAt) {
      // updateMany takes a non-unique filter, so the timestamp can be part of
      // the WHERE. A count of zero means the row moved under us — or vanished —
      // and either way this write must not land.
      const claimed = await prisma.vendor.updateMany({
        where: { id, updatedAt: expectedUpdatedAt },
        data: { updatedAt: new Date() },
      });
      if (claimed.count === 0) throw new VendorConflictError();
    }

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
        manufacturerId: manufacturerLink,
        supplierId: supplierLink,
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
        manufacturerId: manufacturerLink,
        supplierId: supplierLink,
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

export async function deleteVendorFromDb(id: string): Promise<boolean> {
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



// Default users provisioned into PostgreSQL on first startup (empty users table).
