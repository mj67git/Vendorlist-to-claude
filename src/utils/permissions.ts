/**
 * Who may do what — the single source of truth, imported by BOTH the Express
 * server and the React UI.
 *
 * It lives in one file on purpose. The role checks used to be written twice:
 * scattered `role === 'admin'` conditions in the components, and separately (or
 * not at all) on the endpoints. They drifted, and the UI ended up hiding
 * buttons for actions the server still happily performed — a finance account
 * could delete any source with a hand-made request. With one table, the screen
 * and the endpoint cannot disagree.
 *
 * The server is still the authority: the UI reads this to decide what to show,
 * the server reads it to decide what to allow. Hiding a button is a courtesy,
 * refusing the request is the control.
 */

export type Role = 'admin' | 'lab' | 'commercial' | 'qa' | 'planning' | 'finance';

export type Permission =
  /** Register a new source, or edit an existing one's profile/contact details. */
  | 'vendor.write'
  /** Remove a source entirely. */
  | 'vendor.delete'
  /** Record or edit laboratory analysis results. */
  | 'vendor.analysis'
  /** Record or edit the FMEA risk assessment. */
  | 'vendor.risk'
  /** Create, edit or delete a material in the master repository. */
  | 'material.write'
  /** Create, edit, blacklist or delete a business partner. */
  | 'partner.write'
  /** Read the audit trail. */
  | 'audit.read'
  /** Read the full data archive. */
  | 'archive.read'
  /** Administer user accounts. */
  | 'users.manage';

/**
 * Departments that carry an evaluation score. A role of the same name may edit
 * that department's score and no other — see canScoreDepartment.
 */
export const SCORING_DEPARTMENTS = ['commercial', 'qa', 'planning', 'finance'] as const;
export type ScoringDepartment = (typeof SCORING_DEPARTMENTS)[number];

/**
 * Reading is not restricted: every signed-in user can see the whole vendor
 * list, the repositories and each source's detail page. Only writes are
 * divided, and only the entries listed here are granted.
 *
 * `lab` intentionally holds nothing. The role exists in the database enum and
 * no account uses it; risk assessment, which it used to share with qa, is now
 * admin-only. It is left in place because removing it would mean a schema
 * migration for a role nobody has.
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [
    'vendor.write', 'vendor.delete', 'vendor.analysis', 'vendor.risk',
    'material.write', 'partner.write',
    'audit.read', 'archive.read', 'users.manage',
  ],
  commercial: ['vendor.write', 'partner.write'],
  qa: ['vendor.analysis', 'material.write'],
  planning: [],
  finance: [],
  lab: [],
};

/** Does this role hold this permission? Unknown roles hold nothing. */
export function can(role: string | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  const granted = ROLE_PERMISSIONS[role as Role];
  return !!granted && granted.includes(permission);
}

/**
 * May this role write the score of this department?
 *
 * An admin may score on behalf of any department. Everyone else may only touch
 * the one that matches their own role, which is what keeps a finance user from
 * writing the QA score in the same request that carries their own.
 */
export function canScoreDepartment(role: string | undefined | null, department: string): boolean {
  if (!role) return false;
  if (role === 'admin') return (SCORING_DEPARTMENTS as readonly string[]).includes(department);
  return role === department && (SCORING_DEPARTMENTS as readonly string[]).includes(department);
}

/** Departments this role may score — drives which sections the forms render. */
export function scorableDepartments(role: string | undefined | null): ScoringDepartment[] {
  return SCORING_DEPARTMENTS.filter(d => canScoreDepartment(role, d));
}

/** True when the role may write at least one department's score. */
export function canScoreAny(role: string | undefined | null): boolean {
  return scorableDepartments(role).length > 0;
}

/**
 * Compare a submitted score payload against what is stored and report every
 * department the caller is not allowed to have changed.
 *
 * The scores endpoint replaces the whole object rather than patching one field,
 * so an allow/deny check on the route is not enough on its own: without this a
 * permitted caller could carry someone else's department along in the payload.
 * Values are compared loosely because they arrive as numbers or numeric
 * strings depending on the form.
 */
export function forbiddenScoreChanges(
  role: string | undefined | null,
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): string[] {
  if (!next) return [];
  const before = previous || {};
  const offending: string[] = [];

  for (const department of Object.keys(next)) {
    const changed = normalizeScore(next[department]) !== normalizeScore((before as any)[department]);
    if (changed && !canScoreDepartment(role, department)) offending.push(department);
  }
  return offending;
}

/**
 * "Not scored yet" and "scored zero" are the same thing here, so they must not
 * read as a change. The evaluation form always submits all four departments and
 * fills the ones the user cannot edit with `prevScores[dept] || 0`, so on a
 * source with no scores at all it sends 0 where the stored record has nothing.
 * Without this, a finance user could never score a brand-new source: their own
 * legitimate save carried three untouched zeros that looked like edits.
 */
function normalizeScore(value: unknown): string {
  if (value === null || value === undefined || value === '') return '0';
  return String(value);
}

/**
 * Same check for the per-question raw scores, which are nested one level deeper
 * (department -> question -> value).
 */
export function forbiddenRawScoreChanges(
  role: string | undefined | null,
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): string[] {
  if (!next) return [];
  const before = previous || {};
  const offending: string[] = [];

  for (const department of Object.keys(next)) {
    const changed = JSON.stringify(next[department] ?? null) !== JSON.stringify((before as any)[department] ?? null);
    if (changed && !canScoreDepartment(role, department)) offending.push(department);
  }
  return offending;
}
