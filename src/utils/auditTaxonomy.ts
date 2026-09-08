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
  // Two modules the granular event vocabulary added (۱۴۰۵/۰۶/۱۷). Both record
  // things that had no trail at all: a file leaving the building, and a write
  // the server refused.
  'Data Export': 'خروجی و چاپ',
  Security: 'رویدادهای امنیتی',
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
  export: { label: 'بردن داده به بیرون (خروجی، چاپ، پشتیبان)', modules: ['Data Export'] },
  security: { label: 'تلاش‌های رد شده', modules: ['Security'] },
  system: { label: 'رویدادهای سیستمی', modules: ['System'] },
};

/** Stored `action` value → Persian label. Only actions the code really writes. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  Create: 'ایجاد رکورد',
  Update: 'ویرایش رکورد',
  Delete: 'حذف رکورد',
  // Three refusals, three names. All three used to be written as
  // `Delete - Blocked`, including the ones that refused a *creation* and an
  // *edit* — so the trail said a deletion had been stopped when nobody had
  // tried to delete anything. Older records keep the old value, which is why
  // its label stays here.
  'Delete - Blocked': 'حذف ناموفق (مسدودشده)',
  'Create - Blocked': 'ثبت ناموفق (مسدودشده)',
  'Update - Blocked': 'ویرایش ناموفق (مسدودشده)',
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
  // Written by PUT /api/source-selections — the "ثبت سورس منتخب" button in the
  // category views. Without these two the action filter showed the raw English.
  CREATE_SOURCE_SELECTION: 'ثبت سورس منتخب',
  UPDATE_SOURCE_SELECTION: 'تغییر سورس منتخب',
  Reject: 'رد کردن',
  Restore: 'بازگردانی',
  // Written only by the event vocabulary: a file leaving the building, and a
  // write the server refused.
  EXPORT: 'خروجی گرفتن',
  PRINT: 'چاپ',
  DOWNLOAD: 'دانلود فایل',
  ACCESS_DENIED: 'رد به دلیل نداشتن مجوز',
  // Historical only: written by a client-side audit call that has been removed
  // (it fired on a form field change, before any save). Kept so existing
  // records still render with a label instead of the raw English word.
  ChangeSupplier: 'تغییر فروشندهٔ سورس',
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

/* ------------------------------------------------------------------ *
 * The closed event vocabulary (۱۴۰۵/۰۶/۱۷)
 * ------------------------------------------------------------------ */

/**
 * Every act the application records, named once.
 *
 * The trail used to describe itself in free text: fifty call sites each wrote
 * their own Persian sentence, so «اطلاعات مستندات مرجع ماده دارویی … بروزرسانی
 * گردید.» sat next to «حذف تامین‌کننده "…"», and `module` was Persian in one
 * place and English in another. Two consequences, both measured on a live
 * server: a filter could only find what it already knew the exact wording of,
 * and one save wrote up to four rows that nothing tied together.
 *
 * So the unit of the trail is an *event*, not a table operation. Each name
 * below decides the module, the stored action, the severity and the sentence,
 * which means a new call site cannot invent its own vocabulary — it picks a
 * name from this list or it does not compile.
 */
export type AuditEvent =
  | 'auth.login' | 'auth.login_failed' | 'auth.logout' | 'auth.password_changed'
  | 'user.created' | 'user.updated' | 'user.deleted'
  | 'user.role_changed' | 'user.permissions_changed' | 'user.password_reset'
  | 'source.created' | 'source.updated' | 'source.scored'
  | 'source.disqualified' | 'source.reinstated' | 'source.deleted'
  | 'source.selected' | 'source.selection_changed'
  | 'sample.decided'
  | 'lab.result_added' | 'lab.result_removed'
  | 'risk.assessed'
  | 'material.created' | 'material.updated' | 'material.deleted'
  | 'material.spec_uploaded' | 'material.spec_removed' | 'material.status_changed'
  | 'partner.created' | 'partner.updated' | 'partner.deleted'
  | 'partner.evaluated' | 'partner.status_changed' | 'partner.document_downloaded'
  | 'data.exported' | 'data.printed' | 'data.backup_downloaded'
  | 'access.denied' | 'conflict.rejected';

/** One changed field, as it is stored. The Persian label is added on display. */
export interface FieldChange {
  field: string;
  from?: unknown;
  to?: unknown;
}

/** What the sentence builder is given. Everything is optional by design. */
export interface AuditEventContext {
  entityName?: string | null;
  changes?: FieldChange[];
  /** Named values for events that are not a field edit: a QC code, a row count. */
  facts?: Record<string, unknown>;
  reason?: string | null;
}

export interface AuditEventDef {
  /** Stored `module`, from `AUDIT_MODULE_LABELS` — never a new spelling. */
  module: string;
  /** Stored `entity_type`. */
  entityType: string;
  /** Stored `action`, from `AUDIT_ACTION_LABELS`, so old filters keep working. */
  action: string;
  severity: 'Information' | 'Warning' | 'Critical';
  result?: 'Success' | 'Failed' | 'Blocked';
  /** Short name for the filter list. */
  label: string;
  /**
   * Written even when nothing changed.
   *
   * The default is the opposite: an edit that changed no field writes no row.
   * A sign-in, a refusal or a download has no "changed field" to speak of, and
   * the fact that it happened is the whole record — those set this.
   */
  alwaysRecord?: boolean;
  sentence: (ctx: AuditEventContext) => string;
}

const named = (ctx: AuditEventContext, fallback: string) =>
  ctx.entityName ? `«${ctx.entityName}»` : fallback;

const fact = (ctx: AuditEventContext, key: string): string | null => {
  const value = ctx.facts?.[key];
  return value === undefined || value === null || value === '' ? null : String(value);
};

/** «از ۱۲ به ۱۸», or nothing when one side is missing. */
const shift = (ctx: AuditEventContext, field: string): string => {
  const change = (ctx.changes || []).find(c => c.field === field);
  if (!change) return '';
  const from = change.from === null || change.from === undefined || change.from === '' ? '—' : String(change.from);
  const to = change.to === null || change.to === undefined || change.to === '' ? '—' : String(change.to);
  return `${from} ← ${to}`;
};

const withReason = (text: string, ctx: AuditEventContext) =>
  ctx.reason ? `${text} — ${ctx.reason}` : text;

export const AUDIT_EVENTS: Record<AuditEvent, AuditEventDef> = {
  /* — احراز هویت — */
  'auth.login': {
    module: 'احراز هویت', entityType: 'Session', action: 'LOGIN',
    severity: 'Information', result: 'Success', label: 'ورود به سامانه', alwaysRecord: true,
    sentence: () => 'ورود به سامانه',
  },
  'auth.login_failed': {
    module: 'احراز هویت', entityType: 'Session', action: 'FAILED_LOGIN',
    severity: 'Warning', result: 'Failed', label: 'ورود ناموفق', alwaysRecord: true,
    sentence: ctx => withReason('ورود ناموفق', ctx),
  },
  'auth.logout': {
    module: 'احراز هویت', entityType: 'Session', action: 'LOGOUT',
    severity: 'Information', result: 'Success', label: 'خروج از سامانه', alwaysRecord: true,
    sentence: () => 'خروج از سامانه',
  },
  'auth.password_changed': {
    module: 'احراز هویت', entityType: 'User', action: 'RESET_PASSWORD',
    severity: 'Warning', label: 'تغییر رمز عبور', alwaysRecord: true,
    sentence: () => 'تغییر رمز عبور توسط خود کاربر',
  },

  /* — کاربران — */
  'user.created': {
    module: 'مدیریت کاربران', entityType: 'User', action: 'CREATE_USER',
    severity: 'Warning', label: 'ایجاد کاربر', alwaysRecord: true,
    sentence: ctx => `حساب کاربری ${named(ctx, 'تازه')} ایجاد شد`,
  },
  'user.updated': {
    module: 'مدیریت کاربران', entityType: 'User', action: 'UPDATE_USER',
    severity: 'Warning', label: 'ویرایش کاربر',
    sentence: ctx => `ویرایش حساب کاربری ${named(ctx, '')}`.trim(),
  },
  'user.deleted': {
    module: 'مدیریت کاربران', entityType: 'User', action: 'DELETE_USER',
    severity: 'Critical', label: 'حذف کاربر', alwaysRecord: true,
    sentence: ctx => `حساب کاربری ${named(ctx, '')} حذف شد`.replace('  ', ' '),
  },
  'user.role_changed': {
    module: 'مدیریت کاربران', entityType: 'User', action: 'ROLE_CHANGE',
    severity: 'Critical', label: 'تغییر سمت', alwaysRecord: true,
    sentence: ctx => `سمت سازمانی ${named(ctx, 'کاربر')}: ${shift(ctx, 'role') || 'تغییر کرد'}`,
  },
  'user.permissions_changed': {
    module: 'مدیریت کاربران', entityType: 'User', action: 'PERMISSION_CHANGE',
    severity: 'Critical', label: 'تغییر دسترسی', alwaysRecord: true,
    sentence: ctx => {
      const added = fact(ctx, 'added');
      const removed = fact(ctx, 'removed');
      const parts = [added && `${added} مجوز افزوده`, removed && `${removed} مجوز سلب`].filter(Boolean);
      return `سطح دسترسی ${named(ctx, 'کاربر')}${parts.length ? `: ${parts.join(' و ')}` : ' تغییر کرد'}`;
    },
  },
  'user.password_reset': {
    module: 'مدیریت کاربران', entityType: 'User', action: 'RESET_PASSWORD',
    severity: 'Critical', label: 'بازنشانی رمز', alwaysRecord: true,
    sentence: ctx => `بازنشانی رمز عبور ${named(ctx, 'کاربر')} توسط مدیر`,
  },

  /* — سورس‌ها — */
  'source.created': {
    module: 'Source Management', entityType: 'Source', action: 'Create',
    severity: 'Warning', label: 'ثبت سورس', alwaysRecord: true,
    sentence: ctx => `سورس ${named(ctx, 'تازه')} ثبت شد`,
  },
  'source.updated': {
    module: 'Source Management', entityType: 'Source', action: 'Update',
    severity: 'Warning', label: 'ویرایش سورس',
    sentence: ctx => `ویرایش ${ctx.changes?.length ?? 0} فیلد سورس ${named(ctx, '')}`.trim(),
  },
  'source.scored': {
    module: 'ارزیابی سورس‌ها', entityType: 'Score', action: 'Update',
    severity: 'Warning', label: 'امتیازدهی دپارتمان‌ها',
    sentence: ctx => {
      const sps = shift(ctx, 'totalSPS');
      const grade = shift(ctx, 'grade');
      const parts = [sps && `SPS ${sps}`, grade && `گرید ${grade}`].filter(Boolean);
      return `امتیازدهی سورس ${named(ctx, '')}${parts.length ? `: ${parts.join('، ')}` : ''}`.trim();
    },
  },
  'source.disqualified': {
    module: 'Source Management', entityType: 'Source', action: 'Reject',
    severity: 'Critical', label: 'رد صلاحیت سورس', alwaysRecord: true,
    sentence: ctx => withReason(`رد صلاحیت سورس ${named(ctx, '')} و انتقال به لیست سیاه`.trim(), ctx),
  },
  'source.reinstated': {
    module: 'Source Management', entityType: 'Source', action: 'Restore',
    severity: 'Critical', label: 'بازگردانی از لیست سیاه', alwaysRecord: true,
    sentence: ctx => withReason(`بازگردانی سورس ${named(ctx, '')} از لیست سیاه`.trim(), ctx),
  },
  'source.deleted': {
    module: 'Source Management', entityType: 'Source', action: 'Delete',
    severity: 'Critical', label: 'حذف سورس', alwaysRecord: true,
    sentence: ctx => withReason(`سورس ${named(ctx, '')} حذف شد`.trim(), ctx),
  },
  'source.selected': {
    module: 'Source Management', entityType: 'SourceSelection', action: 'CREATE_SOURCE_SELECTION',
    severity: 'Critical', label: 'ثبت سورس منتخب', alwaysRecord: true,
    sentence: ctx => withReason(`سورس منتخب ${fact(ctx, 'material') || 'ماده'}: ${ctx.entityName || '—'}`, ctx),
  },
  'source.selection_changed': {
    module: 'Source Management', entityType: 'SourceSelection', action: 'UPDATE_SOURCE_SELECTION',
    severity: 'Critical', label: 'تغییر سورس منتخب', alwaysRecord: true,
    sentence: ctx => withReason(
      `سورس منتخب ${fact(ctx, 'material') || 'ماده'} عوض شد: ${shift(ctx, 'vendorId') || ctx.entityName || '—'}`, ctx),
  },

  /* — نمونه و آزمایشگاه — */
  'sample.decided': {
    module: 'Source Management', entityType: 'Sample', action: 'Update',
    severity: 'Critical', label: 'تصمیم کیفی نمونه', alwaysRecord: true,
    sentence: ctx => withReason(
      `تصمیم نمونهٔ ${named(ctx, '')}: ${fact(ctx, 'verdict') || '—'}`.replace('  ', ' '), ctx),
  },
  'lab.result_added': {
    module: 'Laboratory', entityType: 'Laboratory Result', action: 'Create',
    severity: 'Warning', label: 'ثبت نتیجهٔ آزمایش', alwaysRecord: true,
    sentence: ctx => {
      const code = fact(ctx, 'qcCode');
      const decision = fact(ctx, 'decision');
      return `نتیجهٔ آزمایش${code ? ` ${code}` : ''} برای ${named(ctx, 'سورس')}${decision ? `: ${decision}` : ''} ثبت شد`;
    },
  },
  'lab.result_removed': {
    module: 'Laboratory', entityType: 'Laboratory Result', action: 'Delete',
    severity: 'Critical', label: 'حذف نتیجهٔ آزمایش', alwaysRecord: true,
    sentence: ctx => {
      const code = fact(ctx, 'qcCode');
      return `نتیجهٔ آزمایش${code ? ` ${code}` : ''} سورس ${named(ctx, '')} حذف شد`.replace('  ', ' ');
    },
  },

  /* — ریسک — */
  'risk.assessed': {
    module: 'Risk Assessment', entityType: 'Risk Assessment', action: 'Update',
    severity: 'Warning', label: 'ارزیابی ریسک',
    sentence: ctx => {
      const rpn = shift(ctx, 'rpn');
      const level = shift(ctx, 'riskLevel');
      const parts = [rpn && `RPN ${rpn}`, level && `سطح ${level}`].filter(Boolean);
      return `ارزیابی ریسک سورس ${named(ctx, '')}${parts.length ? `: ${parts.join('، ')}` : ''}`.trim();
    },
  },

  /* — مواد اولیه — */
  'material.created': {
    module: 'مدیریت مواد', entityType: 'Material', action: 'Create',
    severity: 'Warning', label: 'ثبت ماده', alwaysRecord: true,
    sentence: ctx => `مادهٔ اولیهٔ ${named(ctx, 'تازه')} ثبت شد`,
  },
  'material.updated': {
    module: 'مدیریت مواد', entityType: 'Material', action: 'Update',
    severity: 'Information', label: 'ویرایش ماده',
    sentence: ctx => `ویرایش ${ctx.changes?.length ?? 0} فیلد مادهٔ ${named(ctx, '')}`.trim(),
  },
  'material.deleted': {
    module: 'مدیریت مواد', entityType: 'Material', action: 'Delete',
    severity: 'Critical', label: 'حذف ماده', alwaysRecord: true,
    sentence: ctx => `مادهٔ اولیهٔ ${named(ctx, '')} حذف شد`.replace('  ', ' '),
  },
  'material.spec_uploaded': {
    module: 'مدیریت مواد', entityType: 'Material', action: 'Update',
    severity: 'Warning', label: 'بارگذاری فایل مشخصات', alwaysRecord: true,
    sentence: ctx => `فایل مشخصات مادهٔ ${named(ctx, '')} بارگذاری شد${fact(ctx, 'fileName') ? ` (${fact(ctx, 'fileName')})` : ''}`,
  },
  'material.spec_removed': {
    module: 'مدیریت مواد', entityType: 'Material', action: 'Delete',
    severity: 'Warning', label: 'حذف فایل مشخصات', alwaysRecord: true,
    sentence: ctx => `فایل مشخصات مادهٔ ${named(ctx, '')} حذف شد`.replace('  ', ' '),
  },
  'material.status_changed': {
    module: 'مدیریت مواد', entityType: 'Material', action: 'Update',
    severity: 'Warning', label: 'تغییر وضعیت ماده', alwaysRecord: true,
    sentence: ctx => `وضعیت مادهٔ ${named(ctx, '')}: ${shift(ctx, 'status') || 'تغییر کرد'}`,
  },

  /* — شرکای تجاری — */
  'partner.created': {
    module: 'Business Partner Repository', entityType: 'BusinessPartner', action: 'Create',
    severity: 'Warning', label: 'ثبت شریک تجاری', alwaysRecord: true,
    sentence: ctx => `شریک تجاری ${named(ctx, 'تازه')} ثبت شد`,
  },
  'partner.updated': {
    module: 'Business Partner Repository', entityType: 'BusinessPartner', action: 'Update',
    severity: 'Information', label: 'ویرایش شریک تجاری',
    sentence: ctx => `ویرایش ${ctx.changes?.length ?? 0} فیلد شریک ${named(ctx, '')}`.trim(),
  },
  'partner.deleted': {
    module: 'Business Partner Repository', entityType: 'BusinessPartner', action: 'Delete',
    severity: 'Critical', label: 'حذف شریک تجاری', alwaysRecord: true,
    sentence: ctx => `شریک تجاری ${named(ctx, '')} حذف شد`.replace('  ', ' '),
  },
  'partner.evaluated': {
    module: 'Business Partner Repository', entityType: 'SupplierEvaluation', action: 'Update',
    severity: 'Critical', label: 'ارزیابی فروشنده',
    sentence: ctx => {
      const score = shift(ctx, 'totalScore');
      const grade = shift(ctx, 'grade');
      const parts = [score && `امتیاز ${score}`, grade && `گرید ${grade}`].filter(Boolean);
      return `ارزیابی مدارک فروشندهٔ ${named(ctx, '')}${parts.length ? `: ${parts.join('، ')}` : ''}`.trim();
    },
  },
  'partner.status_changed': {
    module: 'Business Partner Repository', entityType: 'BusinessPartner', action: 'Update',
    severity: 'Critical', label: 'تغییر وضعیت شریک', alwaysRecord: true,
    sentence: ctx => withReason(`وضعیت شریک ${named(ctx, '')}: ${shift(ctx, 'status') || 'تغییر کرد'}`, ctx),
  },
  'partner.document_downloaded': {
    module: 'Business Partner Repository', entityType: 'SopDocument', action: 'DOWNLOAD',
    severity: 'Warning', label: 'دانلود مدرک SOP', alwaysRecord: true,
    sentence: ctx => `دانلود مدرک ${fact(ctx, 'document') || 'SOP'} شریک ${named(ctx, '')}`.trim(),
  },

  /* — بردن داده بیرون — */
  'data.exported': {
    module: 'Data Export', entityType: 'Export', action: 'EXPORT',
    severity: 'Warning', label: 'خروجی اکسل', alwaysRecord: true,
    sentence: ctx => {
      const rows = fact(ctx, 'rows');
      return `خروجی اکسل ${named(ctx, '')}${rows ? ` — ${rows} ردیف` : ''}`.trim();
    },
  },
  'data.printed': {
    module: 'Data Export', entityType: 'Export', action: 'PRINT',
    severity: 'Information', label: 'چاپ', alwaysRecord: true,
    sentence: ctx => `چاپ ${named(ctx, 'فرم')}`,
  },
  'data.backup_downloaded': {
    module: 'Data Export', entityType: 'Export', action: 'EXPORT',
    severity: 'Critical', label: 'دانلود پشتیبان', alwaysRecord: true,
    sentence: () => 'دانلود پشتیبان کل رکوردها',
  },

  /* — تلاش‌های ناکام — */
  'access.denied': {
    module: 'Security', entityType: 'Security Event', action: 'ACCESS_DENIED',
    severity: 'Critical', result: 'Blocked', label: 'رد به دلیل نداشتن مجوز', alwaysRecord: true,
    sentence: ctx => {
      const permission = fact(ctx, 'permission');
      return `تلاش ناموفق: ${fact(ctx, 'attempted') || 'عملیات'}${permission ? ` — مجوز لازم: ${permission}` : ''}`;
    },
  },
  'conflict.rejected': {
    module: 'Security', entityType: 'Security Event', action: 'ACCESS_DENIED',
    severity: 'Warning', result: 'Blocked', label: 'رد به دلیل نسخهٔ کهنه', alwaysRecord: true,
    sentence: ctx => `ذخیرهٔ ${named(ctx, 'رکورد')} رد شد: نسخهٔ روی صفحه قدیمی بود`,
  },
};

/** Every event name, for the filter list and for the vocabulary tests. */
export const ALL_AUDIT_EVENTS = Object.keys(AUDIT_EVENTS) as AuditEvent[];

/** Persian sentence for one recorded event. */
export function describeEvent(event: AuditEvent, ctx: AuditEventContext = {}): string {
  return AUDIT_EVENTS[event].sentence(ctx);
}

/**
 * Persian name for an audit field key (fallback: the raw key).
 *
 * Lives here rather than in the trail page because both sides need it now: the
 * page labels the stored `changes`, and `recordEvent` decides which keys are
 * worth naming at all. One map means a field cannot be «کشور» on screen and an
 * unexplained `country` in an export.
 */
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  // Collections. These are compared item by item (see computeFieldDiff), so the
  // label names the collection and the value names what actually moved.
  activityLogs: 'سابقهٔ فعالیت', analysisRecords: 'نتایج آزمایشگاهی',
  documents: 'مدارک', sopDocuments: 'مدارک', permissions: 'دسترسی‌ها',
  riskAssessment: 'ارزیابی ریسک', evaluation: 'ارزیابی فروشنده',
  // Accounts and partners.
  isActive: 'وضعیت فعال بودن', email: 'ایمیل', phone: 'تلفن', city: 'شهر',
  address: 'آدرس', website: 'وبسایت', contactPerson: 'مسئول تماس', type: 'نوع شریک',
  // Sources.
  supplierId: 'فروشنده', manufacturerId: 'تولیدکننده', isSample: 'نمونه',
  ircExpiryDate: 'انقضای IRC', lastAudit: 'تاریخ صدور IRC', registrationDate: 'تاریخ ثبت',
  materialId: 'مادهٔ مرتبط', comments: 'توضیحات', recordedBy: 'ثبت‌کنندهٔ نتیجه',
  action: 'اقدام', user: 'کاربر', file: 'فایل', fileName: 'نام فایل',
  status: 'وضعیت', grade: 'گرید', name: 'نام', nameEn: 'نام لاتین', country: 'کشور',
  material: 'ماده', materialEn: 'ماده (لاتین)', cas: 'CAS', irc: 'IRC', category: 'دسته',
  contactInfo: 'اطلاعات تماس', totalSPS: 'امتیاز SPS', scores: 'نمرات', riskLevel: 'سطح ریسک',
  riskScore: 'RPN', sri: 'SRI', decision: 'تصمیم', deviationReason: 'انحراف', qcCode: 'کد QC',
  evaluator: 'ارزیاب', role: 'نقش', username: 'نام کاربری', mustChangePassword: 'اجبار تغییر رمز',
  initialSampleStatus: 'وضعیت اولیهٔ نمونه', rejectionReasons: 'دلایل رد', totalScore: 'امتیاز کل',
  // Source selection (PUT /api/source-selections) and risk assessment.
  vendorId: 'سورس منتخب', materialKey: 'ماده', reason: 'دلیل انتخاب', decidedBy: 'تصمیم‌گیرنده',
  rpn: 'RPN', SRI: 'SRI', materialCriticality: 'بحرانیت ماده', detectability: 'قابلیت تشخیص',
  probability: 'احتمال وقوع', sps: 'امتیاز SPS', date: 'تاریخ',
  commercialScore: 'امتیاز بازرگانی', qualityScore: 'امتیاز کیفی',
  planningScore: 'امتیاز برنامه‌ریزی', financeScore: 'امتیاز مالی',
};
