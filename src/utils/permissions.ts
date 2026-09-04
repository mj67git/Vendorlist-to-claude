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
  /**
   * Record the chosen source for a material — the decision, not the data.
   *
   * Separate from `vendor.edit` because they are different acts: editing keeps
   * a record accurate, choosing says which supplier the company buys this
   * material from, carries a mandatory reason and is what an inspector asks
   * about. Under one permission, anyone who could fix a phone number could
   * also change the winning source of a material.
   */
  | 'vendor.select'
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
  /**
   * Take data out of the system: the Excel exports and the printable forms.
   *
   * A house rule, and honest about being one. Every export is assembled in the
   * browser from data the account can already read — the archive sheet from the
   * source list, the audit sheet from records the trail already returned — so
   * no endpoint can enforce this the way `vendor.create` is enforced. What it
   * does is stop a file leaving the building by accident from a screen someone
   * opened to look something up, which is what the request was.
   *
   * It is a real setting rather than a hard-coded `role === 'admin'` test for
   * the usual reason: an administrator can hand it to the one person who
   * prepares the regulator's pack without making them an administrator.
   */
  | 'data.export'
  /** Read the audit trail. */
  | 'audit.read'
  /** Administer user accounts, including their permissions. */
  | 'users.manage';

/** Departments that carry an evaluation score. */
export const SCORING_DEPARTMENTS = ['commercial', 'qa', 'planning', 'finance'] as const;
export type ScoringDepartment = (typeof SCORING_DEPARTMENTS)[number];

/** Every permission there is, in the order the admin screen groups them. */
export const ALL_PERMISSIONS: Permission[] = [
  'vendor.read', 'vendor.create', 'vendor.edit', 'vendor.delete', 'vendor.select',
  'material.read', 'material.create', 'material.edit', 'material.delete',
  'partner.read', 'partner.create', 'partner.edit', 'partner.delete', 'partner.files',
  'vendor.analysis', 'vendor.risk',
  'score.commercial', 'score.qa', 'score.planning', 'score.finance',
  'data.export', 'audit.read', 'users.manage',
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
  'vendor.select': 'ثبت سورس منتخب هر ماده',
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
  'data.export': 'خروجی اکسل و چاپ (PDF)',
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
   * This module has no permission of its own: it is a view over another
   * module's data and follows that module's permission.
   *
   * The dialog shows it as a locked tick that reflects the permission it
   * follows, so an administrator can see that the page is reachable without
   * being offered a switch that would do nothing. A separate permission here
   * would be the mistake `archive.read` was deleted for: no endpoint could
   * enforce it, because both pages read `GET /api/vendors` like every other
   * source view.
   */
  derivedFrom?: Permission;
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
    key: 'selection',
    title: 'انتخاب سورس منتخب',
    single: 'vendor.select',
    actions: { view: 'vendor.read', create: 'vendor.select', edit: 'vendor.select', delete: null },
    note: 'تصمیم «این ماده از کدام سورس خریداری می‌شود» با دلیل الزامی ثبت می‌شود و روی همان رکورد به‌روزرسانی می‌گردد، پس ثبت و ویرایش یکی است و حذفی ندارد. مشاهدهٔ تصمیم همان «مشاهدهٔ سورس‌ها» است.',
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
    key: 'archive',
    title: 'آرشیو کامل داده‌ها',
    derivedFrom: 'vendor.read',
    actions: { view: null, create: null, edit: null, delete: null },
    note: 'آرشیو، نمایی از همان سورس‌هاست و مجوز جدا ندارد؛ با «مشاهدهٔ سورس‌ها» باز می‌شود. خروجی اکسل و چاپ فهرست هم همان داده را می‌دهند، پس محدودکردنشان جداگانه معنا ندارد.',
  },
  {
    key: 'supplier-audit',
    title: 'بررسی یکپارچه تأمین‌کنندگان',
    derivedFrom: 'vendor.read',
    actions: { view: null, create: null, edit: null, delete: null },
    note: 'این نما سورس‌ها را بر اساس شرکت گروه‌بندی می‌کند و داده‌ای جز همان‌ها ندارد، پس از «مشاهدهٔ سورس‌ها» پیروی می‌کند. امتیازهای نمایش‌داده‌شده تابع دپارتمان‌هایی است که کاربر اجازهٔ امتیازدهی‌شان را دارد.',
  },
  {
    key: 'export',
    title: 'خروجی و چاپ',
    single: 'data.export',
    actions: { view: 'data.export', create: 'data.export', edit: 'data.export', delete: 'data.export' },
    note: 'خروجی اکسل همهٔ ماژول‌ها و چاپ فرم‌ها و فهرست‌ها (PDF). دادهٔ خروجی همان چیزی است که کاربر روی صفحه می‌بیند، پس این تنظیم بردن فایل به بیرون را محدود می‌کند، نه دیدن داده را.',
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
  derived: 'این نما مجوز جداگانه ندارد و از مجوز ماژولی که داده‌اش را نشان می‌دهد پیروی می‌کند.',
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
 * `data.export` is in no working template. Taking a file out of the system is
 * an administrator's act by default; an administrator can still grant it to one
 * person, which is what per-user exceptions are for.
 *
 * `lab` used to hold nothing at all — an account with that role saw no page in
 * the application while the user form still offered the role. It now carries
 * the reads and `vendor.analysis`, which is the QC bench's actual work.
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
    // Commercial buys the material, so commercial records which source it is
    // bought from. QA grades and analyses; it does not place the order.
    'vendor.select',
    'partner.create', 'partner.edit', 'partner.delete',
    'score.commercial',
  ],
  qa: [
    ...READ_ALL,
    'partner.files',
    'vendor.analysis',
    // FMEA risk assessment is a quality activity and belongs with the rest of
    // QA's work. It used to sit with `admin` alone while the UI still offered
    // QA the risk form and a "ریسک ثبت‌نشده" backlog, so every quality user who
    // opened that backlog was refused by the server — the screen and the
    // endpoint disagreed, which is the exact failure this policy table exists
    // to prevent (rule 14).
    'vendor.risk',
    'material.create', 'material.edit', 'material.delete',
    'score.qa',
  ],
  planning: [...READ_ALL, 'score.planning'],
  finance: [...READ_ALL, 'score.finance'],
  /**
   * The QC bench: sees what it tests, records the result, changes nothing else.
   *
   * This template used to be empty, so every account with this role could open
   * no page at all while the form still offered the role — a trap for whoever
   * created the next laboratory account. It holds the reads and
   * `vendor.analysis`, which is exactly the work: the results are entered
   * against a source, so the source list has to be visible. No `partner.files`
   * — the bench does not need a supplier's legal papers to run a test.
   */
  lab: [...READ_ALL, 'vendor.analysis'],
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
 * A stored exception list is read literally.
 *
 * It was not always: read permissions arrived after per-user lists already
 * existed, so old rows name writes and no reads, and `effectivePermissions`
 * used to hand the reads back to any list that had none. That heuristic could
 * not tell an old row from a deliberate restriction — an administrator who
 * turned every module off and left only the department's scoring tick got the
 * reads back silently, and the dialog showed their change as if it had never
 * been saved. Migration 20260903120000 expands the rows the heuristic was
 * written for, once, so from here a list means what it says.
 */
function parseOverrides(raw: unknown): Permission[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const known = [...new Set(raw.flatMap(expandStored))];
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
