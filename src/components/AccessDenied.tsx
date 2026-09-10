import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from './ui/button';
import { categoryLabels } from '../constants/categories';

/**
 * What a module shows to someone who may not read it.
 *
 * Reading became a permission, so "the page is empty" and "you are not allowed
 * to see this" had to stop looking alike: an empty repository and a revoked one
 * rendered the same blank table, and the failed request read as a network
 * error.
 *
 * Nine places refused, and eight of them used this component while the audit
 * trail hand-built its own panel — hardcoded rose colours with no dark variant,
 * a different heading, none of the shared wording. The gate was real; only the
 * screen disagreed with the other eight. The wording lives in one table now, so
 * the next refusal cannot invent an eleventh voice.
 */
export const AccessDenied: React.FC<{ title: string; detail: string; onHome: () => void }> = ({ title, detail, onHome }) => (
  <div className="max-w-xl mx-auto my-12 p-8 bg-card border border-border rounded-2xl text-center space-y-4 shadow-xs">
    <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300 flex items-center justify-center mx-auto">
      <ShieldAlert className="w-6 h-6" />
    </div>
    <h2 className="text-base font-black text-foreground">{title}</h2>
    <p className="text-xs text-muted-foreground leading-relaxed font-medium">{detail}</p>
    <p className="text-2xs text-muted-foreground">
      برای دریافت دسترسی با مدیر سیستم تماس بگیرید؛ سطح دسترسی هر کاربر در «مدیریت کاربران» تنظیم می‌شود.
    </p>
    <Button onClick={onHome} className="text-xs font-bold">
      بازگشت به صفحه اصلی
    </Button>
  </div>
);

/** Every refusal the application can show, by what was refused. */
export const ACCESS_DENIED_MESSAGES = {
  sources: {
    title: 'عدم دسترسی به اطلاعات سورس‌ها',
    detail: 'حساب کاربری شما مجوز مشاهدهٔ سورس‌ها و تأمین‌کنندگان را ندارد.',
  },
  archive: {
    title: 'عدم دسترسی به آرشیو کامل داده‌ها',
    detail: 'حساب کاربری شما مجوز باز کردن آرشیو کامل را ندارد.',
  },
  'supplier-audit': {
    title: 'عدم دسترسی به بررسی یکپارچه تأمین‌کنندگان',
    detail: 'حساب کاربری شما مجوز باز کردن این نما را ندارد.',
  },
  materials: {
    title: 'عدم دسترسی به مخزن مواد اولیه',
    detail: 'حساب کاربری شما مجوز مشاهدهٔ مخزن مواد اولیه را ندارد.',
  },
  'business-partners': {
    title: 'عدم دسترسی به مخزن شرکای تجاری',
    detail: 'حساب کاربری شما مجوز مشاهدهٔ شرکای تجاری و ارزیابی فروشندگان را ندارد.',
  },
  'audit-trail': {
    title: 'عدم دسترسی به ردیابی تغییرات',
    detail: 'مشاهدهٔ سابقهٔ ممیزی و فعالیت کاربران، طبق سیاست‌های GMP، تنها با مجوز «مشاهدهٔ ردیابی تغییرات» ممکن است.',
  },
  users: {
    title: 'عدم دسترسی به مدیریت کاربران',
    detail: 'تعریف و تغییر دسترسی پرسنل تنها در اختیار دارندگان مجوز «مدیریت کاربران» است.',
  },
  'source-create': {
    title: 'عدم دسترسی به ثبت سورس',
    detail: 'حساب کاربری شما مجوز «ثبت سورس جدید» را ندارد. این مجوز در ماژول مدیریت کاربران، ستون «ثبت» ردیف سورس‌ها تعیین می‌شود.',
  },
  'source-edit': {
    title: 'عدم دسترسی به ویرایش سورس',
    detail: 'حساب کاربری شما مجوز «ویرایش سورس» را ندارد.',
  },
} as const;

export type AccessDeniedReason = keyof typeof ACCESS_DENIED_MESSAGES;

/** The refusal for a named module. */
export function PermissionDenied({ reason, onHome }: { reason: AccessDeniedReason; onHome: () => void }) {
  const { title, detail } = ACCESS_DENIED_MESSAGES[reason];
  return <AccessDenied title={title} detail={detail} onHome={onHome} />;
}

/**
 * The refusal for one category page, which names the category.
 *
 * Samples and the blacklist are registers of their own with their own read, and
 * the server does not send their rows to an account without it — so the message
 * says that, rather than implying the register is empty.
 */
export function CategoryDenied({ categoryId, onHome }: { categoryId: string; onHome: () => void }) {
  const label = categoryLabels[categoryId as keyof typeof categoryLabels]?.fa ?? categoryId;
  return (
    <AccessDenied
      title={`عدم دسترسی به دستهٔ «${label}»`}
      detail="حساب کاربری شما مجوز مشاهدهٔ این دسته را ندارد؛ ردیف‌های آن اصلاً برای این حساب فرستاده نمی‌شوند."
      onHome={onHome}
    />
  );
}
