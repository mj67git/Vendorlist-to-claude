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
  /** See the source list, the category views and a source's detail page. */
  | 'vendor.read'
  /** Register a new source. */
  | 'vendor.create'
  /** Edit an existing source's profile, contact details or activity log. */
  | 'vendor.edit'
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
  /** See the material repository. */
  | 'material.read'
  /** Add a material to the master repository. */
  | 'material.create'
  /** Edit a material, including its active/inactive status. */
  | 'material.edit'
  /** Remove a material from the repository. */
  | 'material.delete'
  /** See the business-partner repository and the SOP evaluations. */
  | 'partner.read'
  /** Add a business partner. */
  | 'partner.create'
  /** Edit a partner, including its SOP evaluation and blacklist status. */
  | 'partner.edit'
  /** Remove a business partner. */
  | 'partner.delete'
  /** Download the SOP documents attached to a partner. Separate from
   *  `partner.read` because these are the legal papers themselves — business
   *  licence, signatory authorisation, legalisation — and seeing that a partner
   *  is graded B is a different thing from taking its licence off the system. */
  | 'partner.files'
  /** Read the audit trail. */
  | 'audit.read'
  /** Administer user accounts, including their permissions. */
  | 'users.manage';

/** Departments that carry an evaluation score. */
export const SCORING_DEPARTMENTS = ['commercial', 'qa', 'planning', 'finance'] as const;
export type ScoringDepartment = (typeof SCORING_DEPARTMENTS)[number];

/** Every permission there is, in the order the admin screen groups them. */
export const ALL_PERMISSIONS: Permission[] = [
  'vendor.read', 'vendor.create', 'vendor.edit', 'vendor.delete',
  'material.read', 'material.create', 'material.edit', 'material.delete',
  'partner.read', 'partner.create', 'partner.edit', 'partner.delete', 'partner.files',
  'vendor.analysis', 'vendor.risk',
  'score.commercial', 'score.qa', 'score.planning', 'score.finance',
  'audit.read', 'users.manage',
];

/**
 * Permissions that no longer exist, and what they now mean.
 *
 * `material.write` used to cover create, edit and delete together because the
 * endpoints shared one guard. Splitting the guard would silently strip access
 * from every account whose stored override still names the old permission, so
 * the old name is expanded on read instead. Nothing in the database has to
 * change — the same approach that let per-user overrides ship without a
 * migration.
 *
 * `archive.read` is gone rather than renamed. It gated nothing: the archive is
 * a view over vendor data every signed-in user can already read, so no server
 * check could have made it real.
 */
const LEGACY_PERMISSIONS: Record<string, Permission[]> = {
  'vendor.write': ['vendor.create', 'vendor.edit'],
  'material.write': ['material.create', 'material.edit', 'material.delete'],
  'partner.write': ['partner.create', 'partner.edit', 'partner.delete'],
  'archive.read': [],
};

/** Persian labels, used where a single permission is named on its own. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'vendor.read': 'مشاهدهٔ سورس‌ها',
  'vendor.create': 'ثبت سورس جدید',
  'vendor.edit': 'ویرایش سورس',
  'vendor.delete': 'حذف سورس',
  'material.read': 'مشاهدهٔ مخزن مواد',
  'material.create': 'ثبت مادهٔ جدید',
  'material.edit': 'ویرایش ماده',
  'material.delete': 'حذف ماده',
  'partner.read': 'مشاهدهٔ شرکای تجاری',
  'partner.create': 'ثبت شریک جدید',
  'partner.edit': 'ویرایش شریک',
  'partner.delete': 'حذف شریک',
  'partner.files': 'دانلود مدارک SOP شریک',
  'vendor.analysis': 'ثبت نتایج آزمایشگاهی',
  'vendor.risk': 'ارزیابی ریسک (FMEA)',
  'score.commercial': 'امتیازدهی بازرگانی و خرید',
  'score.qa': 'امتیازدهی تضمین کیفیت (QA)',
  'score.planning': 'امتیازدهی برنامه‌ریزی و انبار',
  'score.finance': 'امتیازدهی مالی و حسابداری',
  'audit.read': 'مشاهدهٔ ردیابی تغییرات',
  'users.manage': 'مدیریت کاربران',
};

/**
 * How the admin screen lays the permissions out: one row per module, with a
 * cell per action.
 *
 * `null` means the server cannot tell that action apart from the others in the
 * same row, so offering a separate checkbox would promise a control that does
 * not exist. `'open'` means every signed-in user can do it and no setting
 * changes that. Both are rendered as locked cells with the reason shown, rather
 * than as ticks that quietly do nothing.
 */
export type ModuleAction = 'view' | 'create' | 'edit' | 'delete';

export interface PermissionModule {
  key: string;
  title: string;
  /** Set when the whole row is one permission; the row renders a single tick. */
  single?: Permission;
  actions: Record<ModuleAction, Permission | 'open' | null>;
  /** Shown under the module name to explain a locked or merged row. */
  note?: string;
  /**
   * Abilities of this module that are not one of the four CRUD actions, each
   * with its own letter for the summary badge. Downloading a partner's SOP
   * papers is the first: it is a read, but not the read that opens the list, so
   * it needs a checkbox of its own rather than a fifth column that would be
   * empty on every other row.
   */
  extras?: Array<{ permission: Permission; letter: string; label: string; note: string }>;
}

export const PERMISSION_MODULES: PermissionModule[] = [
  {
    key: 'vendors',
    title: 'سورس‌ها (تأمین‌کنندگان)',
    actions: { view: 'vendor.read', create: 'vendor.create', edit: 'vendor.edit', delete: 'vendor.delete' },
  },
  {
    key: 'materials',
    title: 'مخزن مواد اولیه',
    actions: { view: 'material.read', create: 'material.create', edit: 'material.edit', delete: 'material.delete' },
  },
  {
    key: 'partners',
    title: 'شرکای تجاری',
    actions: { view: 'partner.read', create: 'partner.create', edit: 'partner.edit', delete: 'partner.delete' },
    extras: [{
      permission: 'partner.files',
      letter: 'F',
      label: 'دانلود مدارک SOP',
      note: 'مشاهدهٔ فهرست و گرید شریک با «مشاهده» داده می‌شود؛ این گزینه اجازهٔ گرفتن خودِ مدارک (مجوز کسب‌وکار، معرفی‌نامه، ترجمهٔ رسمی) را می‌دهد.',
    }],
  },
  {
    key: 'analysis',
    title: 'نتایج آزمایشگاهی',
    single: 'vendor.analysis',
    actions: { view: 'vendor.read', create: 'vendor.analysis', edit: 'vendor.analysis', delete: 'vendor.analysis' },
    note: 'نتایج داخل صفحهٔ سورس نمایش داده می‌شوند، پس مشاهده‌شان همان «مشاهدهٔ سورس‌ها» است. کل فهرست یکجا ذخیره می‌شود، پس ثبت و ویرایش و حذف از هم تفکیک‌پذیر نیستند.',
  },
  {
    key: 'risk',
    title: 'ارزیابی ریسک (FMEA)',
    single: 'vendor.risk',
    actions: { view: 'vendor.read', create: 'vendor.risk', edit: 'vendor.risk', delete: 'vendor.risk' },
    note: 'ارزیابی ریسک یک رکورد واحد است که جایگزین می‌شود؛ مشاهده‌اش همان «مشاهدهٔ سورس‌ها» است.',
  },
  {
    key: 'audit',
    title: 'ردیابی تغییرات (Audit)',
    single: 'audit.read',
    actions: { view: 'audit.read', create: null, edit: null, delete: null },
    note: 'سابقهٔ ممیزی فقط خواندنی است؛ هیچ‌کس نمی‌تواند آن را تغییر دهد.',
  },
  {
    key: 'users',
    title: 'مدیریت کاربران',
    single: 'users.manage',
    actions: { view: 'users.manage', create: 'users.manage', edit: 'users.manage', delete: 'users.manage' },
    note: 'همهٔ مسیرهای این ماژول یک گارد مشترک دارند و عمداً تفکیک نشده‌اند.',
  },
];

/** Why a cell is locked, shown to the admin instead of a dead checkbox. */
export const LOCKED_REASONS = {
  open: 'این بخش برای هر کاربر واردشده باز است و تنظیمی آن را محدود نمی‌کند.',
  none: 'این عملیات در این ماژول وجود ندارد.',
} as const;

/**
 * The default set each role starts from.
 *
 * Reading is a permission now, not a given. Every working role starts with read
 * on all three repositories, so no account loses the pages it works in; an admin
 * can take one away for one person (finance sees the partners but cannot touch
 * them, a contractor sees nothing but materials).
 *
 * `partner.files` is the exception to "everyone reads everything": the SOP
 * papers are the partner's legal documents, so they go to the roles that handle
 * them — commercial, who collects them, and QA, who grades them — and not to
 * planning or finance, whose work needs the list and the grade. An admin can
 * still grant it to one person.
 *
 * `lab` intentionally holds nothing, reads included. It exists in the database
 * enum, no account uses it, and it is left alone because removing it would mean
 * a schema migration for a role nobody has.
 */
const READ_ALL = ['vendor.read', 'material.read', 'partner.read'] as const;

const ROLE_TEMPLATES: Record<Role, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  commercial: [
    ...READ_ALL,
    // Commercial owns the partner records and collects these papers, and QA
    // reviews them against the SOP rubric. Planning and finance need the list
    // and the grade to do their work, not the legal documents themselves.
    'partner.files',
    'vendor.create', 'vendor.edit',
    'partner.create', 'partner.edit', 'partner.delete',
    'score.commercial',
  ],
  qa: [
    ...READ_ALL,
    'partner.files',
    'vendor.analysis',
    'material.create', 'material.edit', 'material.delete',
    'score.qa',
  ],
  planning: [...READ_ALL, 'score.planning'],
  finance: [...READ_ALL, 'score.finance'],
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

/**
 * Expand one stored entry into the permissions it means today.
 *
 * A name that was retired keeps working through LEGACY_PERMISSIONS, so an
 * account whose override still says `material.write` keeps exactly the access
 * it had before the permission was split.
 */
function expandStored(entry: unknown): Permission[] {
  if (typeof entry !== 'string') return [];
  if ((ALL_PERMISSIONS as string[]).includes(entry)) return [entry as Permission];
  return LEGACY_PERMISSIONS[entry] ?? [];
}

/**
 * Read permissions did not exist when the first per-user overrides were stored,
 * so those lists name only writes. Reading them literally today would take the
 * whole application away from exactly the people an admin had bothered to
 * customise — they would keep `partner.edit` and lose the partner list it edits.
 *
 * A stored list that names no read at all is therefore treated as predating
 * them and given all of them — the SOP download included, since it was part of
 * "everyone can read the partners" too — the same "expand on read, migrate
 * nothing" approach that carried `material.write` through its split. Once an admin saves the
 * dialog again the list holds explicit reads and this no longer applies, which
 * is what makes a deliberate read-only account possible: it names at least one
 * read, so nothing is added to it.
 */
const READ_PERMISSIONS: Permission[] = ['vendor.read', 'material.read', 'partner.read', 'partner.files'];

function withLegacyReads(list: Permission[]): Permission[] {
  if (list.length === 0) return list;
  if (list.some(p => READ_PERMISSIONS.includes(p))) return list;
  return [...list, ...READ_PERMISSIONS];
}

function parseOverrides(raw: unknown): Permission[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const known = withLegacyReads([...new Set(raw.flatMap(expandStored))]);
  // An override list of only unrecognised entries is treated as no override
  // rather than as "nothing allowed", so a stale name cannot silently lock a
  // user out of everything.
  //
  // A list naming only retired permissions that expand to nothing — an override
  // of just `archive.read` — lands here too and falls back to the role, which is
  // the safe reading: that account was never actually restricted by it.
  return known.length > 0 ? ALL_PERMISSIONS.filter(p => known.includes(p)) : null;
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

/**
 * Keep only the recognised permissions from arbitrary input, without duplicates
 * and in a stable order. Retired names are expanded rather than dropped, so an
 * admin saving a form built from older data does not quietly revoke access.
 */
export function sanitizePermissions(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  const expanded = new Set(raw.flatMap(expandStored));
  return ALL_PERMISSIONS.filter(p => expanded.has(p));
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
