import type { Vendor } from '../types';

/**
 * Which parts of a source actually changed, and what to send for each.
 *
 * `PUT /api/vendors/:id` writes only the parts it is given, so a field missing
 * from this file is a field the server never hears about. The browser still
 * shows it — the local copy was updated optimistically — and one reload puts
 * the stored value back. That is not a visible failure anywhere: the save
 * succeeds, the toast says so, and the edit is gone.
 *
 * Two fields were missing, and both were ones a user re-files a record by:
 *
 *   - `category` was in neither the comparison nor the payload, so moving a
 *     source from «خرید خارجی» to «خرید داخلی» produced *no profile part at
 *     all* and nothing was written.
 *   - `materialId` was in neither either. Re-pointing a source at another
 *     substance did send a profile part (the name and the CAS had changed), but
 *     without the catalogue id the form had picked — so the server fell back to
 *     deriving one from the CAS and linked the source to a freshly minted
 *     duplicate instead of the catalogue row the user chose.
 *
 * This lives in its own file so the comparison and the payload are read
 * together. They were forty lines apart, which is how a field comes to be in
 * one and not the other.
 */

/** Every profile field, listed once. The comparison and the payload both use it. */
export const PROFILE_FIELDS = [
  'material', 'materialEn', 'cas', 'irc', 'ircExpiryDate',
  'name', 'nameEn', 'country', 'grade', 'status',
  'isSample', 'initialSampleStatus',
  // Which register the source belongs to, and which catalogue row it supplies.
  // Both are stored on `vendor_materials`, not on `vendors`, which is why they
  // read as "saved" locally and reverted on reload.
  'category', 'materialId',
  // The partner link: re-pointing a source at another company used to change
  // the name on screen and silently leave the link where it was.
  'manufacturerId', 'supplierId',
] as const;

/** Fields whose absence and whose null mean the same thing, so they compare as equal. */
const NULLABLE_PROFILE_FIELDS = new Set(['manufacturerId', 'supplierId', 'materialId']);

export interface VendorSections {
  profile?: Record<string, unknown>;
  contact?: Record<string, unknown>;
  scores?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  logs?: Record<string, unknown>;
  risk?: Record<string, unknown>;
}

const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

export function buildVendorSections(original: Vendor, normalized: Vendor): VendorSections {
  const o = original as unknown as Record<string, unknown>;
  const n = normalized as unknown as Record<string, unknown>;

  const profileChanged = PROFILE_FIELDS.some(field => (
    NULLABLE_PROFILE_FIELDS.has(field)
      ? (o[field] || null) !== (n[field] || null)
      : o[field] !== n[field]
  ));

  const contactChanged =
    o.contactInfo !== n.contactInfo ||
    o.lastAudit !== n.lastAudit ||
    o.ircExpiryDate !== n.ircExpiryDate;

  const scoresChanged =
    differs(o.scores, n.scores) ||
    differs(o.rawScores, n.rawScores) ||
    differs(o.rejectionReasons, n.rejectionReasons);

  const logsChanged = differs(o.activityLogs, n.activityLogs);
  const analysisChanged = differs(o.analysisRecords, n.analysisRecords);
  const riskChanged = differs(o.riskAssessment, n.riskAssessment);

  const sections: VendorSections = {};

  if (profileChanged) {
    const profile: Record<string, unknown> = {};
    for (const field of PROFILE_FIELDS) {
      profile[field] = NULLABLE_PROFILE_FIELDS.has(field) ? (n[field] ?? null) : n[field];
    }
    sections.profile = profile;
  }

  if (contactChanged) {
    sections.contact = {
      contactInfo: n.contactInfo,
      lastAudit: n.lastAudit,
      ircExpiryDate: n.ircExpiryDate,
    };
  }

  if (scoresChanged) {
    sections.scores = {
      scores: n.scores,
      rawScores: n.rawScores,
      rejectionReasons: n.rejectionReasons,
    };
  }

  // The analysis part carries the activity log with it, the way the old
  // `/analysis` endpoint did; the log is only sent on its own when nothing
  // about the laboratory results changed.
  if (analysisChanged) {
    sections.analysis = {
      analysisRecords: n.analysisRecords,
      activityLogs: n.activityLogs,
    };
  } else if (logsChanged) {
    sections.logs = { activityLogs: n.activityLogs };
  }

  if (riskChanged) {
    sections.risk = { riskAssessment: n.riskAssessment };
  }

  return sections;
}
