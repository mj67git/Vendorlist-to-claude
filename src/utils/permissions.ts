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
 *
 * A role is a *template*, not the final word. An admin may tick permissions on
 * or off for one person, and those overrides are stored on the user record. An
 * empty override list means "follow the role", which is what every account had
 * before per-user permissions existed — so nothing needed migrating.
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
  /** Score one department's evaluation. One permission per department, so a
   *  person can be given more than one — which a role alone could not express. */
  | 'score.commercial'
  | 'score.qa'
  | 'score.planning'
  | 'score.finance'
  /** Create, edit or delete a material in the master repository. */
  | 'material.write'
  /** Create, edit, blacklist or delete a business partner. */
  | 'partner.write'
  /** Read the audit trail. */
  | 'audit.read'
  /** Read the full data archive. */
  | 'archive.read'
  /** Administer user accounts, including their permissions. */
  | 'users.manage';

/** Departments that carry an evaluation score. */
export const SCORING_DEPARTMENTS = ['commercial', 'qa', 'planning', 'finance'] as const;
export type ScoringDepartment = (typeof SCORING_DEPARTMENTS)[number];

/** Every permission there is, in the order the admin screen groups them. */
export const ALL_PERMISSIONS: Permission[] = [
  'vendor.write', 'vendor.delete',
  'score.commercial', 'score.qa', 'score.planning', 'score.finance',
  'vendor.analysis', 'vendor.risk',
  'material.write', 'partner.write',
  'archive.read', 'audit.read', 'users.manage',
];

/** Persian labels, used by the permissions dialog. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'vendor.write': 'ثبت و ویرایش سورس',
  'vendor.delete': 'حذف سورس',
  'score.commercial': 'امتیازدهی بازرگانی و خرید',
  'score.qa': 'امتیازدهی تضمین کیفیت (QA)',
  'score.planning': 'امتیازدهی برنامه‌ریزی و انبار',
  'score.finance': 'امتیازدهی مالی و حسابداری',
  'vendor.analysis': 'ثبت نتایج آزمایشگاهی',
  'vendor.risk': 'ارزیابی ریسک (FMEA)',
  'material.write': 'مدیریت مخزن مواد اولیه',
  'partner.write': 'مدیریت شرکای تجاری',
  'archive.read': 'آرشیو کامل داده‌ها',
  'audit.read': 'ردیابی تغییرات (Audit)',
  'users.manage': 'مدیریت کاربران',
};

export const PERMISSION_GROUPS: Array<{ title: string; permissions: Permission[] }> = [
  { title: 'سورس‌ها', permissions: ['vendor.write', 'vendor.delete'] },
  { title: 'ارزیابی', permissions: ['score.commercial', 'score.qa', 'score.planning', 'score.finance', 'vendor.analysis', 'vendor.risk'] },
  { title: 'مخازن', permissions: ['material.write', 'partner.write'] },
  { title: 'مدیریتی', permissions: ['archive.read', 'audit.read', 'users.manage'] },
];

/**
 * The default set each role starts from. Reading is not restricted anywhere:
 * every signed-in user can see the vendor list, the repositories and each
 * source's detail page. Only writes are divided.
 *
 * `lab` intentionally holds nothing. It exists in the database enum, no account
 * uses it, and it is left alone because removing it would mean a schema
 * migration for a role nobody has.
 */
const ROLE_TEMPLATES: Record<Role, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  commercial: ['vendor.write', 'partner.write', 'score.commercial'],
  qa: ['vendor.analysis', 'material.write', 'score.qa'],
  planning: ['score.planning'],
  finance: ['score.finance'],
  lab: [],
};

/** What a role grants before any per-user adjustment. */
export function roleTemplate(role: string | undefined | null): Permission[] {
  if (!role) return [];
  return [...(ROLE_TEMPLATES[role as Role] ?? [])];
}

/** The shape `can()` needs: a role, plus optional per-user overrides. */
export interface PermissionSubject {
  role?: string | null;
  permissions?: unknown;
}

function parseOverrides(raw: unknown): Permission[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const known = raw.filter((p): p is Permission =>
    typeof p === 'string' && (ALL_PERMISSIONS as string[]).includes(p));
  // An override list of only unrecognised entries is treated as no override
  // rather than as "nothing allowed", so a stale name cannot silently lock a
  // user out of everything.
  return known.length > 0 ? known : null;
}

/** True when this user's access has been adjusted away from their role. */
export function hasCustomPermissions(subject: PermissionSubject | null | undefined): boolean {
  return !!subject && parseOverrides(subject.permissions) !== null;
}

/**
 * The permissions actually in force: the per-user list when one is set,
 * otherwise the role's template.
 */
export function effectivePermissions(subject: PermissionSubject | null | undefined): Permission[] {
  if (!subject) return [];
  return parseOverrides(subject.permissions) ?? roleTemplate(subject.role);
}

/**
 * Does this user hold this permission?
 *
 * Accepts the user rather than a bare role, because a role is only the default
 * now. Passing a plain role string still works for the places that genuinely
 * only know the role.
 */
export function can(
  subject: PermissionSubject | string | undefined | null,
  permission: Permission,
): boolean {
  if (!subject) return false;
  const resolved: PermissionSubject = typeof subject === 'string' ? { role: subject } : subject;
  return effectivePermissions(resolved).includes(permission);
}

/** May this user write the score of this department? */
export function canScoreDepartment(
  subject: PermissionSubject | string | undefined | null,
  department: string,
): boolean {
  if (!(SCORING_DEPARTMENTS as readonly string[]).includes(department)) return false;
  return can(subject, `score.${department}` as Permission);
}

/** Departments this user may score — drives which sections the forms render. */
export function scorableDepartments(
  subject: PermissionSubject | string | undefined | null,
): ScoringDepartment[] {
  return SCORING_DEPARTMENTS.filter(d => canScoreDepartment(subject, d));
}

/** True when the user may write at least one department's score. */
export function canScoreAny(subject: PermissionSubject | string | undefined | null): boolean {
  return scorableDepartments(subject).length > 0;
}

/** Keep only the recognised permissions from arbitrary input, without duplicates. */
export function sanitizePermissions(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  return ALL_PERMISSIONS.filter(p => raw.includes(p));
}

/**
 * Compare a submitted score payload against what is stored and report every
 * department the caller is not allowed to have changed.
 *
 * The scores endpoint replaces the whole object rather than patching one field,
 * so an allow/deny check on the route is not enough on its own: without this a
 * permitted caller could carry someone else's department along in the payload.
 */
export function forbiddenScoreChanges(
  subject: PermissionSubject | string | undefined | null,
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): string[] {
  if (!next) return [];
  const before = previous || {};
  const offending: string[] = [];

  for (const department of Object.keys(next)) {
    const changed = normalizeScore(next[department]) !== normalizeScore((before as any)[department]);
    if (changed && !canScoreDepartment(subject, department)) offending.push(department);
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
  subject: PermissionSubject | string | undefined | null,
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): string[] {
  if (!next) return [];
  const before = previous || {};
  const offending: string[] = [];

  for (const department of Object.keys(next)) {
    const changed = JSON.stringify(next[department] ?? null) !== JSON.stringify((before as any)[department] ?? null);
    if (changed && !canScoreDepartment(subject, department)) offending.push(department);
  }
  return offending;
}
