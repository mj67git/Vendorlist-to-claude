import React, { useMemo } from 'react';
import { Award, Calendar, ClipboardList, ShieldAlert } from 'lucide-react';
import { BusinessPartner, User, Vendor } from '../../types';
import type { TaskKey } from '../../utils/navRoutes';
import { EntityName } from '../EntityName';
import { GradeBadge } from '../GradeBadge';
import { categoryLabels } from '../../constants/categories';
import { can } from '../../utils/permissions';
import { checkLicenseExpiry } from '../../utils/vendorUtils';

/**
 * The worklist behind the dashboard's four pending-action counters.
 *
 * The dashboard used to jump straight into the *first* record of a backlog,
 * which told the user nothing about what else was waiting or which of the
 * twelve they had just landed on. It also rendered the expiring-licence list
 * inline, so the busier the backlog got the more the dashboard filled up —
 * exactly backwards, since a dashboard should summarise and hand off.
 *
 * One page with four tabs rather than four pages: the interaction is identical
 * in each, and someone clearing a backlog usually moves between them in one
 * sitting. Each tab is its own address (`#/tasks/risk`), so a colleague can be
 * sent straight to a backlog.
 *
 * Acting on a row pushes the record onto the navigation stack, so Back returns
 * here with the list still in place, ready for the next one.
 */

export interface WorklistItem {
  /** Stable key for React and for the row's identity. */
  id: string;
  vendor?: Vendor;
  partner?: BusinessPartner;
  title: string;
  subtitle: string;
  /** Right-hand status chip. */
  note?: string;
  tone?: 'neutral' | 'warn' | 'danger';
  /** Lower sorts first — used to put the most urgent row at the top. */
  order: number;
}

export const TASK_META: Record<TaskKey, {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** What the user needs in order to act on a row here. */
  permission: Parameters<typeof can>[1] | null;
  /** Shown when the user may look but not act. */
  readOnlyNote: string;
}> = {
  eval: {
    label: 'سورس‌های ارزیابی‌نشده',
    description: 'سورس‌هایی که هنوز هیچ گرید کیفی نگرفته‌اند. با کلیک روی هر ردیف وارد پروندهٔ آن سورس می‌شوید تا امتیازدهی را شروع کنید.',
    icon: ClipboardList,
    permission: null,
    readOnlyNote: '',
  },
  risk: {
    label: 'ریسک ثبت‌نشده',
    description: 'سورس‌هایی که ارزیابی ریسک (FMEA) ندارند. ارزیابی ریسک در تب مخصوص خودش در پروندهٔ سورس ثبت می‌شود.',
    icon: ShieldAlert,
    permission: 'vendor.risk',
    readOnlyNote: 'شما مجوز ثبت ارزیابی ریسک ندارید؛ این فهرست فقط برای مشاهده است.',
  },
  sop: {
    label: 'ارزیابی SOP معوق فروشندگان',
    description: 'فروشندگانی که مدارک SOP آن‌ها هنوز ارزیابی نشده است. با کلیک روی هر ردیف وارد مخزن شرکای تجاری می‌شوید.',
    icon: Award,
    permission: 'partner.edit',
    readOnlyNote: 'شما مجوز ویرایش شرکای تجاری ندارید؛ این فهرست فقط برای مشاهده است.',
  },
  irc: {
    label: 'IRC نزدیک انقضا یا منقضی',
    description: 'مجوزهایی که کمتر از دو ماه تا انقضا دارند یا تاریخشان گذشته است. مرتب‌شده از فوری‌ترین.',
    icon: Calendar,
    permission: 'vendor.edit',
    readOnlyNote: 'شما مجوز ویرایش سورس ندارید؛ این فهرست فقط برای مشاهده است.',
  },
};

/**
 * The four backlogs, derived in one place so the dashboard counter and this
 * list can never disagree about what is outstanding.
 */
export function buildWorklist(
  key: TaskKey,
  db: Vendor[],
  partners: BusinessPartner[],
): WorklistItem[] {
  const realVendors = db.filter(v => !v.isSample && v.category !== 'sample');

  if (key === 'eval') {
    return realVendors
      .filter(v => v.status !== 'rejected' && !(v.grade === 'A' || v.grade === 'B' || v.grade === 'C'))
      .map(v => ({
        id: v.id,
        vendor: v,
        title: v.name,
        subtitle: v.material || 'بدون ماده',
        note: categoryLabels[v.category as keyof typeof categoryLabels]?.fa || v.category,
        tone: 'neutral' as const,
        order: 0,
      }));
  }

  if (key === 'risk') {
    return realVendors
      .filter(v => v.status !== 'rejected' && !v.riskAssessment)
      .map(v => ({
        id: v.id,
        vendor: v,
        title: v.name,
        subtitle: v.material || 'بدون ماده',
        note: v.grade ? `گرید ${v.grade}` : 'بدون گرید',
        tone: 'neutral' as const,
        order: 0,
      }));
  }

  if (key === 'sop') {
    return partners
      .filter(p => p.type === 'Supplier' && (!p.evaluation || p.evaluation.grade === 'Not Evaluated'))
      .map(p => ({
        id: p.id,
        partner: p,
        title: p.name,
        subtitle: p.nameEn || p.country || 'بدون اطلاعات تکمیلی',
        note: p.evaluation ? 'ارزیابی ناقص' : 'ارزیابی نشده',
        tone: 'warn' as const,
        order: 0,
      }));
  }

  // irc — most urgent first, expired above merely expiring.
  return realVendors
    .map(v => ({ v, check: checkLicenseExpiry(v.ircExpiryDate) }))
    .filter(({ check }) => check.status === 'expired' || check.status === 'expiring_soon')
    .map(({ v, check }) => ({
      id: v.id,
      vendor: v,
      title: v.name,
      subtitle: v.material || 'بدون ماده',
      note: check.status === 'expired'
        ? 'منقضی شده'
        : `${check.daysLeft} روز مانده`,
      tone: check.status === 'expired' ? ('danger' as const) : ('warn' as const),
      // Expired (negative days) sorts above soon-to-expire.
      order: check.status === 'expired' ? -1000 : (check.daysLeft ?? 0),
    }))
    .sort((a, b) => a.order - b.order);
}

const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  warn: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800',
  danger: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800',
};

interface WorklistViewProps {
  taskKey: TaskKey;
  db: Vendor[];
  partners: BusinessPartner[];
  currentUser: User | null;
  onSelectVendor: (vendor: Vendor) => void;
  onNavigate: (view: string) => void;
  onSwitchTask: (key: TaskKey) => void;
}

export function WorklistView({
  taskKey, db, partners, currentUser, onSelectVendor, onNavigate, onSwitchTask,
}: WorklistViewProps) {
  const meta = TASK_META[taskKey];
  const items = useMemo(() => buildWorklist(taskKey, db, partners), [taskKey, db, partners]);
  const counts = useMemo(() => ({
    eval: buildWorklist('eval', db, partners).length,
    risk: buildWorklist('risk', db, partners).length,
    sop: buildWorklist('sop', db, partners).length,
    irc: buildWorklist('irc', db, partners).length,
  }), [db, partners]);

  const mayAct = meta.permission === null || can(currentUser, meta.permission);

  const openItem = (item: WorklistItem) => {
    if (item.vendor) {
      // The record is pushed onto the stack, so Back comes straight back here
      // with the rest of the backlog still listed.
      const full = db.find(v => v.id === item.vendor!.id) || item.vendor;
      onSelectVendor(full);
      return;
    }
    if (item.partner) onNavigate('business-partners');
  };

  return (
    <div className="space-y-6 fade-in text-right">
      <div className="border-b border-border pb-4">
        <h2 className="text-2xl font-black text-foreground mb-1 flex items-center justify-end gap-3">
          کارتابل اقدامات
          <ClipboardList className="w-6 h-6 text-primary" />
        </h2>
        <p className="text-sm text-muted-foreground">
          کارهای معوق، دسته‌بندی‌شده. با کلیک روی هر ردیف وارد پروندهٔ همان مورد می‌شوید و پس از ثبت، با «برگشت» به همین فهرست بازمی‌گردید.
        </p>
      </div>

      {/* Tabs — each is its own address, so a backlog can be linked directly. */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TASK_META) as TaskKey[]).map(k => {
          const m = TASK_META[k];
          const active = k === taskKey;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSwitchTask(k)}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:bg-accent'
              }`}
            >
              <m.icon className="w-3.5 h-3.5 shrink-0" />
              <span>{m.label}</span>
              <span className={`font-mono tabular-nums text-[11px] px-1.5 rounded-md ${
                active ? 'bg-primary-foreground/20' : 'bg-muted'
              }`}>
                {counts[k]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-muted/40">
          <p className="text-[11px] text-muted-foreground leading-relaxed">{meta.description}</p>
          {!mayAct && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 font-bold mt-1.5">{meta.readOnlyNote}</p>
          )}
        </div>

        {items.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">این فهرست خالی است.</p>
            <p className="text-xs text-muted-foreground mt-1">هیچ مورد معوقی در این دسته باقی نمانده است.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className="w-full text-right px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-accent transition-colors cursor-pointer"
                >
                  <span className="min-w-0 flex-1">
                    <EntityName name={item.title} lines={2} className="text-sm font-bold text-foreground" />
                    <EntityName name={item.subtitle} lines={1} className="text-[11px] text-muted-foreground mt-0.5" />
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {item.vendor?.grade && taskKey === 'eval' && (
                      <GradeBadge grade={item.vendor.grade as any} status={item.vendor.status as any} />
                    )}
                    {item.note && (
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${TONE_CLASSES[item.tone || 'neutral']}`}>
                        {item.note}
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-primary">رسیدگی ←</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
