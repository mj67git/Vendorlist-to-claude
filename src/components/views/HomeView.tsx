import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Award, Calendar, ChevronLeft, ClipboardList, History, Microscope, PieChart as PieChartIcon, Plus, ShieldAlert } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { EntityName } from '../../components/EntityName';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { categoryLabels } from '../../constants/categories';
import { can } from '../../utils/permissions';
import { authFetch, isLocalMode } from '../../services/authFetch';
import { readLocalAudit } from '../../services/localAudit';
import { BusinessPartner, Category, Material, User, Vendor } from '../../types';
import { isVendorRejected } from '../../utils/vendorState';
import { checkLicenseExpiry } from '../../utils/vendorUtils';
import { categoryCardStyles } from '../../constants/categoryCardStyles';

// extracted from App.tsx

export function HomeView({ db, onNavigate, onSelectVendor, onAddVendor, currentUser, onDownloadBackup, materials, onAddMaterial, partners = [], onAddPartner, onOpenSourceForm }: { db: Vendor[], onNavigate: any, onSelectVendor: any, onAddVendor: (v: Vendor) => void, currentUser: User, onDownloadBackup?: () => void, materials: Material[], onAddMaterial: (m: Material) => void, partners?: BusinessPartner[], onAddPartner?: (p: BusinessPartner) => void, onOpenSourceForm: () => void }) {
  /**
   * The supplier population, excluding sample records.
   *
   * `stats` used to count `db` outright while the pending-actions panel below
   * deliberately filtered samples out, so the same screen showed two different
   * definitions of "supplier" without saying so.
   */
  const sourceVendors = useMemo(
    () => db.filter(v => !v.isSample && v.category !== 'sample'),
    [db],
  );
  const sampleCount = db.length - sourceVendors.length;

  const stats = useMemo(() => {
    const rejected = sourceVendors.filter(isVendorRejected).length;
    const gradeA = sourceVendors.filter(v => !isVendorRejected(v) && v.grade === 'A').length;
    const gradeB = sourceVendors.filter(v => !isVendorRejected(v) && v.grade === 'B').length;
    const gradeC = sourceVendors.filter(v => !isVendorRejected(v) && v.grade === 'C').length;
    return {
      total: sourceVendors.length,
      gradeA, gradeB, gradeC, rejected,
      // The five cards used to add up to two thirds of the population and stop
      // there, silently dropping every source that has no grade yet — while the
      // donut right beside them showed exactly that slice.
      ungraded: sourceVendors.length - gradeA - gradeB - gradeC - rejected,
    };
  }, [sourceVendors]);

  const rejectedVendors = db.filter(isVendorRejected);

  const expiringVendors = useMemo(() => {
    return db
      .filter(v => !!v.ircExpiryDate && v.ircExpiryDate.trim() !== '' && v.ircExpiryDate.trim().toLowerCase() !== 'n/a')
      .map(v => ({
        vendor: v,
        check: checkLicenseExpiry(v.ircExpiryDate)
      }))
      .filter(item => item.check.status === 'expiring_soon' || item.check.status === 'expired')
      .sort((a, b) => (a.check.daysLeft || 0) - (b.check.daysLeft || 0));
  }, [db]);

  // Grade distribution for the donut (semantic ordinal grade colours).
  const gradeDistribution = useMemo(() => [
      { name: 'گرید A', value: stats.gradeA, color: '#10b981' },
      { name: 'گرید B', value: stats.gradeB, color: '#3b82f6' },
      { name: 'گرید C', value: stats.gradeC, color: '#f59e0b' },
      { name: 'لیست سیاه', value: stats.rejected, color: '#e11d48' },
      { name: 'بدون گرید', value: stats.ungraded, color: '#94a3b8' },
    ].filter(d => d.value > 0), [stats]);

  // Pending-actions center: real, actionable quality gaps.
  const pendingActions = useMemo(() => {
    const realVendors = sourceVendors;
    const notEvaluated = realVendors.filter(v => v.status !== 'rejected' && !(v.grade === 'A' || v.grade === 'B' || v.grade === 'C'));
    const noRisk = realVendors.filter(v => v.status !== 'rejected' && !v.riskAssessment);
    const sopPending = (partners || []).filter(p => p.type === 'Supplier' && (!p.evaluation || p.evaluation.grade === 'Not Evaluated'));
    return [
      { key: 'eval', label: 'سورس‌های ارزیابی‌نشده', count: notEvaluated.length, icon: ClipboardList, tone: 'amber' },
      { key: 'risk', label: 'ریسک ثبت‌نشده', count: noRisk.length, icon: ShieldAlert, tone: 'orange' },
      { key: 'sop', label: 'ارزیابی SOP معوق فروشندگان', count: sopPending.length, icon: Award, tone: 'blue' },
      { key: 'irc', label: 'مجوز IRC نزدیک انقضا یا منقضی', count: expiringVendors.length, icon: Calendar, tone: 'rose' },
    ];
  }, [sourceVendors, partners, expiringVendors]);

  // Lab pass-rate across all sources.
  const labStats = useMemo(() => {
    let pass = 0, cond = 0, rej = 0;
    for (const v of db) for (const r of (v.analysisRecords || [])) {
      if (r.decision === 'Pass') pass++;
      else if (r.decision === 'Approved Conditional') cond++;
      else if (r.decision === 'Reject') rej++;
    }
    const total = pass + cond + rej;
    return { pass, cond, rej, total, rate: total > 0 ? Math.round(((pass + cond) / total) * 100) : 0 };
  }, [db]);

  // Recent audit activity (works in local mode; backend fetch otherwise).
  const [recentAudit, setRecentAudit] = useState<any[]>([]);
  useEffect(() => {
    if (!currentUser) return;
    // The feed reads the audit trail, which `audit.read` gates. Asking for it
    // without the permission produced a guaranteed 403 on every page load for
    // every non-admin — harmless on screen, but it filled the browser console
    // and the server's access log with failures that were never going to
    // succeed. No permission, no feed, no request.
    if (!can(currentUser, 'audit.read')) { setRecentAudit([]); return; }
    // Sign-ins are the highest-volume event in the log and say nothing about the
    // state of the supply base, so five of them filled this feed and pushed out
    // every actual data change. Ask for a wider slice and keep the changes.
    const withoutSignInNoise = (rows: any[]) => rows
      .filter(l => l.module !== 'احراز هویت' && !['LOGIN', 'LOGOUT', 'FAILED_LOGIN'].includes(l.action))
      .slice(0, 5);

    if (isLocalMode()) { setRecentAudit(withoutSignInNoise(readLocalAudit())); return; }
    let cancelled = false;
    authFetch('/api/audit-logs?page=1&limit=40')
      .then(res => (res.ok ? res.json() : null))
      .then(j => { if (!cancelled && j?.data) setRecentAudit(withoutSignInNoise(j.data)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser, db, partners, materials]);

  const toneClasses: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800',
    orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800',
    blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800',
    rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800',
  };

  return (
    <div className="space-y-7 fade-in">
      {/* PAGE HEADER — the system's own name is already in the sidebar and the
          browser tab; repeating it a third time cost the top 180px of a screen
          that is opened several times a day. */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/80 pb-4">
        <h2 className="text-lg font-black text-foreground tracking-tight">خلاصهٔ وضعیت تامین‌کنندگان</h2>
        {currentUser && (
          <Button onClick={onOpenSourceForm} className="h-10 px-5 shadow-sm gap-2 text-sm font-bold shrink-0">
            <Plus className="w-4 h-4" />
            ثبت سورس جدید
          </Button>
        )}
      </div>

      {/* WHAT NEEDS DOING — first, and full width.
          This is the only part of the dashboard that tells the user what to do
          next. It used to sit second, at half width, underneath five statistic
          cards and a donut that between them showed the same five numbers
          twice. */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-foreground text-sm">کارهای معوق</h3>
          <span className="text-2xs text-muted-foreground">— برای رسیدگی روی هر مورد کلیک کنید</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {pendingActions.map(a => {
            // Opening the backlog, not the first record in it: jumping
            // straight into one of twelve told the user neither which record
            // they had landed on nor what else was waiting.
            const clickable = a.count > 0;
            return (
              <button
                key={a.key}
                type="button"
                disabled={!clickable}
                onClick={() => { if (clickable) onNavigate('tasks', null, a.key); }}
                className={`text-right rounded-xl border p-3.5 transition-all ${
                  clickable ? `${toneClasses[a.tone]} hover:shadow-sm cursor-pointer` : 'bg-muted/40 border-border text-muted-foreground cursor-default'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <a.icon className="w-4 h-4" />
                  <span className="text-2xl font-black font-mono tabular-nums">{a.count}</span>
                </div>
                <div className="text-2xs font-bold leading-snug">{a.label}</div>
                <div className="text-2xs mt-1 opacity-80">{clickable ? 'رسیدگی ←' : 'موردی باقی نمانده'}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI ROW */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {[
          { label: 'کل سورس‌ها', value: stats.total, color: 'text-primary', badgeVariant: 'info' as const, sub: sampleCount > 0 ? `بدون احتساب ${sampleCount} نمونه` : 'به‌جز نمونه‌ها', percent: 100 },
          { label: 'گرید A', value: stats.gradeA, color: 'text-emerald-600 dark:text-emerald-400', badgeVariant: 'gradeA' as const, sub: 'امتیاز ۸۰ تا ۱۰۰ (تایید کامل)', percent: stats.total > 0 ? Math.round((stats.gradeA/stats.total)*100) : 0 },
          { label: 'گرید B', value: stats.gradeB, color: 'text-blue-600 dark:text-blue-400', badgeVariant: 'gradeB' as const, sub: 'امتیاز ۶۰ تا ۷۹ (تایید با پایش)', percent: stats.total > 0 ? Math.round((stats.gradeB/stats.total)*100) : 0 },
          { label: 'گرید C', value: stats.gradeC, color: 'text-amber-600 dark:text-amber-400', badgeVariant: 'gradeC' as const, sub: 'امتیاز ۴۰ تا ۵۹ (مشروط)', percent: stats.total > 0 ? Math.round((stats.gradeC/stats.total)*100) : 0 },
          { label: 'بدون گرید', value: stats.ungraded, color: 'text-muted-foreground', badgeVariant: 'info' as const, sub: 'هنوز ارزیابی نشده‌اند', percent: stats.total > 0 ? Math.round((stats.ungraded/stats.total)*100) : 0 },
          { label: 'لیست سیاه', value: stats.rejected, color: 'text-rose-600 dark:text-rose-400', badgeVariant: 'gradeReject' as const, sub: 'مردود یا لیست سیاه', percent: stats.total > 0 ? Math.round((stats.rejected/stats.total)*100) : 0 }
        ].map(s => (
          <Card key={s.label} className="p-4 space-y-2.5 bg-card border-border/80 hover:border-primary/30 transition-all">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-foreground">{s.label}</span>
              <Badge variant={s.badgeVariant} className="text-2xs px-1.5 py-0 font-mono shrink-0">
                {s.percent}%
              </Badge>
            </div>
            {/* The progress bar that used to sit here measured each number
                against the total it was already a percentage of, and painted
                every one of them the same blue — so the "total" card carried a
                permanently full bar of itself. The badge already says it. */}
            <div className={`text-3xl font-black tabular-nums font-mono ${s.color}`}>
              {s.value}
            </div>
            <div className="text-2xs text-muted-foreground leading-snug">{s.sub}</div>
          </Card>
        ))}
      </div>

      {/* GRADE MIX + ACTIVITY are grouped below the numbers they explain. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Grade distribution donut */}
        <Card className="p-5 bg-card border-border/80">
          <div className="flex items-center gap-2 mb-3">
            <PieChartIcon className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">توزیع گرید کیفی</h3>
          </div>
          {gradeDistribution.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-xs">داده‌ای برای نمایش نیست.</div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-44 w-1/2" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={gradeDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={2} strokeWidth={2}>
                      {gradeDistribution.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--card)" />)}
                    </Pie>
                    <RTooltip contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid var(--border)' }} formatter={(v: any, n: any) => [`${v} (${stats.total > 0 ? Math.round((v/stats.total)*100) : 0}%)`, n]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {gradeDistribution.map(d => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-foreground font-medium">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="font-mono font-bold text-foreground">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Lab pass rate — beside the grade mix, since both summarise quality. */}
        <Card className="p-5 bg-card border-border/80 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Microscope className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">نرخ قبولی آزمایشگاه</h3>
          </div>
          {labStats.total === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">نتیجهٔ آزمایشی ثبت نشده است.</div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="shrink-0 text-center sm:text-right">
                <div className={`text-4xl font-black font-mono ${labStats.rate >= 80 ? 'text-emerald-600 dark:text-emerald-400' : labStats.rate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>{labStats.rate}%</div>
                <div className="text-2xs text-muted-foreground mt-0.5">از مجموع {labStats.total} آزمون</div>
              </div>
              <div className="flex-1 space-y-2">
                <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-muted">
                  <div className="h-full bg-emerald-500" style={{ width: `${(labStats.pass / labStats.total) * 100}%` }} />
                  <div className="h-full bg-blue-500" style={{ width: `${(labStats.cond / labStats.total) * 100}%` }} />
                  <div className="h-full bg-rose-500" style={{ width: `${(labStats.rej / labStats.total) * 100}%` }} />
                </div>
                {/* Was "Pass 4 / مشروط 2 / Reject 1": three labels, two languages. */}
                <div className="flex items-center justify-between text-2xs">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">قبول {labStats.pass}</span>
                  <span className="text-blue-600 dark:text-blue-400 font-bold">مشروط {labStats.cond}</span>
                  <span className="text-rose-600 dark:text-rose-400 font-bold">مردود {labStats.rej}</span>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* RECENT ACTIVITY — a plain full-width list rather than a fourth card
          grid, so the page stops repeating one layout family end to end. */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <History className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-foreground text-sm">آخرین تغییرات ثبت‌شده</h3>
        </div>
        {recentAudit.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-xs border border-dashed border-border rounded-xl">
            تغییری برای نمایش ثبت نشده است.
          </div>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {recentAudit.map((l, i) => {
              const sev = l.severity === 'Critical' ? 'bg-rose-500' : l.severity === 'Warning' ? 'bg-amber-500' : 'bg-emerald-500';
              let when = '';
              try { const d = new Date(l.timestamp || l.createdAt); when = d.toLocaleDateString('fa-IR') + ' ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }); } catch {}
              return (
                <div key={l.id || i} className="flex items-center gap-2.5 py-2.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sev}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-foreground font-medium truncate">{l.description || `${l.action}: ${l.entityName || ''}`}</div>
                    <div className="text-2xs text-muted-foreground">{l.userName || l.userId || 'سیستم'} · {l.module}</div>
                  </div>
                  <span className="text-2xs text-muted-foreground font-mono shrink-0" dir="ltr">{when}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* The expiring-licence list used to be rendered here. It moved to the
          worklist (#/tasks/irc): the dashboard grew longer exactly as the
          backlog grew, which is backwards — a dashboard should summarise and
          hand off. The counter in the pending-actions card is the entry point. */}

      {/* CATEGORY CARDS */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="font-bold text-foreground text-sm">دسته‌بندی‌های تامین</h3>
          <span className="text-xs text-muted-foreground">انتخاب دسته‌بندی برای مدیریت تخصصی</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {(Object.entries(categoryLabels) as [Category, any][]).filter(([id]) => id !== 'blacklist').map(([id, meta]) => {
            const catVendors = db.filter(v => id === 'sample' ? (v.category === 'sample' || v.isSample) : (v.category === id && v.status !== 'rejected' && v.grade !== 'rejected'));
            const verified = id === 'sample' 
              ? catVendors.filter(v => v.status === 'approved').length 
              : catVendors.filter(v => v.grade === 'A' || v.grade === 'B').length;
            const other = catVendors.length - verified;
            const verifiedLabel = 'تایید شده';
            const otherLabel = id === 'sample' ? 'مشروط / رد' : 'سایر';
            const style = categoryCardStyles[id] || categoryCardStyles.foreign;

            return (
              <Card 
                key={id}
                onClick={() => onNavigate('category', id)}
                className={`group p-5 space-y-4 bg-card border-border hover:border-primary/50 transition-all duration-300 cursor-pointer ${style.hoverBg} ${style.hoverShadow} ${catVendors.length === 0 ? 'opacity-65 hover:opacity-100' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center border font-mono font-black transition-all duration-300 ${style.iconBg} ${style.iconBorder} ${style.iconText} group-hover:scale-105`}>
                    <meta.icon className="w-6 h-6" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                
                <div>
                  <h3 className="font-black text-foreground leading-tight text-base tracking-tight group-hover:text-primary transition-colors">{meta.fa}</h3>
                  <div className="text-muted-foreground text-2xs mt-0.5 font-mono uppercase tracking-wider">{meta.en}</div>
                </div>

                <div className="border-t border-border/70 pt-3 flex items-center justify-between">
                  <div className={`font-mono text-3xl font-black transition-all duration-300 group-hover:scale-105 origin-left ${catVendors.length === 0 ? 'text-muted-foreground' : style.statText}`}>{catVendors.length}</div>
                  <div className="text-right">
                    <div className="text-foreground font-bold text-xs">{verified} {verifiedLabel}</div>
                    <div className="text-muted-foreground text-2xs mt-0.5">{other} {otherLabel}</div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

    </div>
  );
}
