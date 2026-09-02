import { z } from "zod";

export const vendorSchema = z.object({
  id: z.string().min(1, "ID is required"),
  material: z.string().optional(),
  materialEn: z.string().optional(),
  cas: z.string().regex(/^\d+-\d{2}-\d+$/, "Invalid CAS format. Expected format: xxx-xx-x").or(z.literal("N/A")).or(z.literal("")),
  irc: z.string().regex(/^\d*$|^$/, "IRC must be numeric").or(z.literal("N/A")).or(z.literal("")),
  name: z.string().optional(),
  nameEn: z.string().optional(),
  country: z.string().optional(),
  status: z.string().optional(),
}).passthrough();

/**
 * A field a source may simply not have.
 *
 * `.optional()` alone accepts `undefined` and rejects `null`, and the client
 * sends `null` — the vendor object carries these as null when nothing was ever
 * entered. That mismatch made every score change on a source with no IRC expiry
 * date fail: saving scores also recomputes grade and status, which queues a
 * profile PATCH carrying `ircExpiryDate: null`, the profile call 400'd on it,
 * and because the write queue is sequential and stops at the first failure
 * (rule 12), the scores call behind it never ran. The user saw "Validation
 * failed" and lost the edit.
 *
 * `.nullish()` is `.nullable().optional()`: absent and "explicitly empty" are
 * both accepted, which is what an optional field means here.
 */
const optionalText = () => z.string().nullish();

export const vendorProfileSchema = z.object({
  material: optionalText(),
  materialEn: optionalText(),
  cas: z.string().regex(/^\d+-\d{2}-\d+$/, "Invalid CAS format. Expected format: xxx-xx-x").or(z.literal("N/A")).or(z.literal("")).nullish(),
  irc: z.string().regex(/^\d*$|^$/, "IRC must be numeric").or(z.literal("N/A")).or(z.literal("")).nullish(),
  ircExpiryDate: optionalText(),
  name: optionalText(),
  nameEn: optionalText(),
  country: optionalText(),
  grade: optionalText(),
  status: optionalText(),
  isSample: z.boolean().nullish(),
}).passthrough();

export const vendorContactSchema = z.object({
  contactInfo: optionalText(),
  lastAudit: optionalText(),
  ircExpiryDate: optionalText(),
}).passthrough();

export const vendorScoreSchema = z.object({
  scores: z.any().nullable().optional(),
  rawScores: z.any().nullable().optional(),
  rejectionReasons: z.any().nullable().optional(),
}).passthrough();

export const vendorLogsSchema = z.object({
  activityLogs: z.array(z.object({
    id: z.string(),
    action: z.string(),
    date: z.string(),
    user: z.string()
  })).optional()
}).passthrough();

export const vendorAnalysisSchema = z.object({
  analysisRecords: z.array(z.object({
    id: z.string(),
    date: z.string(),
    qcCode: z.string(),
    decision: z.string(),
    deviationReason: z.string(),
    comments: z.string(),
    recordedBy: z.string()
  })).optional(),
  activityLogs: z.array(z.object({
    id: z.string(),
    action: z.string(),
    date: z.string(),
    user: z.string()
  })).optional()
}).passthrough();

export const vendorRiskSchema = z.object({
  riskAssessment: z.any().nullable().optional()
}).passthrough();

