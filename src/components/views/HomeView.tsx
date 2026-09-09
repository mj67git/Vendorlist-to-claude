import React, { useEffect, useMemo, useState } from 'react';
import { Award, BadgeCheck, Boxes, Building2, Calendar, ChevronLeft, ClipboardList, FlaskConical, History, Microscope, PieChart as PieChartIcon, Plus, ShieldAlert } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { StatTile } from '../../components/ui/stat-tile';
import { categoryLabels } from '../../constants/categories';
import { can } from '../../utils/permissions';
import { authFetch, isLocalMode } from '../../services/authFetch';
import { readLocalAudit } from '../../services/localAudit';
import { BusinessPartner, Category, Material, User, Vendor } from '../../types';
import { adminRejectionReason, isInCategoryRegister, isSampleVendor, isVendorRejected } from '../../utils/vendorState';
import { describeVendorRank, SOURCE_GRADE_RANGE_FA } from '../../utils/vendorRank';
import { describeSampleStatus } from '../../utils/sampleStatus';
import { countMaterialsWithSources, indexSourcesByMaterial } from '../../utils/materialSources';
import { summarisePartners } from '../../utils/partnerStats';
import { reconcileSupplierEvaluation } from '../../utils/sopEvaluation';
import { checkLicenseExpiry } from '../../utils/vendorUtils';
import { categoryCardStyles } from '../../constants/categoryCardStyles';
import { buildWorklist } from './WorklistView';
// @ts-expect-error — the bundler resolves this asset import; TypeScript does not.
import temadLogo from '../../assets/logo.png';

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
    /*
     * The grade is derived from the department scores, not read off the stored
     * `grade` column — the two diverge in the data, and every other screen (the
     * source page, the archive, the spreadsheet) already derives it through
     * `describeVendorRank`. Counting the column here made the dashboard the one
     * place in the application that disagreed with the rest about a company's
     * grade, and the widget's own title says the scores are what it counts.
     *
     * One pass over the population fills all five buckets: the five separate
     * `filter` walks this replaces grew with the register, and this page is the
     * first thing every user loads.
     */
    let rejected = 0, gradeA = 0, gradeB = 0, gradeC = 0;
    for (const v of sourceVendors) {
      if (isVendorRejected(v)) { rejected++; continue; }
      switch (describeVendorRank(v).grade) {
        case 'A': gradeA++; break;
        case 'B': gradeB++; break;
        case 'C': gradeC++; break;
        default: break;
      }
    }
    return {
      total: sourceVendors.length,
      gradeA, gradeB, gradeC, rejected,
      // The five cards used to add up to two thirds of the population and stop
      // there, silently dropping every source that has no grade yet — while the
      // donut right beside them showed exactly that slice.
      ungraded: sourceVendors.length - gradeA - gradeB - gradeC - rejected,
    };
  }, [sourceVendors]);

  /**
   * How much of the catalogue is actually bought.
   *
   * The sources only, never the samples: the tile beside this one counts «کل
   * سورس‌ها … به‌جز نمونه‌ها», and one row of figures must not use two meanings
   * of the word. The materials repository asks the same function over every
   * record, because there the question is what a delete would break.
   */
  const materialsInUse = useMemo(
    () => countMaterialsWithSources(indexSourcesByMaterial(sourceVendors, materials)),
    [sourceVendors, materials],
  );

  const partnerStats = useMemo(() => summarisePartners(partners || []), [partners]);

  /*
   * Grade distribution for the donut (semantic ordinal grade colours).
   *
   * The band each grade stands for travels with the slice. It used to be the
   * subtitle of a row of cards that repeated these same five figures directly
   * above the ring, and when those went the bands were the only thing on them
   * the ring did not already say.
   */
  const gradeDistribution = useMemo(() => [
      { name: 'گرید A', value: stats.gradeA, color: '#10b981', hint: SOURCE_GRADE_RANGE_FA.A },
      { name: 'گرید B', value: stats.gradeB, color: '#3b82f6', hint: SOURCE_GRADE_RANGE_FA.B },
      { name: 'گرید C', value: stats.gradeC, color: '#f59e0b', hint: SOURCE_GRADE_RANGE_FA.C },
      // Not simply grade D: a source also reaches this state by an explicit
      // decision rather than by its score alone (rule 11).
      { name: 'لیست سیاه', value: stats.rejected, color: '#e11d48', hint: 'امتیاز زیر ۴۰ یا رد صریح' },
      { name: 'بدون گرید', value: stats.ungraded, color: '#94a3b8', hint: 'هنوز ارزیابی نشده' },
    ].filter(d => d.value > 0), [stats]);

  /**
   * The seller-evaluation mix, from the five documents each seller submitted.
   *
   * Manufacturers are not in the population at all: they are never evaluated
   * against the SOP (rule 4), so counting them would report a backlog that
   * cannot exist. The grade is recomputed from the documents rather than read
   * off the stored column, for the same reason rule 13 gives — a stored row can
   * disagree with its own documents, and `reconcileSupplierEvaluation` is what
   * the rest of the application trusts.
   *
   * «ارزیابی نشده» is a slice of its own so the ring adds up to the number of
   * sellers. The source donut beside it silently dropped exactly that group
   * once, and the total stopped meaning anything.
   */
  const supplierGradeDistribution = useMemo(() => {
    let a = 0, b = 0, c = 0, rejected = 0, none = 0;
    for (const p of partners || []) {
      if (p.type !== 'Supplier') continue;
      const grade = reconcileSupplierEvaluation(p).evaluation?.grade;
      switch (grade) {
        case 'A': a++; break;
        case 'B': b++; break;
        case 'C': c++; break;
        // The failing grade is `D` under the 90/75/60 rubric (rule 13).
        // `Blacklist` is the retired name for the same thing and still appears
        // on rows written before the change, so both land in one slice — while
        // this counted only `Blacklist`, a rejected seller fell through to
        // `default` and the dashboard called it «ارزیابی نشده», disagreeing
        // with the repository table two clicks away, which said D.
        case 'D': case 'Blacklist': rejected++; break;
        default: none++; break;
      }
    }
    const slices = [
      { name: 'گرید A', value: a, color: '#10b981' },
      { name: 'گرید B', value: b, color: '#3b82f6' },
      { name: 'گرید C', value: c, color: '#f59e0b' },
      { name: 'گرید D (مردود)', value: rejected, color: '#e11d48' },
      { name: 'ارزیابی نشده', value: none, color: '#94a3b8' },
    ];
    return { slices: slices.filter(d => d.value > 0), total: a + b + c + rejected + none };
  }, [partners]);

  /*
   * Pending-actions centre: real, actionable quality gaps.
   *
   * Counted by `buildWorklist`, the same function the کارتابل itself uses, so
   * the tile and the list it opens cannot disagree. They already did: this kept
   * its own copy of all four filters, its licence backlog counted samples while
   * the list excluded them, and its «not evaluated» test read the stored grade
   * column rather than deriving from the department scores — so a source with
   * real scores and an empty column sat on the dashboard for ever.
   */
  const pendingActions = useMemo(() => ([
    { key: 'eval', label: 'سورس‌های ارزیابی‌نشده', count: buildWorklist('eval', db, partners || []).length, icon: ClipboardList, tone: 'amber' },
    { key: 'risk', label: 'ریسک ثبت‌نشده', count: buildWorklist('risk', db, partners || []).length, icon: ShieldAlert, tone: 'orange' },
    { key: 'sop', label: 'ارزیابی معوق فروشندگان', count: buildWorklist('sop', db, partners || []).length, icon: Award, tone: 'blue' },
    { key: 'irc', label: 'مجوز IRC نزدیک انقضا یا منقضی', count: buildWorklist('irc', db, partners || []).length, icon: Calendar, tone: 'rose' },
  ]), [db, partners]);

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
      {/* THE BANNER — the one place in the application that says what this
          system is.

          The name used to be left off this page deliberately, because the
          sidebar and the browser tab both carry it and a third heading cost the
          top of a screen people open several times a day. It comes back as a
          single band roughly the height of the row it replaces: the deep navy
          reads as the product's own identity rather than borrowing the blue the
          rest of the interface uses for actions, and the register button lives
          inside the band so the colour runs the full width instead of stopping
          short of it.

          The tones are fixed rather than tokenised on purpose — this is a brand
          surface, like the sign-in card, and it must look the same in both
          themes; only the border below it follows the theme. The logo is dark
          navy on transparency, so it sits on a white plate to stay legible. */}
      <div className="relative overflow-hidden rounded-2xl border border-border shadow-sm bg-gradient-to-l from-teal-800 via-slate-900 to-slate-950">
        {/* A soft highlight so the band is not a flat rectangle. Decorative, so
            it is hidden from assistive technology and cannot catch a click. */}
        <div aria-hidden className="pointer-events-none absolute -top-16 -left-16 w-64 h-64 rounded-full bg-teal-400/15 blur-3xl" />

        {/* Stacks below `lg`, because the breakpoint measures the window and the
            sidebar takes a third of it: at a 768px tablet this band is only
            about 470px wide, and side by side the Persian title broke onto
            three lines while the Latin one was cut mid-word. */}
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-4 min-w-0">
            {/* `sm:` and not a custom `xs:` — Tailwind v4 has no such breakpoint here,
                so the plate was hidden at every width. */}
            <span className="hidden sm:inline-flex items-center justify-center bg-white rounded-xl px-3 py-2 shrink-0 shadow-sm">
              <img src={temadLogo} alt="تماد" className="h-11 w-auto object-contain" />
            </span>
            <div className="min-w-0">
              <p className="text-teal-300 text-2xs font-bold uppercase tracking-[0.18em] font-mono lg:truncate" dir="ltr">
                Vendor List &amp; Supplier Evaluation System
              </p>
              <h2 className="text-white text-base sm:text-lg font-black tracking-tight mt-1">
                سامانهٔ ارزیابی و رتبه‌بندی تأمین‌کنندگان
              </h2>
            </div>
          </div>

          {/* Offered only to an account that may actually register a source.
              The endpoint has always refused the save without `vendor.create`;
              showing the button to everyone meant a department without the
              permission could fill in the longest form in the application and
              learn at the last step that it was never allowed to.

              Solid white on the dark band: the default button is the same blue
              family as the ground behind it here, and a primary button on a
              primary-adjacent field is the contrast failure this band would
              otherwise introduce. */}
          {can(currentUser, 'vendor.create') && (
            <Button
              onClick={onOpenSourceForm}
              className="h-10 px-5 shadow-sm gap-2 text-sm font-bold shrink-0 bg-white text-slate-900 hover:bg-white/90"
            >
              <Plus className="w-4 h-4" />
              ثبت سورس جدید
            </Button>
          )}
        </div>
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

      {/* WHAT IS ON FILE — one tile per register, and nothing that is drawn
          again further down.

          Five of the six cards that used to stand here were the grade mix —
          gradeA, gradeB, gradeC, ungraded and the blacklist — which is exactly
          what the ring below them draws, so the same five figures were printed
          twice within one scroll, and the blacklist a third time on its own
          category card. What was genuinely missing was the size of the other
          two registers, and neither appears anywhere else on this page.

          `StatTile` is the tile both repository screens open with, so the
          dashboard now counts in the same shape — and in Persian digits, which
          the hand-built cards here never did. A tile with somewhere to go is a
          real button, which is the other half of what that component settles.

          A fixed three-column class, never one built from the number of tiles:
          Tailwind cannot see a class name that is assembled at runtime, and
          with one or two tiles these simply stretch. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <StatTile
          label="کل سورس‌ها"
          value={stats.total}
          hint={sampleCount > 0 ? `بدون احتساب ${sampleCount.toLocaleString('fa-IR')} نمونه` : 'به‌جز نمونه‌ها'}
          icon={Boxes}
          tone="bg-muted text-foreground border-border"
          onClick={() => onNavigate('archive')}
        />

        {/* Gated, and gated on the whole tile rather than on its number.
            `useCachedCollection` empties the collection for an account without
            the read, so an ungated tile would print a confident zero for a
            register the user is simply not being sent. UX only, as ever — the
            server is what actually refuses the page (rule 14). */}
        {can(currentUser, 'material.read') && (
          <StatTile
            label="مواد اولیه"
            value={materials.length}
            hint={`${materialsInUse.toLocaleString('fa-IR')} ماده دارای سورس`}
            icon={FlaskConical}
            tone="bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900"
            onClick={() => onNavigate('materials')}
          />
        )}

        {can(currentUser, 'partner.read') && (
          <StatTile
            label="شرکای تجاری"
            value={partnerStats.total}
            hint={`${partnerStats.manufacturers.toLocaleString('fa-IR')} تولیدکننده · ${partnerStats.suppliers.toLocaleString('fa-IR')} فروشنده`}
            icon={Building2}
            tone="bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900"
            onClick={() => onNavigate('business-partners')}
          />
        )}
      </div>

      {/* HOW GOOD IS IT — the three distributions, below the registers they
          describe.

          Three equal columns: the two distributions read as a pair — the same
          ring, the same legend, the same colour per grade — and the laboratory
          rate sits with them because all three answer «چقدر خوب است آنچه
          داریم؟». The lab card used to take two thirds of the row on its own. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Source grades, from the department scores. */}
        <GradeDonutCard
          icon={PieChartIcon}
          title="توزیع گرید کیفی سورس‌ها"
          subtitle="بر اساس امتیاز دپارتمان‌ها"
          slices={gradeDistribution}
          total={stats.total}
          emptyMessage="داده‌ای برای نمایش نیست."
          onOpen={() => onNavigate('archive')}
          openLabel="مشاهده در آرشیو کل داده‌ها"
        />

        {/* Seller grades, from the five submitted documents. */}
        <GradeDonutCard
          icon={BadgeCheck}
          title="توزیع گرید کیفی ارزیابی فروشندگان"
          subtitle="بر اساس مدارک ارسالی"
          slices={supplierGradeDistribution.slices}
          total={supplierGradeDistribution.total}
          emptyMessage="فروشنده‌ای ثبت نشده است."
          onOpen={() => onNavigate('business-partners')}
          openLabel="مشاهده در مخزن شرکای تجاری"
        />

        {/* Lab pass rate — the third answer to the same question. */}
        <Card className="p-5 bg-card border-border/80 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Microscope className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">نرخ قبولی آزمایشگاه</h3>
          </div>
          {labStats.total === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-xs">نتیجهٔ آزمایشی ثبت نشده است.</div>
          ) : (
            <div className="flex-1 flex flex-col justify-center gap-3">
              <div className="text-center">
                <div className={`text-3xl font-black font-mono ${labStats.rate >= 80 ? 'text-emerald-600 dark:text-emerald-400' : labStats.rate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>{labStats.rate}%</div>
                <div className="text-2xs text-muted-foreground mt-0.5">از مجموع {labStats.total} آزمون</div>
              </div>
              <div className="space-y-2">
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
          {/* No link, deliberately — do not add one back from the pattern of
              the two cards beside it. Each of those opens the same population
              its ring counts. This rate is computed over every source's
              laboratory records, and no screen shows that set: the archive
              carries no laboratory column, and the sample register is a subset
              (the analysis tab is gated by permission, not by `isSample`). The
              button that used to sit here opened the worklist's «سورس‌های
              ارزیابی‌نشده» tab — sources missing their departmental scores,
              which is a different set and a different subject. */}
        </Card>
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
        {/* Six cards now that the blacklist has one, so the row divides evenly
            instead of leaving a single card stranded on a second line. */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {(Object.entries(categoryLabels) as [Category, any][]).map(([id, meta]) => {
            /*
             * The card's population, from the one predicate that answers it
             * (rule 11d).
             *
             * The blacklist and the samples are each their own register — a
             * state and a stage, not categories — and an ordinary category
             * excludes the rows that belong to them. This card wrote that rule
             * out by hand, the category page wrote a third version of it, and
             * the spreadsheet a fourth; «خارجی» drew 105 rows on screen and
             * exported 140. Now the four ask `isInCategoryRegister`.
             */
            const isBlacklistCard = id === 'blacklist';
            const catVendors = db.filter(v => isInCategoryRegister(v, id));

            /*
             * What the card counts, in the vocabulary of the thing it counts.
             *
             * A source category shows its grade mix — A, B, C and the ones
             * nobody has scored — because a source *has* a grade and that is
             * the word the source page, the archive column and the dashboard
             * donut all use for it. It used to read «تأییدشده / مشروط», which
             * is the sample vocabulary (Approved / Conditional) borrowed for
             * records that are graded, not judged; and the middle figure
             * quietly held grade D as well, so a source scoring below 40 was
             * counted as «conditional».
             *
             * The grade is derived from the department scores, never read off
             * the stored column, so this row and the donut above it cannot
             * disagree about the same source.
             */
            type CardRow = { key: string; label: string; value: number; tone: string; bar: string };
            let rows: CardRow[];

            if (isBlacklistCard) {
              // A verdict, not a mix of qualities: what is worth knowing is how
              // a source got here — a person's decision, or its own score.
              let explicit = 0;
              for (const v of catVendors) if (adminRejectionReason(v)) explicit++;
              rows = [
                { key: 'explicit', label: 'رد صریح', value: explicit, tone: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500' },
                { key: 'low', label: 'امتیاز پایین', value: catVendors.length - explicit, tone: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-400' },
              ];
            } else if (id === 'sample') {
              // The sample's own three words, from `describeSampleStatus`.
              let approved = 0, decided = 0;
              for (const v of catVendors) {
                const d = describeSampleStatus(v);
                if (!d.decided) continue;
                decided++;
                if (d.label === 'Approved') approved++;
              }
              rows = [
                { key: 'approved', label: 'تأییدشده', value: approved, tone: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
                { key: 'other', label: 'مشروط یا رد', value: decided - approved, tone: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' },
                { key: 'untested', label: 'آزمایش‌نشده', value: catVendors.length - decided, tone: 'text-muted-foreground', bar: 'bg-slate-400 dark:bg-slate-600' },
              ];
            } else {
              const g = { A: 0, B: 0, C: 0, D: 0, none: 0 };
              for (const v of catVendors) {
                const grade = describeVendorRank(v).grade;
                if (grade === 'A' || grade === 'B' || grade === 'C') g[grade]++;
                else if (grade === 'D') g.D++;
                else g.none++;
              }
              rows = [
                { key: 'A', label: 'گرید A', value: g.A, tone: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
                { key: 'B', label: 'گرید B', value: g.B, tone: 'text-blue-600 dark:text-blue-400', bar: 'bg-blue-500' },
                { key: 'C', label: 'گرید C', value: g.C, tone: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' },
                // Grade D only reaches a category card while its scoring is
                // unfinished — a completed one below 40 is blacklisted and
                // counted in the warning line instead — so it is named rather
                // than folded into a band it does not belong to.
                ...(g.D > 0 ? [{ key: 'D', label: 'گرید D', value: g.D, tone: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500' }] : []),
                { key: 'none', label: 'بدون امتیاز', value: g.none, tone: 'text-muted-foreground', bar: 'bg-slate-400 dark:bg-slate-600' },
              ];
            }

            // Only what is actually wrong, and only when something is: a line
            // that always shows «۰ مورد» teaches the reader to stop looking at
            // it. The blacklist card is the one place the rejected count is the
            // subject rather than a warning.
            const expiring = isBlacklistCard ? 0 : catVendors.filter(v => {
              const st = checkLicenseExpiry(v.ircExpiryDate).status;
              return st === 'expired' || st === 'expiring_soon';
            }).length;
            // The complement of the register above: the rows this category
            // would hold if they had not been disqualified. Same two exclusions
            // as `isInCategoryRegister`, with the verdict inverted.
            const rejected = isBlacklistCard ? 0 : db.filter(v =>
              v.category === id && !isSampleVendor(v) && isVendorRejected(v)).length;

            const total = catVendors.length;
            const style = categoryCardStyles[id] || categoryCardStyles.foreign;

            return (
              <Card 
                key={id}
                onClick={() => onNavigate('category', id)}
                className={`group p-5 space-y-4 bg-card border-border hover:border-primary/50 transition-all duration-300 cursor-pointer ${style.hoverBg} ${style.hoverShadow} ${total === 0 ? 'opacity-65 hover:opacity-100' : ''}`}
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

                <div className="border-t border-border/70 pt-3 space-y-2">
                  <div className="flex items-end justify-between gap-2">
                    <div className={`font-mono text-3xl font-black leading-none transition-all duration-300 group-hover:scale-105 origin-left ${total === 0 ? 'text-muted-foreground' : style.statText}`}>
                      {total.toLocaleString('fa-IR')}
                    </div>
                    {/* Stacked lines rather than columns: the labels are long
                        enough that side by side they were cut off at the card's
                        edge, and a label clipped without an ellipsis reads as a
                        different word. */}
                    <div className="space-y-0.5 text-2xs min-w-0">
                      {rows.map(r => (
                        <div key={r.key} className="flex items-center justify-end gap-1.5">
                          <span className="text-muted-foreground">{r.label}</span>
                          <span className={`font-mono font-black ${r.tone}`}>{r.value.toLocaleString('fa-IR')}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* The same figures as one bar, so the shape of the category
                      reads without arithmetic. Decorative: the numbers above
                      already carry the information. */}
                  {total > 0 && (
                    <div aria-hidden className="h-1.5 w-full rounded-full overflow-hidden flex bg-muted">
                      {rows.map(r => (
                        <div key={r.key} className={`h-full ${r.bar}`} style={{ width: `${(r.value / total) * 100}%` }} />
                      ))}
                    </div>
                  )}

                  {(rejected > 0 || expiring > 0) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs font-bold pt-0.5">
                      {rejected > 0 && (
                        <span className="text-rose-600 dark:text-rose-400">
                          {rejected.toLocaleString('fa-IR')} در لیست سیاه
                        </span>
                      )}
                      {expiring > 0 && (
                        <span className="text-amber-600 dark:text-amber-400">
                          {expiring.toLocaleString('fa-IR')} مجوز منقضی یا نزدیک انقضا
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      {/* RECENT ACTIVITY — last on the page, and a plain full-width list
          rather than a fourth card grid so the page stops repeating one layout
          family end to end.

          It used to sit between the distributions and the category cards,
          which put a feed of individual edits in the middle of a summary and
          pushed the six registers below the fold. A dashboard reads
          top-down — what needs doing, what is on file, how good it is, where
          to go — and «what just happened» is the footnote to all of it. */}
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

    </div>
  );
}


/**
 * One distribution ring with its legend.
 *
 * Two widgets on this page answer the same shape of question about different
 * populations, so they share a component rather than a copy: the four table
 * primitives in this project were split into four diverging copies exactly this
 * way, and one of them ended up reading fake rows to a screen reader.
 */
function GradeDonutCard({ icon: Icon, title, subtitle, slices, total, emptyMessage, onOpen, openLabel }: {
  icon: React.ComponentType<{ className?: string }>,
  title: string,
  subtitle: string,
  /** `hint` is the band the slice stands for, under its name in the legend. */
  slices: { name: string, value: number, color: string, hint?: string }[],
  total: number,
  emptyMessage: string,
  onOpen: () => void,
  openLabel: string,
}) {
  return (
    <Card className="p-5 bg-card border-border/80 flex flex-col">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-foreground text-sm">{title}</h3>
      </div>
      <p className="text-2xs text-muted-foreground mt-0.5 mb-3">{subtitle}</p>
      {slices.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center py-10 text-muted-foreground text-xs">{emptyMessage}</div>
      ) : (
        <div className="flex-1 flex items-center gap-2">
          <div className="h-40 w-1/2" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2} strokeWidth={2}>
                  {slices.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--card)" />)}
                </Pie>
                <RTooltip
                  contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid var(--border)' }}
                  formatter={(v: any, n: any) => [`${v} (${total > 0 ? Math.round((v / total) * 100) : 0}%)`, n]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-1.5">
            {slices.map(d => (
              <div key={d.name} className="flex items-start justify-between gap-2 text-xs">
                <span className="flex items-start gap-1.5 text-foreground font-medium min-w-0">
                  {/* The swatch sits on the first line of a two-line entry
                      rather than centred against both, so a legend with bands
                      and one without still line up with the ring. */}
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1" style={{ background: d.color }} />
                  <span className="min-w-0">
                    {d.name}
                    {d.hint && <span className="block text-2xs text-muted-foreground font-normal">{d.hint}</span>}
                  </span>
                </span>
                <span className="font-mono font-bold text-foreground shrink-0">{d.value.toLocaleString('fa-IR')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button type="button" onClick={onOpen} className="mt-3 text-2xs font-bold text-primary hover:underline text-right">
        {openLabel}
      </button>
    </Card>
  );
}
