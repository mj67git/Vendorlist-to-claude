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

export const vendorProfileSchema = z.object({
  material: z.string().optional(),
  materialEn: z.string().optional(),
  cas: z.string().regex(/^\d+-\d{2}-\d+$/, "Invalid CAS format. Expected format: xxx-xx-x").or(z.literal("N/A")).or(z.literal("")),
  irc: z.string().regex(/^\d*$|^$/, "IRC must be numeric").or(z.literal("N/A")).or(z.literal("")),
  ircExpiryDate: z.string().optional(),
  name: z.string().optional(),
  nameEn: z.string().optional(),
  country: z.string().optional(),
  grade: z.string().nullable().optional(),
  status: z.string().optional(),
  isSample: z.boolean().optional(),
}).passthrough();

export const vendorContactSchema = z.object({
  contactInfo: z.string().optional(),
  lastAudit: z.string().optional(),
  ircExpiryDate: z.string().optional(),
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

