/**
 * The vocabulary of the audit trail, in one place.
 *
 * `audit_log.module`, `.action` and `.severity` are free-text columns, so the
 * only thing that makes a filter work is that the value the form sends is
 * byte-identical to the value `server.ts` wrote. The filter form used to carry
 * its own hand-written list of Persian module names — none of which the server
 * ever writes — so six of the seven module options matched nothing at all, and
 * the severity option `Info` matched nothing either because the server writes
 * `Information`.
 *
 * Both `server.ts` and `AuditTrailView` import from here, exactly as they both
 * import the permission matrix, so the two can no longer drift apart. When a
 * new `AuditService.log({ module: … })` call site is added, add the module
 * here too, otherwise it will be invisible to the module filter.
 */

/** Stored `module` value → what the user should see. */
export const AUDIT_MODULE_LABELS: Record<string, string> = {
  'Source Management': 'مدیریت سورس‌ها',
  'Supplier Management': 'مدیریت تأمین‌کنندگان',
  'ارزیابی سورس‌ها': 'ارزیابی و امتیازدهی سورس',
  'Risk Assessment': 'ارزیابی ریسک (FMEA)',
  'Risk Management': 'مدیریت ریسک',
  Laboratory: 'آزمایشگاه کنترل کیفیت',
  'Business Partner Repository': 'مخزن شرکای تجاری',
  'مدیریت مواد': 'مخزن مواد اولیه',
  'مدیریت کاربران': 'مدیریت کاربران',
  'احراز هویت': 'احراز هویت',
  System: 'سیستم',
};

/**
 * A coarser grain above the module filter: four buckets an auditor actually
 * asks for ("show me everything security-related"), each defined as a concrete
 * set of stored module values so the server can enforce it with `module IN (…)`.
 *
 * This replaces the old `eventType` filter, which the PostgreSQL read path
 * ignored outright — `eventType` is not a column, it is a key buried inside the
 * `after_data` JSON, and it is absent on most records. The form offered a
 * `Security` group that nothing ever writes, and omitted `Data Change`, which
 * is the most common one. Selecting a group silently returned the unfiltered
 * list, which in a GxP audit trail is worse than having no filter.
 */
export const AUDIT_EVENT_GROUPS: Record<string, { label: string; modules: string[] }> = {
  data: {
    label: 'دادهٔ کیفی (سورس، شریک، ماده، آزمایشگاه، ریسک)',
    modules: [
      'Source Management',
      'Supplier Management',
      'ارزیابی سورس‌ها',
      'Risk Assessment',
      'Risk Management',
      'Laboratory',
      'Business Partner Repository',
      'مدیریت مواد',
    ],
  },
  auth: { label: 'احراز هویت (ورود و خروج)', modules: ['احراز هویت'] },
  access: { label: 'کاربران و سطوح دسترسی', modules: ['مدیریت کاربران'] },
  system: { label: 'رویدادهای سیستمی', modules: ['System'] },
};

/** Stored `action` value → Persian label. Only actions the code really writes. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  Create: 'ایجاد رکورد',
  Update: 'ویرایش رکورد',
  Delete: 'حذف رکورد',
  'Delete - Blocked': 'حذف ناموفق (مسدودشده)',
  'System Update': 'به‌روزرسانی خودکار سیستم',
  'System Calculation': 'محاسبهٔ خودکار سیستم',
  LOGIN: 'ورود موفق',
  LOGOUT: 'خروج از سیستم',
  FAILED_LOGIN: 'ورود ناموفق',
  CREATE_USER: 'ایجاد کاربر',
  UPDATE_USER: 'ویرایش کاربر',
  DELETE_USER: 'حذف کاربر',
  ROLE_CHANGE: 'تغییر سمت (Role)',
  PERMISSION_CHANGE: 'تغییر دسترسی',
  RESET_PASSWORD: 'بازنشانی رمز عبور',
};

/**
 * `Info` and `Information` are the same level: the server writes `Information`,
 * while the local demo store and the older records write `Info`. Filtering on
 * either must return both, otherwise "عادی" looks empty on a live database.
 */
export const SEVERITY_ALIASES: Record<string, string[]> = {
  Information: ['Information', 'Info'],
  Warning: ['Warning'],
  Critical: ['Critical'],
};

/** All stored spellings that the given selection should match. */
export function severityMatches(selected: string): string[] {
  return SEVERITY_ALIASES[selected] || [selected];
}
