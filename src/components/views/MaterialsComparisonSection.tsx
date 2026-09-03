import React, { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Category, Vendor } from '../../types';
import { EntityName } from '../EntityName';
import { Button } from '../ui/button';
import { FmeaService } from '../../utils/fmeaService';
import { calculateOverallScore } from '../../utils/vendorUtils';
import type { SourceSelectionRecord } from '../../utils/sourceSelection';

// extracted from App.tsx

/** Persian/Arabic-Indic digits to ASCII, so date strings sort correctly. */
const normalizeDigits = (value: string): string =>
  (value || '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
               .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/**
 * Below this gap the top two engine scores are treated as level rather than as
 * a winner and a runner-up. Presenting a 0.2 difference with the same certainty
 * as a 20-point one is what makes an advisory number read as a verdict.
 */
const DECISIVE_MARGIN = 3;

// The record type moved to src/utils/sourceSelection.ts, where the rule for
// matching a decision to a row lives too; re-exported so existing importers of
// this module keep working.
export type { SourceSelectionRecord };

/**
 * A date fit to print.
 *
 * Activity-log entries carry whatever the writer had: some are Jalali strings
 * («۱۴۰۵/۰۶/۱۲»), some are ISO instants, and some are Jalali dates that were
 * serialised into ISO shape — `1405-06-12T09:54:00.000Z`, a year no Gregorian
 * calendar has. This panel printed the winner of a plain string sort straight
 * to the screen, so the live page read that timestamp verbatim under «آخرین
 * ارزیابی ثبت‌شده».
 *
 * Handing the last of those to `Date` is worse than printing it: 1405 is
 * taken as a Gregorian year and comes back as ۷۸۴, a date seven hundred years
 * off. So the year decides how the value is read.
 */
export const formatGroupDate = (value: string | null): string | null => {
  if (!value) return null;
  const isoLike = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!isoLike) return value;

  const [, year, month, day] = isoLike;
  const y = parseInt(year, 10);
  // A Jalali year written in ISO punctuation. Keep the numbers, change only
  // the separators — converting it would move it by six centuries.
  if (y >= 1300 && y <= 1499) return `${y}/${month}/${day}`;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('fa-IR');
};


export const MaterialsComparisonSection: React.FC<{
  vendors: Vendor[];
  categoryId?: Category;
  /** The recorded decision for this material, when one has been made. */
  selection?: SourceSelectionRecord | null;
  /** Opens the "record this choice" dialog; omitted when the user may not write. */
  onSelectSource?: (vendorId: string) => void;
}> = ({ vendors, categoryId, selection, onSelectSource }) => {
  // One guide for the whole calculation. There used to be two toggles a
  // screen apart — one for the engine, one for the lab multiplier — for what is
  // a single formula.
  const [showEngineGuide, setShowEngineGuide] = useState(false);

  if (categoryId === 'blacklist' || categoryId === 'sample') {
    return null;
  }

  const validVendors = (vendors || []).filter(v => !v.isSample && v.status !== 'rejected' && v.grade !== 'rejected');
  
  if (validVendors.length === 0) return null;

  const chartData = validVendors.map(v => {
    const overallScore = calculateOverallScore(v.scores, true) || 0;
    
    // Call the isolated FmeaService to run the recommendation engine logic
    const { engineScore, riskMod, labMod, hasLabAssessment, analysisMeta } = 
      FmeaService.calculateEngineScore(overallScore, v.riskAssessment?.riskLevel, v.analysisRecords);

    return {
      name: v.name,
      nameEn: v.nameEn,
      score: overallScore, // Base visual score unchanged
      engineScore,
      riskMod,
      labMod,
      analysisMeta,
      hasLabAssessment,
      // How much of this source is actually evaluated — a comparison between a
      // fully scored source and a half-scored one is not a like-for-like one,
      // and the reader deserves to see that.
      scoredDepartments: (['commercial', 'qa', 'planning', 'finance'] as const)
        .filter(d => ((v.scores as any)?.[d] || 0) > 0).length,
      hasRisk: !!v.riskAssessment,
      qa: v.scores?.qa || 0,
      commercial: v.scores?.commercial || 0,
      planning: v.scores?.planning || 0,
      finance: v.scores?.finance || 0,
      vendor: v
    };
  }).sort((a, b) => b.engineScore - a.engineScore);

  const hasScores = chartData.some(d => d.score > 0);
  if (!hasScores) {
    return (
      <div className="mx-6 my-5 p-4 bg-amber-50/50 border border-amber-200/40 rounded-xl text-center text-amber-800 text-xs">
        هنوز ارزیابی کمّی و ثبت امتیاز کافی برای تامین‌کنندگان غیرنمونه این ماده انجام نشده است.
      </div>
    );
  }

  const bestVendor = chartData[0];
  const runnerUp = chartData[1];
  // "Level" means the engine cannot separate them; the choice is a human one.
  const isLevel = !!runnerUp && (bestVendor.engineScore - runnerUp.engineScore) < DECISIVE_MARGIN;
  const selectedEntry = selection ? chartData.find(d => d.vendor.id === selection.vendorId) : null;

  /**
   * The most recent real evaluation date in this material group.
   *
   * This used to fall back to today's date whenever the newest record predated
   * 1404, with a comment saying it should "look completely up-to-date". That
   * showed a freshness the data did not have, which in a system that keeps an
   * audit trail is a correctness problem rather than a cosmetic one. When there
   * is nothing to report it now says so.
   */
  const getLatestGroupUpdateDate = (): string | null => {
    const datesList: string[] = [];
    validVendors.forEach(v => {
      if (v.lastAudit) datesList.push(v.lastAudit);
      if (v.activityLogs) {
        v.activityLogs.forEach(log => {
          if (log.date) {
            const onlyDate = log.date.split(' ')[0];
            if (onlyDate) datesList.push(onlyDate);
          }
        });
      }
    });
    if (datesList.length === 0) return null;
    datesList.sort((a, b) => normalizeDigits(b).localeCompare(normalizeDigits(a)));
    return datesList[0] || null;
  };

  const groupUpdateDate = getLatestGroupUpdateDate();

  // Two lists, because a source with no score is not a competitor: it has
  // nothing to compare. It is still shown — counted, named, one click away —
  // rather than dropped, since "we have seven sources and evaluated three" is
  // itself the finding.
  const ranked = chartData.filter(d => d.score > 0);
  const unscored = chartData.filter(d => d.score <= 0);

  /**
   * The bar's scale.
   *
   * The heading used to say "از ۱۰۰" while the multipliers push a strong source
   * past it — 104.0 in a group where the label promised a maximum of 100. The
   * denominator is therefore whichever is larger, 100 or the top score, so the
   * bars stay comparable and no bar overflows its track.
   */
  const barCeiling = Math.max(100, ...ranked.map(d => d.engineScore));

  const riskChip = (item: typeof chartData[number]) => (
    <span
      className={`text-2xs px-2 py-0.5 rounded-lg border font-medium ${
        item.hasRisk
          ? 'bg-card border-border text-muted-foreground'
          : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300'
      }`}
      title={item.hasRisk
        ? 'ضریب ریسک از ارزیابی FMEA ثبت‌شدهٔ همین سورس گرفته شده است.'
        : 'ارزیابی ریسک ثبت نشده؛ ضریب پیش‌فرض ۰.۹۵ یک جریمهٔ محتاطانه است، نه ضریب خنثی.'}
    >
      ریسک {item.vendor.riskAssessment?.riskLevel || 'ثبت‌نشده'}{' '}
      <strong className="font-mono text-foreground" dir="ltr">×{item.riskMod.toFixed(2)}</strong>
    </span>
  );

  const labChip = (item: typeof chartData[number]) => (
    <span
      className={`text-2xs px-2 py-0.5 rounded-lg border font-medium ${
        !item.hasLabAssessment
          ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300'
          : item.analysisMeta.reject > 0
            ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-300'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-300'
      }`}
      title={item.hasLabAssessment
        ? `کل تست‌ها ${item.analysisMeta.total} · پاس/تایید ${item.analysisMeta.pass + item.analysisMeta.app} · مردود ${item.analysisMeta.reject}`
        : 'سابقهٔ تست آزمایشگاهی وجود ندارد؛ ضریب خنثی ۱.۰۰ لحاظ شده است.'}
    >
      {item.hasLabAssessment ? (
        <>
          آزمایشگاه {item.analysisMeta.total} تست · {item.analysisMeta.pass + item.analysisMeta.app} پاس ·{' '}
          {item.analysisMeta.reject} مردود{' '}
          <strong className="font-mono text-foreground" dir="ltr">×{item.labMod.toFixed(2)}</strong>
        </>
      ) : (
        <>آزمایشگاه: بدون سابقه <strong className="font-mono text-foreground" dir="ltr">×{item.labMod.toFixed(2)}</strong></>
      )}
    </span>
  );

  return (
    <div className="mx-6 my-6 p-5 bg-muted/50 rounded-2xl border border-border/80 space-y-4">
      {/* One header, one verdict.

          The panel used to open with a title, a suggestion chip, a bar chart,
          a QC table repeating the same seven sources, and a side column whose
          lower third was empty — 1115px for three evaluated sources. Everything
          a source is judged on now sits on that source's own row. */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div>
          <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            مقایسه و انتخاب سورس این ماده
          </h4>
          <p className="text-2xs text-muted-foreground mt-1">
            امتیاز موتور = امتیاز پایه (از ۱۰۰) × ضریب ریسک × ضریب آزمایشگاه
          </p>
        </div>

        <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 rounded-xl px-3 py-2 self-start">
          <div className="min-w-0">
            <div className="text-2xs text-muted-foreground font-bold">پیشنهاد سیستم</div>
            <EntityName name={bestVendor.name} lines={1} className="text-xs font-bold text-primary" />
          </div>
          <div className="text-center shrink-0 border-r border-primary/20 pr-3">
            <div className="font-mono font-black text-primary text-base leading-tight" dir="ltr">
              {bestVendor.engineScore.toFixed(1)}
            </div>
            <div className="text-2xs text-muted-foreground font-bold">امتیاز موتور</div>
          </div>
        </div>
      </div>

      {isLevel && (
        <p className="text-2xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 leading-relaxed flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            اختلاف امتیاز نفر اول و دوم کمتر از {DECISIVE_MARGIN} است؛ موتور نمی‌تواند بینشان تفکیک
            معناداری قائل شود. انتخاب نهایی باید بر پایهٔ قضاوت کارشناسی و ثبت دلیل انجام شود.
          </span>
        </p>
      )}

      {/* The ranking. One row per source, carrying everything that used to be
          split between the chart and the QC table. */}
      <div className="space-y-2">
        {ranked.map(item => {
          const isBest = item.vendor.id === bestVendor.vendor.id;
          const isChosen = selection?.vendorId === item.vendor.id;
          const width = Math.max(2, (item.engineScore / barCeiling) * 100);
          return (
            <div
              key={item.vendor.id}
              className={`rounded-xl border p-3 ${
                isBest ? 'bg-primary/5 border-primary/25' : 'bg-card border-border'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <EntityName name={item.name} lines={2} className="font-bold text-foreground text-xs" />
                  {isBest && !isLevel && (
                    <span className="text-2xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-lg font-bold shrink-0">
                      پیشنهاد سیستم
                    </span>
                  )}
                  {isChosen && (
                    <span className="text-2xs text-emerald-700 bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 px-1.5 py-0.5 rounded-lg font-bold shrink-0">
                      منتخب
                    </span>
                  )}
                </div>
                <div className="text-left shrink-0">
                  <span className="font-mono font-black text-sm text-foreground" dir="ltr">
                    {item.engineScore.toFixed(1)}
                  </span>
                  <span className="text-2xs text-muted-foreground font-normal"> (پایه {item.score})</span>
                </div>
              </div>

              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden mt-2">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${isBest ? 'bg-primary' : 'bg-slate-400 dark:bg-slate-500'}`}
                  style={{ width: `${width}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                <span className="text-2xs px-2 py-0.5 rounded-lg border border-border bg-card text-muted-foreground font-medium">
                  {item.vendor.grade ? `Grade ${item.vendor.grade}` : 'بدون گرید'}
                </span>
                <span
                  className={`text-2xs px-2 py-0.5 rounded-lg border font-mono ${
                    item.scoredDepartments === 4
                      ? 'bg-card text-muted-foreground border-border'
                      : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800'
                  }`}
                  title={`امتیاز ${item.scoredDepartments} دپارتمان از ۴ ثبت شده است.`}
                >
                  {item.scoredDepartments}/۴ دپارتمان
                </span>
                {riskChip(item)}
                {labChip(item)}
              </div>
            </div>
          );
        })}

        {/* Sources with no score at all: counted and named, not ranked. */}
        {unscored.length > 0 && (
          <details className="group rounded-xl border border-dashed border-border bg-card/60">
            <summary className="cursor-pointer select-none px-3 py-2.5 text-2xs font-bold text-muted-foreground hover:text-foreground flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <ChevronDown className="w-3.5 h-3.5 shrink-0 transition-transform group-open:rotate-180" />
                {unscored.length} سورس بدون امتیاز — هنوز ارزیابی نشده‌اند
              </span>
              <span className="font-mono">۰/۴ دپارتمان</span>
            </summary>
            <ul className="px-3 pb-3 pt-0 space-y-1">
              {unscored.map(item => (
                <li key={item.vendor.id} className="flex items-center justify-between gap-2 text-2xs text-muted-foreground border-t border-border/60 pt-1.5">
                  <EntityName name={item.name} lines={1} className="text-foreground font-medium" />
                  <span className="shrink-0">
                    {item.vendor.grade ? `Grade ${item.vendor.grade}` : 'بدون گرید'} ·{' '}
                    {item.hasRisk ? 'ریسک ثبت‌شده' : 'بدون ارزیابی ریسک'}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Why the winner won — and the one guide, which used to be two.

          «چطور محاسبه می‌شود؟» explained the engine and «فرمول محاسبه» explained
          the lab multiplier, in two separate boxes a screen apart. They are one
          subject and are now one panel. */}
      <div className="bg-card border border-border rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-foreground">
            <strong className="font-bold">چرا {bestVendor.name}:</strong>{' '}
            <span className="font-mono" dir="ltr">
              {bestVendor.score} × {bestVendor.riskMod.toFixed(2)} × {bestVendor.labMod.toFixed(2)} ={' '}
              <strong className="text-primary text-sm">{bestVendor.engineScore.toFixed(1)}</strong>
            </span>
          </span>
          <button
            type="button"
            onClick={() => setShowEngineGuide(v => !v)}
            className="text-2xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer shrink-0"
          >
            <span>راهنمای محاسبه</span>
            <motion.span
              animate={{ rotate: showEngineGuide ? 180 : 0 }}
              transition={{ duration: 0.15 }}
              className="inline-block"
            >
              <ChevronDown className="w-3 h-3" />
            </motion.span>
          </button>
        </div>

        <AnimatePresence initial={false}>
          {showEngineGuide && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-3 bg-muted border border-border rounded-lg p-3 space-y-2 text-2xs text-muted-foreground leading-relaxed">
                <p>
                  <strong className="text-foreground">موتور آفلاین سیستم</strong> از یک مکانیسم امتیازدهی ترکیبی شفاف استفاده می‌کند:
                  <span className="block mt-1.5 font-mono text-primary bg-primary/5 px-2 py-1 rounded-lg border border-primary/20 font-bold w-fit" dir="ltr">
                    Engine Score = BaseScore × RiskMod × LabMod
                  </span>
                </p>
                <p><strong className="text-foreground">۱. امتیاز پایه (Base Score):</strong> میانگین وزنی فرم‌های ارزیابی بخش‌های تخصصی، از ۱۰۰.</p>
                <p><strong className="text-foreground">۲. ضریب ریسک (Risk Mod):</strong> از سطح ریسک ثبت‌شده در ارزیابی FMEA سورس گرفته می‌شود. در نبود ارزیابی، ضریب پیش‌فرض <span className="font-mono" dir="ltr">0.95x</span> اعمال می‌شود — یعنی سورس ارزیابی‌نشده جریمهٔ محتاطانه می‌گیرد و امتیازش با سورس کم‌ریسک برابر نیست.</p>
                <p>
                  <strong className="text-foreground">۳. ضریب نتایج آزمایشگاه (Lab Mod):</strong> تأثیر این بخش در بازهٔ
                  {' '}<span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold" dir="ltr">0.90x ~ 1.10x</span>{' '}
                  محاسبه می‌شود: ضریب پایه <span className="font-mono" dir="ltr">0.90x</span> است و تا سقف
                  {' '}<span className="font-mono" dir="ltr">+0.20x</span> به نسبت درصد تست‌های تأییدشده به آن اضافه می‌شود؛ به ازای هر تست
                  {' '}<span className="text-rose-600 dark:text-rose-400 font-bold">Reject</span> نیز
                  {' '}<span className="font-mono text-rose-600 dark:text-rose-400" dir="ltr">-0.10x</span> جریمه کسر می‌گردد. در نبود سابقه، ضریب خنثی
                  {' '}<span className="font-mono" dir="ltr">1.00x</span> لحاظ می‌شود.
                </p>
                <p className="text-amber-800 dark:text-amber-400">این عدد یک <strong>پیشنهاد</strong> است، نه تصمیم ثبت‌شده. انتخاب نهایی سورس باید توسط کارشناس و با ثبت دلیل انجام شود.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* The recorded decision — what was actually chosen, by whom and why. */}
      {selection && selectedEntry ? (
        <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-2xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
              سورس منتخب: {selectedEntry.name}
              {selection.vendorId !== bestVendor.vendor.id && (
                <span className="text-amber-700 dark:text-amber-400"> · متفاوت با پیشنهاد سیستم</span>
              )}
            </span>
            {onSelectSource && (
              <Button type="button" variant="link" size="sm"
                onClick={() => onSelectSource(selection.vendorId)}
                className="text-2xs text-emerald-800 dark:text-emerald-300 shrink-0 h-auto p-0">
                تغییر انتخاب
              </Button>
            )}
          </div>
          <p className="text-2xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">دلیل:</strong> {selection.reason}
          </p>
          <p className="text-2xs text-muted-foreground flex flex-wrap gap-x-3">
            <span>ثبت‌کننده: {selection.decidedBy}</span>
            <span>
              آخرین ارزیابی ثبت‌شده:{' '}
              <span className="font-mono font-bold text-foreground">
                {formatGroupDate(groupUpdateDate) || <span className="font-sans font-normal text-muted-foreground">ثبت نشده</span>}
              </span>
            </span>
          </p>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-card border border-border rounded-xl p-3">
          <span className="text-2xs text-muted-foreground">
            هنوز سورسی برای این ماده به‌طور رسمی انتخاب نشده است · آخرین ارزیابی ثبت‌شده:{' '}
            <span className="font-mono font-bold text-foreground">
              {formatGroupDate(groupUpdateDate) || 'ثبت نشده'}
            </span>
          </span>
          {onSelectSource && (
            <Button type="button" onClick={() => onSelectSource(bestVendor.vendor.id)} className="shrink-0">
              <CheckCircle />
              ثبت انتخاب سورس برای این ماده
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
