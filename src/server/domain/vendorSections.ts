import { diffFields, recordEvent } from "../../utils/auditEvents.js";
import {
  vendorAnalysisSchema, vendorContactSchema, vendorLogsSchema,
  vendorProfileSchema, vendorRiskSchema, vendorScoreSchema,
} from "../../utils/validation.js";
import { can, forbiddenRawScoreChanges, forbiddenScoreChanges } from "../../utils/permissions.js";
import {
  forbiddenSampleScoring, forbiddenVerdictChange, VERDICT_FIELDS,
} from "../../utils/decisionGuards.js";
import { getUserByUsername } from "../repositories/userRepository.js";
import { ircViolation, sopPartnerViolation } from "./sourceRules.js";
import { CALCULATION_WEIGHTS, calculateWeightedScore } from "./vendorEvaluation.js";

/**
 * What each part of a source save means, in one place.
 *
 * A source is edited in six separable parts — the profile, the contact block,
 * the departmental scores, the laboratory results, the activity log and the
 * risk assessment — and each part carries its own validation, its own
 * permission question and its own audit vocabulary. Those rules used to live
 * inside the six `PATCH` handlers that serve them, which was fine while a
 * handler was the only way to reach a part.
 *
 * It stopped being fine when the single transactional `PUT` arrived: a save
 * that touches three parts has to ask the same three questions the three
 * handlers would have asked, and a second copy of a rule like «who may state a
 * verdict» is a copy that will drift (rules 11d and 14 both exist because
 * exactly that happened elsewhere in this system). So the rules moved here and
 * both callers read them from one place.
 *
 * Nothing about the rules themselves changed in the move. Each function
 * validates with the same schema, refuses with the same status and the same
 * Persian message, merges the same fields, and describes the same audit rows.
 *
 * Shape of the contract:
 *  - the caller passes the record as stored (`current`) and the object it has
 *    accumulated so far (`base`), so several parts compose into one save;
 *  - a refusal is returned rather than written to the response, because in the
 *    unified endpoint the *first* refusal must abandon the whole save — nothing
 *    may be written, not even the parts that were allowed;
 *  - the audit is returned as a function rather than performed, because every
 *    row is written from the record re-read after the save, and in a unified
 *    save that read happens once, at the end.
 */

export interface AppliedSection {
  ok: true;
  /** The record as it stands after this part has been merged in. */
  merged: any;
  /** Called with the re-read record once the save has landed. */
  audit: (result: any) => Promise<void>;
}

export interface SectionRefusal {
  ok: false;
  status: number;
  body: any;
}

export type SectionOutcome = AppliedSection | SectionRefusal;

/**
 * A written type guard rather than `if (!outcome.ok)`.
 *
 * This project compiles without `strict`, and with `strictNullChecks` off the
 * compiler will not narrow a union on a boolean discriminant — so the refusal
 * branch would read `outcome.status` off the success type and fail to build.
 */
export function isRefusal(outcome: SectionOutcome): outcome is SectionRefusal {
  return outcome.ok === false;
}

const refuse = (status: number, body: any): SectionRefusal => ({ ok: false, status, body });

const invalid = (issues: unknown): SectionRefusal =>
  refuse(400, { error: "Validation failed", details: issues });

/** Samples are named by their material on the trail; sources by their company. */
function isSampleRecord(...records: any[]): boolean {
  return records.some(r => !!(r?.isSample || r?.category === "sample"));
}

function entityNameOf(current: any, result: any): string {
  return isSampleRecord(current, result) ? (result.material || result.name) : result.name;
}

/**
 * Which event a source save actually is.
 *
 * `PATCH /profile`, the unified `PUT` and `POST /vendors` all replace the whole
 * record, so a disqualification and a change of phone number arrive through the
 * same door — the same reason the permission guard has to compare the payload
 * with what is stored (rule 14). Reading the verdict off the saved record keeps
 * the trail saying «رد صلاحیت» where a person would say it, instead of filing it
 * as one more edit. Returns null for an ordinary edit.
 */
export function verdictEvent(before: any, after: any): "source.disqualified" | "source.reinstated" | null {
  const rejected = (v: any) => v?.status === "rejected" || v?.grade === "rejected" || v?.grade === "black list";
  if (rejected(after) && !rejected(before)) return "source.disqualified";
  if (!rejected(after) && rejected(before)) return "source.reinstated";
  return null;
}

/** The FMEA parameters worth naming, under the names the risk history reads. */
export function riskChanges(before: any, after: any) {
  const flatten = (r: any) => r && {
    rpn: r.riskScore ?? r.rpn,
    sri: r.sri,
    riskLevel: r.riskLevel,
    severity: r.materialCriticality ?? r.severity,
    occurrence: r.probability ?? r.occurrence,
    detectability: r.detectability ?? r.detection,
  };
  return diffFields(flatten(before), flatten(after), [
    "rpn", "sri", "riskLevel", "severity", "occurrence", "detectability",
  ]);
}

/**
 * The assessment as it now stands.
 *
 * Repeated alongside the changes because the risk history plots a point per
 * row, and a save that moved only the risk level would otherwise leave the
 * chart without an RPN to draw.
 */
export function riskFacts(risk: any) {
  return {
    riskLevel: risk?.riskLevel ?? null,
    riskScore: risk?.riskScore ?? risk?.rpn ?? null,
    sri: risk?.sri ?? null,
    materialCriticality: risk?.materialCriticality ?? risk?.severity ?? null,
    probability: risk?.probability ?? risk?.occurrence ?? null,
    detectability: risk?.detectability ?? risk?.detection ?? null,
  };
}

/**
 * Refuse a payload that decides something the caller may not decide.
 *
 * `vendor.edit` and `vendor.analysis` open writes that replace the whole
 * record, so the qualification verdict rides along inside an ordinary edit.
 * This compares it against what is stored, refuses with 403 when the caller is
 * not entitled to the change, and records the attempt — a blocked write is
 * evidence too, the same reasoning as the IRC and SOP refusals.
 *
 * Returns null when there is nothing to refuse.
 */
export async function unauthorisedVerdict(
  req: any, current: any, incoming: any,
  options: { requireEditForTheRest?: boolean } = {},
): Promise<SectionRefusal | null> {
  // The stored user record, not the token: a seven-day JWT carries only the
  // role, so a permission taken away today would otherwise keep working until
  // it expired (rule 14).
  const actor = await getUserByUsername(req.user?.username || "");
  if (!actor || actor.isActive === false) {
    return refuse(401, { error: "این حساب کاربری دیگر معتبر نیست." });
  }
  // The other half of the same question: this write also accepts ordinary
  // edits, and the middleware could only ask whether the caller may do *one* of
  // the two. Whoever holds the verdict but not `vendor.edit` may state the
  // verdict and nothing else.
  if (options.requireEditForTheRest && !can(actor as any, "vendor.edit")) {
    // An empty field and an absent one are the same fact here: the form posts
    // `''` where the record holds null, and treating that as an edit would
    // refuse every verdict that arrives through the whole-record form.
    const settled = (value: any) => JSON.stringify(value === '' || value === undefined ? null : value);
    const otherChanges = Object.keys(incoming || {}).filter(key => {
      if (VERDICT_FIELDS.includes(key as any) || key === 'reasonForChange' || key === 'reason') return false;
      if (key === 'expectedUpdatedAt') return false;
      return settled(incoming[key]) !== settled(current?.[key]);
    });
    if (otherChanges.length > 0) {
      return refuse(403, {
        error: `عدم دسترسی: ویرایش سورس نیازمند مجوز «ویرایش سورس» است (تلاش برای تغییر: ${otherChanges.join('، ')}).`,
      });
    }
  }

  const refusal = forbiddenVerdictChange(actor as any, current, incoming);
  if (!refusal) return null;

  const isSample = refusal.permission === 'sample.decide';
  const what = isSample ? "تصمیم کیفی نمونه" : "رد صلاحیت یا بازگردانی سورس";
  recordEvent(req, {
    event: "access.denied",
    entity: {
      type: isSample ? "Sample" : "Source",
      id: current.id,
      name: current.material || current.name || "سورس",
    },
    facts: { attempted: what, permission: refusal.permission, fields: refusal.fields.join("، ") },
  });

  return refuse(403, {
    error: `عدم دسترسی: ${what} نیازمند مجوز جداگانه است و این حساب آن را ندارد.`,
  });
}

// --- The six parts ---------------------------------------------------------

export async function applyProfileSection(
  req: any, current: any, base: any, payload: any, reason: string | null,
): Promise<SectionOutcome> {
  const parsed = vendorProfileSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error.issues);
  const p = parsed.data;
  const id = current.id;

  const verdict = await unauthorisedVerdict(req, current, p, { requireEditForTheRest: true });
  if (verdict) return verdict;

  const merged = { ...base, ...p };

  const ircError = ircViolation((p as any).irc, (current as any).irc);
  if (ircError) {
    // Recorded, like the SOP refusal below it. A blocked write is evidence too
    // — it says someone tried to put an invalid licence number on a regulated
    // record — and auditing one refusal but not the other made the trail
    // inconsistent about what counts as an event.
    recordEvent(req, {
      event: "access.denied",
      entity: { type: "Source", id, name: current.material || current.name || "سورس" },
      facts: { attempted: "ثبت کد IRC نامعتبر" },
      reason: ircError,
    });
    return refuse(422, { error: ircError });
  }

  const sopError = await sopPartnerViolation(merged as any, current as any);
  if (sopError) {
    recordEvent(req, {
      event: "access.denied",
      entity: { type: "Source", id, name: current.material || current.name || "سورس" },
      facts: {
        attempted: "اتصال فروشندهٔ فاقد گرید A به سورس",
        supplierId: (merged as any).supplierId,
      },
      reason: sopError,
    });
    return refuse(422, { error: sopError });
  }

  return {
    ok: true,
    merged,
    audit: async (result: any) => {
      const entityType = isSampleRecord(current, result) ? "Source" : "Supplier";
      const entityName = entityNameOf(current, result);

      const beforeData: Record<string, any> = {};
      const afterData: Record<string, any> = {};
      let hasChanges = false;

      Object.keys(p).forEach(key => {
        const oldVal = current[key];
        const newVal = result[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          beforeData[key] = oldVal ?? null;
          afterData[key] = newVal ?? null;
          hasChanges = true;
        }
      });

      if (hasChanges) {
        // A qualification verdict travels inside an ordinary profile save, so
        // which event this is depends on what moved — the same comparison the
        // permission guard makes (rule 14).
        await recordEvent(req, {
          event: verdictEvent(current, result) || "source.updated",
          entity: { type: entityType, id, name: entityName },
          changes: diffFields(beforeData, afterData, Object.keys(afterData)),
          reason: reason || null,
        });
      }
    },
  };
}

export async function applyContactSection(
  req: any, current: any, base: any, payload: any, reason: string | null,
): Promise<SectionOutcome> {
  const parsed = vendorContactSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error.issues);
  const c = parsed.data;
  const id = current.id;

  const merged = {
    ...base,
    contactInfo: c.contactInfo ?? base.contactInfo,
    lastAudit: c.lastAudit ?? base.lastAudit,
    ircExpiryDate: c.ircExpiryDate ?? base.ircExpiryDate,
  };

  return {
    ok: true,
    merged,
    audit: async (result: any) => {
      const entityType = isSampleRecord(current, result) ? "Source" : "Supplier";
      const entityName = entityNameOf(current, result);

      const beforeData: Record<string, any> = {};
      const afterData: Record<string, any> = {};
      let hasChanges = false;

      for (const field of ["contactInfo", "lastAudit", "ircExpiryDate"] as const) {
        if (current[field] !== result[field]) {
          beforeData[field] = current[field];
          afterData[field] = result[field];
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await recordEvent(req, {
          event: "source.updated",
          entity: { type: entityType, id, name: entityName },
          changes: diffFields(beforeData, afterData, Object.keys(afterData)),
          reason: reason || null,
        });
      }
    },
  };
}

export async function applyScoresSection(
  req: any, current: any, base: any, payload: any, reason: string | null,
): Promise<SectionOutcome> {
  const parsed = vendorScoreSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error.issues);
  const s = parsed.data;
  const id = current.id;

  // A simple allow/deny on the route is not enough. It replaces the whole
  // scores object rather than patching one field, so a caller entitled to send
  // it could carry another department's score along in the payload. Compare
  // against what is stored and refuse anything they may not touch.
  const scorer = await getUserByUsername(req.user?.username || "");
  if (!scorer || scorer.isActive === false) {
    return refuse(401, { error: "این حساب کاربری دیگر معتبر نیست." });
  }
  const offending = [
    ...forbiddenScoreChanges(scorer, current.scores as any, s.scores as any),
    ...forbiddenRawScoreChanges(scorer, current.rawScores as any, s.rawScores as any),
  ];
  if (offending.length > 0) {
    const unique = [...new Set(offending)].join('، ');
    return refuse(403, {
      error: `عدم دسترسی: شما تنها مجاز به ثبت امتیاز دپارتمان خود هستید (تلاش برای تغییر: ${unique}).`,
    });
  }

  // A sample has no departmental score to give. Refused rather than dropped: a
  // request that stores nothing must not answer 200, or the caller records a
  // scoring that never happened (rule 11e).
  const scoredSample = forbiddenSampleScoring(current, s);
  if (scoredSample.length > 0) {
    recordEvent(req, {
      event: "access.denied",
      entity: { type: "Vendor", id, name: current.name },
      facts: {
        attempted: "امتیازدهی دپارتمانی به نمونه",
        fields: scoredSample.join("، "),
      },
    });
    return refuse(422, {
      error: "نمونه با نظر آزمایشگاه تصمیم‌گیری می‌شود و امتیاز دپارتمانی نمی‌گیرد.",
    });
  }

  // The stated grounds for a rejection travel with the scores, so the verdict
  // has to be checked here as well as on the profile.
  const verdict = await unauthorisedVerdict(req, current, s);
  if (verdict) return verdict;

  const prevScores = current.scores || { commercial: 0, qa: 0, planning: 0, finance: 0 };
  const prevSPS = Math.round(calculateWeightedScore(prevScores, CALCULATION_WEIGHTS) * 10) / 10;
  const prevGrade = current.grade || 'unrated';

  const merged = {
    ...base,
    scores: s.scores ?? base.scores,
    rawScores: s.rawScores ?? base.rawScores,
    rejectionReasons: s.rejectionReasons ?? base.rejectionReasons,
  };

  return {
    ok: true,
    merged,
    audit: async (result: any) => {
      const entityName = entityNameOf(current, result);
      const newScores = result.scores || { commercial: 0, qa: 0, planning: 0, finance: 0 };
      const newSPS = Math.round(calculateWeightedScore(newScores, CALCULATION_WEIGHTS) * 10) / 10;

      // The department scores travel as one field because they are saved as one
      // object; `facts` repeats the resulting SPS and grade so the score history
      // can plot a point from any recorded row.
      const scoreChanges = diffFields(
        { totalSPS: prevSPS, grade: prevGrade, scores: prevScores, status: current.status },
        { totalSPS: newSPS, grade: result.grade, scores: newScores, status: result.status },
        ["totalSPS", "grade", "scores", "status"],
      );
      await recordEvent(req, {
        event: "source.scored",
        entity: { type: "Score", id, name: entityName },
        changes: scoreChanges,
        facts: scoreChanges.length > 0 ? { totalSPS: newSPS, grade: result.grade, scores: newScores } : undefined,
        reason: reason || null,
      });
    },
  };
}

export async function applyLogsSection(
  req: any, current: any, base: any, payload: any, reason: string | null,
): Promise<SectionOutcome> {
  const parsed = vendorLogsSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error.issues);
  const l = parsed.data;
  const id = current.id;

  // Only `vendor.edit` may rewrite history. For everyone else the submitted
  // list has to start with the stored one, entry for entry: new lines at the
  // end are the record of what they did, while a changed or missing line is
  // somebody editing the trail with a permission that was granted for a
  // decision.
  if (l.activityLogs && !can(req.account, "vendor.edit")) {
    const before = (current.activityLogs || []) as any[];
    const after = l.activityLogs as any[];
    const appendOnly = after.length >= before.length
      && before.every((entry, i) => JSON.stringify(entry) === JSON.stringify(after[i]));
    if (!appendOnly) {
      return refuse(403, {
        error: "عدم دسترسی: تغییر یا حذف سوابق فعالیت نیازمند مجوز «ویرایش سورس» است.",
      });
    }
  }

  const merged = { ...base, activityLogs: l.activityLogs ?? base.activityLogs };
  const prevLogs = current.activityLogs || [];
  const nextLogs = merged.activityLogs || [];

  return {
    ok: true,
    merged,
    audit: async () => {
      // This was once the only write endpoint in the API that left no audit
      // record, so editing or deleting an entry in a source's activity log was
      // the one change in the system with no trace behind it.
      if (JSON.stringify(prevLogs) !== JSON.stringify(nextLogs)) {
        await recordEvent(req, {
          event: "source.updated",
          entity: { type: "ActivityLog", id, name: current.name || id },
          changes: [{ field: "activityLogCount", from: prevLogs.length, to: nextLogs.length }],
          reason: reason || null,
        });
      }
    },
  };
}

export async function applyAnalysisSection(
  req: any, current: any, base: any, payload: any, reason: string | null,
): Promise<SectionOutcome> {
  const parsed = vendorAnalysisSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error.issues);
  const a = parsed.data;
  const id = current.id;

  const prevRecords: any[] = current.analysisRecords || [];
  const newRecords: any[] = a.analysisRecords ?? prevRecords;

  /*
   * Saving a laboratory record does not move a sample's status.
   *
   * This part used to stamp a sample 'rejected' as soon as one Reject record
   * arrived, and — worse — restore it to `initialSampleStatus || "approved"` as
   * soon as that record was deleted, so a sample could be approved by nobody
   * twice over. A record is evidence; the verdict is a decision a person
   * records with a reason (the sample decision box), and it reaches the server
   * as an ordinary status change with its own audit entry.
   */
  const merged = {
    ...base,
    status: base.status,
    analysisRecords: newRecords,
    activityLogs: a.activityLogs ?? base.activityLogs,
  };

  return {
    ok: true,
    merged,
    audit: async (result: any) => {
      const entityName = entityNameOf(current, result);

      const prevIds = new Set(prevRecords.map((r: any) => r.id));
      const newIds = new Set(newRecords.map((r: any) => r.id));

      const addedRecs = newRecords.filter((r: any) => !prevIds.has(r.id));
      const deletedRecs = prevRecords.filter((r: any) => !newIds.has(r.id));
      const updatedRecs = newRecords.filter((r: any) => {
        if (!prevIds.has(r.id)) return false;
        const prev = prevRecords.find((p: any) => p.id === r.id);
        return JSON.stringify(prev) !== JSON.stringify(r);
      });

      for (const rec of addedRecs) {
        await recordEvent(req, {
          event: "lab.result_added",
          entity: { type: "Laboratory Result", id, name: entityName },
          facts: { qcCode: rec.qcCode || null, decision: rec.decision, date: rec.date },
          reason: reason || null,
        });
      }

      for (const rec of updatedRecs) {
        const prevRec = prevRecords.find((p: any) => p.id === rec.id) || {};
        await recordEvent(req, {
          event: "lab.result_updated",
          entity: { type: "Laboratory Result", id, name: entityName },
          changes: diffFields(prevRec, rec, ["decision", "qcCode", "date", "comments"]),
          facts: { qcCode: rec.qcCode || null },
          reason: reason || null,
        });
      }

      // The QC code and the verdict that was removed, not a copy of the record
      // (rule 16).
      for (const rec of deletedRecs) {
        await recordEvent(req, {
          event: "lab.result_removed",
          entity: { type: "Laboratory Result", id, name: entityName },
          facts: { qcCode: rec.qcCode || null, decision: rec.decision },
          reason: reason || null,
        });
      }

      // Fallback when the list changed without any record being added, edited
      // or removed — a reordering, say. Reported as a count so the row still
      // says something rather than repeating the list.
      if (addedRecs.length === 0 && updatedRecs.length === 0 && deletedRecs.length === 0
        && JSON.stringify(prevRecords) !== JSON.stringify(newRecords)) {
        await recordEvent(req, {
          event: "lab.result_updated",
          entity: { type: "Laboratory Result", id, name: entityName },
          changes: [{ field: "analysisRecordCount", from: prevRecords.length, to: newRecords.length }],
          reason: reason || null,
        });
      }
    },
  };
}

export async function applyRiskSection(
  req: any, current: any, base: any, payload: any, reason: string | null,
): Promise<SectionOutcome> {
  const parsed = vendorRiskSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error.issues);
  const r = parsed.data;
  const id = current.id;

  const merged = { ...base, riskAssessment: r.riskAssessment ?? base.riskAssessment };
  const prevRisk = current.riskAssessment || null;

  return {
    ok: true,
    merged,
    audit: async (result: any) => {
      const entityName = entityNameOf(current, result);
      const newRisk = result.riskAssessment || {};
      await recordEvent(req, {
        event: "risk.assessed",
        entity: { type: "Risk Assessment", id, name: entityName },
        // The FMEA parameters only: the whole record also carries the material
        // and the supplier, which do not change here and are named in the
        // columns.
        changes: riskChanges(prevRisk, newRisk),
        facts: riskFacts(newRisk),
        reason: reason || "ویرایش پارامترهای FMEA / RPN / SRI",
      });
    },
  };
}
