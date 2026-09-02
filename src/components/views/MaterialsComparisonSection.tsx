import React, { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle, ChevronDown, Microscope, Star } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Category, Vendor } from '../../types';
import { EntityName } from '../EntityName';
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

export const MaterialsComparisonSection: React.FC<{
  vendors: Vendor[];
  categoryId?: Category;
  /** The recorded decision for this material, when one has been made. */
  selection?: SourceSelectionRecord | null;
  /** Opens the "record this choice" dialog; omitted when the user may not write. */
  onSelectSource?: (vendorId: string) => void;
}> = ({ vendors, categoryId, selection, onSelectSource }) => {
  const [showLabModGuide, setShowLabModGuide] = useState(false);
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

  return (
    <div className="mx-6 my-6 p-6 bg-muted/50 rounded-2xl border border-border/80">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            نمودار مقایسه و تحلیل ارزیابی تامین‌کنندگان این ماده
          </h4>
          <p className="text-xs text-muted-foreground mt-1">مقایسه امتیاز کل مکتسبه و تحلیل جهت بهترین انتخاب تأمین کالا</p>
        </div>
        
        {/* Only the engine's own verdict lives here. The recorded human decision
            has its own box further down, with the reason and who made it — two
            chips saying the same name was noise. */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {bestVendor && bestVendor.score > 0 && (
            isLevel ? (
              <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-full text-xs text-amber-800 dark:text-amber-300 font-bold">
                <AlertTriangle className="w-3.5 h-3.5" />
                هم‌تراز — تصمیم انسانی لازم است
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full text-xs text-primary font-bold">
                <CheckCircle className="w-3.5 h-3.5" />
                گزینه پیشنهادی سیستم: {bestVendor.name}
              </div>
            )
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-card p-4 rounded-xl border border-border">
            {/* The bars plot the engine score, which is what the ordering is
                based on. Plotting the base score against an engine-score
                ordering meant a shorter bar could sit above a longer one and
                still be labelled the better option. */}
            <div className="mb-4 flex justify-between items-center text-xs text-muted-foreground font-semibold">
              <span>مقایسه امتیاز نهایی موتور (از ۱۰۰)</span>
              <div className="flex items-center gap-2 font-normal">
                <span className="inline-block w-3 h-3 bg-primary rounded-lg"></span>
                <span>امتیاز موتور</span>
              </div>
            </div>
            
            <div className="space-y-4">
              {chartData.map((item) => {
                const scorePercent = Math.min(100, item.engineScore);
                const isBest = item.vendor.id === bestVendor.vendor.id;
                const isChosen = selection?.vendorId === item.vendor.id;
                return (
                  <div key={item.vendor.id} className="space-y-1.5">
                    {/* The name used to share a hard 180px cap with the badges,
                        all of which are shrink-0 — so every pixel of pressure
                        landed on the name, leaving as little as ~77px for it
                        inside a card that is 600px wide. It now takes the space
                        that is actually there, and the badges wrap to a second
                        line rather than squeezing it. */}
                    <div className="flex justify-between items-start text-xs gap-3">
                      <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <EntityName name={item.name} lines={2} className="font-bold text-foreground" />
                        {isChosen && <span className="text-2xs text-emerald-700 bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 px-1.5 py-0.5 rounded-lg font-bold shrink-0">منتخب</span>}
                        {isBest && !isLevel && !isChosen && <span className="text-2xs text-primary bg-primary/10 px-1.5 py-0.5 rounded-lg font-normal shrink-0">برتر</span>}
                        {/* Completeness, so a partly evaluated source is not read as an equal peer. */}
                        <span
                          className={`text-2xs px-1.5 py-0.5 rounded-lg font-mono shrink-0 border ${
                            item.scoredDepartments === 4 && item.hasRisk
                              ? 'bg-muted text-muted-foreground border-border'
                              : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800'
                          }`}
                          title={`امتیاز ${item.scoredDepartments} دپارتمان از ۴ · ارزیابی ریسک: ${item.hasRisk ? 'دارد' : 'ندارد'} · تست آزمایشگاه: ${item.hasLabAssessment ? 'دارد' : 'ندارد'}`}
                        >
                          {item.scoredDepartments}/۴{item.hasRisk ? '' : <AlertTriangle className="w-3 h-3 inline-block mr-1 -mt-px" />}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-foreground shrink-0">
                        {item.engineScore.toFixed(1)}
                        <span className="text-gray-400 font-normal text-2xs"> (پایه {item.score})</span>
                      </span>
                    </div>
                    <div className="h-5 w-full bg-muted rounded-full overflow-hidden flex items-center relative">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ${
                          isBest ? 'bg-gradient-to-l from-primary to-primary/60' : 'bg-gradient-to-l from-slate-500 to-slate-400'
                        }`}
                        style={{ width: `${scorePercent}%` }}
                      />
                      <div className="absolute left-3 text-2xs text-gray-500 font-sans pointer-events-none">
                        {item.vendor.grade ? `Grade ${item.vendor.grade}` : 'بدون گرید'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border">
             <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
               <h5 className="font-bold text-foreground text-xs flex items-center gap-2">
                 <Microscope className="w-4 h-4 text-indigo-600" />
                 مقایسه نتایج تست آزمایشگاهی / QC
               </h5>
               <button 
                 onClick={() => setShowLabModGuide(!showLabModGuide)}
                 className="text-2xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
               >
                 <span>فرمول محاسبه</span>
                 <motion.span
                   animate={{ rotate: showLabModGuide ? 180 : 0 }}
                   transition={{ duration: 0.15 }}
                   className="inline-block"
                 >
                   <ChevronDown className="w-3 h-3" />
                 </motion.span>
               </button>
             </div>

             <AnimatePresence initial={false}>
               {showLabModGuide && (
                 <motion.div 
                   initial={{ height: 0, opacity: 0 }}
                   animate={{ height: "auto", opacity: 1 }}
                   exit={{ height: 0, opacity: 0 }}
                   transition={{ duration: 0.2, ease: "easeOut" }}
                   className="overflow-hidden"
                 >
                   <p className="text-2xs text-muted-foreground mb-3 bg-muted p-3 rounded-lg border border-border leading-relaxed shadow-sm block">
                      <strong className="text-foreground">نحوه محاسبه ضریب نتایج آزمایشگاه (Lab Mod):</strong><br/>
                      تأثیر این بخش در بازه <span className="font-mono text-indigo-600 font-bold" dir="ltr">0.90x ~ 1.10x</span> (قبل از احتساب جریمه‌های ردی) محاسبه می‌شود:<br/>
                      <span className="block mt-1.5"><span className="inline-block w-1 h-1 bg-emerald-500 rounded-full ml-1.5 align-middle"></span> <strong>پایه و پاداش تست مثبت:</strong> ضریب پایه سیستم <strong><span className="font-mono">0.90x</span></strong> است. تا سقف <strong><span className="font-mono">+0.20x</span></strong> (به نسبت درصد تست‌های تایید شده دستگاه) به این پایه اضافه می‌شود. (مثلا اگر ۱۰۰٪ تست‌ها پاس شوند ضریب کامل ۱.۱۰ لحاظ می‌گردد).</span>
                      <span className="block mt-1"><span className="inline-block w-1 h-1 bg-rose-500 rounded-full ml-1.5 align-middle"></span> <strong>جریمه تست مردودی:</strong> به ازای هر ۱ تست که مردود (<span className="text-rose-600 font-bold">Reject</span>) شده باشد، مستقیماً ضریب <strong><span className="font-mono text-rose-600">-0.10x</span></strong> به عنوان جریمه از ضریب کل آزمایشگاه کسر می‌گردد.</span>
                   </p>
                 </motion.div>
               )}
             </AnimatePresence>
             {/* `w-full` alone let the table squeeze instead of scroll, so on a
                 phone the headers wrapped to two lines. A min-width hands the
                 overflow to the scroll container that is already here. */}
             <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-right text-xs">
                   <thead>
                     <tr className="border-b border-border text-muted-foreground font-semibold">
                       <th className="pb-2">سورس</th>
                       <th className="pb-2 text-center">کل تست‌ها</th>
                       <th className="pb-2 text-center text-emerald-600">پاس/تایید</th>
                       <th className="pb-2 text-center text-rose-600">مردود</th>
                       <th className="pb-2 text-center">ضریب موتور</th>
                     </tr>
                   </thead>
                   <tbody>
                     {chartData.map(item => (
                        <tr key={item.vendor.id} className="border-b border-border/60 last:border-0 text-foreground">
                           <td className="py-2.5 font-medium">{item.name} {item.vendor.id === bestVendor.vendor.id && <Star className="w-3 h-3 inline-block text-primary fill-primary mx-1 -mt-px" />}</td>
                           <td className="py-2.5 text-center font-mono">{item.analysisMeta.total || '-'}</td>
                           <td className="py-2.5 text-center font-mono text-emerald-600">{item.hasLabAssessment ? (item.analysisMeta.pass + item.analysisMeta.app) : '-'}</td>
                           <td className="py-2.5 text-center font-mono text-rose-600">{item.hasLabAssessment ? item.analysisMeta.reject : '-'}</td>
                           <td className="py-2.5 text-center font-mono text-indigo-600" dir="ltr">{item.hasLabAssessment ? item.labMod.toFixed(2) + 'x' : '-'}</td>
                        </tr>
                     ))}
                   </tbody>
                </table>
             </div>
          </div>
        </div>

        <div className="lg:col-span-5 bg-primary/2 p-5 rounded-xl border border-primary/5 flex flex-col justify-between">
          {/* Result first, explanation on demand.
              The three bullets that used to sit here restated, in prose, the
              same three numbers as the formula line below them — and this panel
              repeats under every material, so the teaching text was read once
              and skipped thereafter. The numbers stay visible as chips; the
              wording moved behind the toggle that `showEngineGuide` was already
              declared for but never wired to. */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-2xs text-primary font-bold tracking-wider uppercase border border-primary/20 bg-primary/10 px-2 py-0.5 rounded-lg">موتور تحلیل سیستم (Local Engine)</div>
              <button
                type="button"
                onClick={() => setShowEngineGuide(!showEngineGuide)}
                className="text-2xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer shrink-0"
              >
                <span>چطور محاسبه می‌شود؟</span>
                <motion.span
                  animate={{ rotate: showEngineGuide ? 180 : 0 }}
                  transition={{ duration: 0.15 }}
                  className="inline-block"
                >
                  <ChevronDown className="w-3 h-3" />
                </motion.span>
              </button>
            </div>
            <h5 className="font-bold text-foreground text-sm mb-3">چرا {bestVendor.name} پیشنهاد می‌شود؟</h5>

            <div className="text-xs text-foreground leading-relaxed">
              {/* The whole reasoning in one row of chips. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-2xs bg-card border border-border px-2 py-1 rounded-lg">
                  پایه <strong className="text-foreground">{bestVendor.score}</strong>
                </span>
                <span className={`font-mono text-2xs px-2 py-1 rounded-lg border ${
                  bestVendor.hasRisk
                    ? 'bg-card border-border'
                    : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400'
                }`} title={bestVendor.hasRisk ? undefined : 'ارزیابی ریسک ثبت نشده؛ ضریب پیش‌فرض ۰.۹۵ اعمال شده که یک جریمهٔ محتاطانه است، نه ضریب خنثی.'}>
                  ریسک {bestVendor.vendor.riskAssessment?.riskLevel || '—'} <strong dir="ltr">×{bestVendor.riskMod.toFixed(2)}</strong>
                </span>
                <span className={`font-mono text-2xs px-2 py-1 rounded-lg border ${
                  bestVendor.hasLabAssessment
                    ? 'bg-card border-border'
                    : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400'
                }`} title={bestVendor.hasLabAssessment ? undefined : 'سابقهٔ تست آزمایشگاهی وجود ندارد؛ ضریب خنثی لحاظ شده است.'}>
                  آزمایشگاه <strong dir="ltr">×{bestVendor.labMod.toFixed(2)}</strong>
                </span>
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
                      <p><strong className="text-foreground">۱. امتیاز کل (Base Score):</strong> میانگین وزنی فرم‌های ارزیابی بخش‌های تخصصی، از ۱۰۰.</p>
                      <p><strong className="text-foreground">۲. ضریب ریسک (Risk Mod):</strong> از سطح ریسک ثبت‌شده در ارزیابی FMEA سورس گرفته می‌شود. در نبود ارزیابی، ضریب پیش‌فرض <span className="font-mono" dir="ltr">0.95x</span> اعمال می‌شود — یعنی سورس ارزیابی‌نشده جریمهٔ محتاطانه می‌گیرد و امتیازش با سورس کم‌ریسک برابر نیست.</p>
                      <p><strong className="text-foreground">۳. ضریب نتایج آزمایشگاه (Lab Mod):</strong> از سوابق QC و نسبت تست‌های قبول/رد. جزئیات فرمول در جدول «مقایسه نتایج تست آزمایشگاهی» آمده است. در نبود سابقه، ضریب خنثی <span className="font-mono" dir="ltr">1.00x</span>.</p>
                      <p className="text-amber-800 dark:text-amber-400">این عدد یک <strong>پیشنهاد</strong> است، نه تصمیم ثبت‌شده. انتخاب نهایی سورس باید توسط کارشناس و با ثبت دلیل انجام شود.</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-3 pt-3 border-t border-primary/20 flex items-center justify-between gap-2">
                 <span className="font-bold text-foreground">امتیاز نهایی سیستم:</span>
                 <span className="font-mono text-sm" dir="ltr">
                   {bestVendor.score} × {bestVendor.riskMod.toFixed(2)} × {bestVendor.labMod.toFixed(2)} = <strong className="text-[16px] text-primary bg-card px-2 rounded-lg shadow-sm border border-border">{bestVendor.engineScore.toFixed(1)}</strong>
                 </span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-primary/10 space-y-3">
            {isLevel && (
              <p className="text-2xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 leading-relaxed">
                اختلاف امتیاز نفر اول و دوم کمتر از {DECISIVE_MARGIN} است؛ موتور نمی‌تواند بینشان تفکیک معناداری قائل شود.
                انتخاب نهایی باید بر پایهٔ قضاوت کارشناسی و ثبت دلیل انجام شود.
              </p>
            )}

            {/* The recorded decision — what was actually chosen, by whom and why. */}
            {selection && selectedEntry ? (
              <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5" />
                    سورس منتخب: {selectedEntry.name}
                  </span>
                  {onSelectSource && (
                    <button type="button" onClick={() => onSelectSource(selection.vendorId)}
                      className="text-2xs font-bold text-emerald-800 dark:text-emerald-300 hover:underline cursor-pointer shrink-0">
                      تغییر انتخاب
                    </button>
                  )}
                </div>
                <p className="text-2xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">دلیل:</strong> {selection.reason}
                </p>
                <p className="text-2xs text-muted-foreground">
                  ثبت‌کننده: {selection.decidedBy}
                  {selection.vendorId !== bestVendor.vendor.id && (
                    <span className="text-amber-700 dark:text-amber-400 font-bold"> · متفاوت با پیشنهاد سیستم</span>
                  )}
                </p>
              </div>
            ) : onSelectSource ? (
              <button type="button" onClick={() => onSelectSource(bestVendor.vendor.id)}
                className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer">
                <CheckCircle className="w-4 h-4" />
                ثبت انتخاب سورس برای این ماده
              </button>
            ) : (
              <p className="text-2xs text-muted-foreground text-center">
                هنوز سورسی برای این ماده به‌طور رسمی انتخاب نشده است.
              </p>
            )}

            <div className="flex justify-between items-center text-2xs text-muted-foreground">
              <span>آخرین ارزیابی ثبت‌شده:</span>
              <span className="font-mono font-bold text-foreground">
                {groupUpdateDate || <span className="font-sans font-normal text-muted-foreground">ارزیابی ثبت نشده</span>}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
