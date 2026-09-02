import React, { useEffect, useState } from 'react';
import { CheckCircle, ShieldAlert, X } from 'lucide-react';
import { RiskAssessmentData, User, Vendor } from '../../types';
import { Button } from '../ui/button';
import { FmeaService } from '../../utils/fmeaService';
import { calculateOverallScore } from '../../utils/vendorUtils';
import { can } from '../../utils/permissions';
import { cn } from '../../lib/utils';
import { inputBaseClass } from '../ui/input';

// extracted from App.tsx

function RiskHeatmap({ criticality, probability, detectability }: { criticality: number; probability: number; detectability: number }) {
  // rows: criticality 5→1 (top=most critical) · cols: probability 1→5
  const rows = [5, 4, 3, 2, 1];
  const cols = [1, 2, 3, 4, 5];
  const cellColor = (c: number, p: number) => {
    const rpn = c * p; // 1..25
    if (rpn >= 15) return 'bg-red-500/25 border-red-500/40';
    if (rpn >= 8) return 'bg-amber-500/25 border-amber-500/40';
    return 'bg-emerald-500/20 border-emerald-500/40';
  };
  return (
    <div className="bg-muted border border-border rounded-xl p-4" dir="ltr">
      <div className="text-foreground font-bold text-sm mb-3 text-center">
        ماتریس ریسک (اهمیت × احتمال)
      </div>
      <div className="flex items-stretch gap-2">
        {/* Y-axis label */}
        <div className="flex items-center">
          <span className="text-2xs text-muted-foreground font-bold [writing-mode:vertical-rl] rotate-180">
            Criticality →
          </span>
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-5 gap-1">
            {rows.map(c =>
              cols.map(p => {
                const active = c === criticality && p === probability;
                return (
                  <div
                    key={`${c}-${p}`}
                    className={`relative aspect-square rounded-md border flex items-center justify-center text-xs font-mono font-bold transition-all ${cellColor(c, p)} ${
                      active ? 'ring-2 ring-ring scale-105 z-10 shadow-lg' : 'opacity-90'
                    }`}
                    title={`Criticality ${c} × Probability ${p} = RPN(2D) ${c * p}`}
                  >
                    <span className="text-foreground">{c * p}</span>
                    {active && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-primary border border-card" />
                    )}
                  </div>
                );
              })
            )}
          </div>
          {/* X-axis labels */}
          <div className="grid grid-cols-5 gap-1 mt-1">
            {cols.map(p => (
              <div key={p} className="text-center text-2xs text-muted-foreground font-bold">{p}</div>
            ))}
          </div>
          <div className="text-center text-2xs text-muted-foreground font-bold mt-1">Probability →</div>
        </div>
      </div>
      {/* Detectability factor → full 3D RPN */}
      <div className="flex items-center justify-center gap-2 mt-3 text-xs">
        <span className="text-muted-foreground font-mono" dir="ltr">
          {criticality} × {probability} = <span className="text-amber-600 dark:text-amber-400 font-bold">{criticality * probability}</span>
        </span>
        <span className="text-muted-foreground">×</span>
        <span className="text-muted-foreground">تشخیص <span className="font-mono text-foreground font-bold">{detectability}</span></span>
        <span className="text-muted-foreground">=</span>
        <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300 font-mono font-black">
          RPN {criticality * probability * detectability}
        </span>
      </div>
      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-3 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/40" /> پایین</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-500/40" /> متوسط</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/30 border border-red-500/40" /> بالا</span>
      </div>
    </div>
  );
}

export function RiskAssessmentForm({ vendor, onSave, onClose, currentUser, onDirtyChange }: { vendor: Vendor, onSave: (v: Vendor, msg?: string | null) => void, onClose: () => void, currentUser: User | null, onDirtyChange?: (dirty: boolean) => void }) {
  const spsScore = calculateOverallScore(vendor.scores, true) || 0;
  
  // Calculate recommended probability based on SPS via the isolated FmeaService
  const recommendedProb = FmeaService.getRecommendedProbability(spsScore);

  const [criticality, setCriticality] = useState<number>(vendor.riskAssessment?.materialCriticality || 5);
  const [detectability, setDetectability] = useState<number>(vendor.riskAssessment?.detectability || 1);
  const [probability, setProbability] = useState<number>(vendor.riskAssessment?.probability || recommendedProb);
  const [isSuccess, setIsSuccess] = useState(false);

  // Like the evaluation form, this is an inline section rather than a dialog, so
  // it reports upward and the page carries the guard. The three sliders are
  // compared against the stored assessment (or the defaults offered for a first
  // one), so opening the form without moving anything asks no question.
  useEffect(() => {
    const initial = [
      vendor.riskAssessment?.materialCriticality || 5,
      vendor.riskAssessment?.detectability || 1,
      vendor.riskAssessment?.probability || recommendedProb,
    ];
    const dirty = !isSuccess
      && [criticality, detectability, probability].some((v, i) => v !== initial[i]);
    onDirtyChange?.(dirty);
  }, [criticality, detectability, probability, isSuccess, vendor.riskAssessment, recommendedProb, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  /**
   * A native alert() used to carry the permission refusal: it blocked the
   * interface, ignored the page's direction and theme, and left nothing behind
   * once dismissed. The message now sits with the button it belongs to.
   *
   * VendorDetail only renders this form for someone who holds `vendor.risk`,
   * so this is a safety net rather than a path users normally take — and the
   * API is what actually refuses the write either way (CLAUDE.md rule 14).
   */
  const [error, setError] = useState<string | null>(null);

  // Call the isolated FmeaService to run the full FMEA mathematical assessment
  const { riskScore, sri, riskLevel } = FmeaService.performAssessment(criticality, detectability, probability, spsScore);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!can(currentUser, 'vendor.risk')) {
      setError('ثبت ارزیابی ریسک در سطح دسترسی شما نیست. برای انجام آن با مدیر سیستم تماس بگیرید.');
      return;
    }
    setError(null);

    const assessment: RiskAssessmentData = {
      materialCriticality: criticality,
      detectability: detectability,
      probability: probability,
      sps: spsScore,
      riskScore,
      sri: sri,
      riskLevel,
      date: new Date().toLocaleDateString('fa-IR'),
      evaluator: currentUser?.name || 'کاربر سیستم'
    };

    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `ثبت ارزیابی ریسک برای "${vendor.material}" (${vendor.name}) - سطح ریسک: ${riskLevel === 'High' ? 'بالا (High)' : riskLevel === 'Medium' ? 'متوسط (Medium)' : riskLevel === 'Low' ? 'پایین (Low)' : 'نامشخص'}، امتیاز نهایی: ${riskScore}، شاخص SRI: ${sri || 'N/A'}`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };

    onSave({
      ...vendor,
      riskAssessment: assessment,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, null);
    
    setIsSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1000);
  };

  if (isSuccess) {
    return (
      <div className="bg-card border border-emerald-500/20 rounded-2xl p-16 text-center flex flex-col items-center justify-center mb-8 shadow-sm fade-in">
        <div className="bg-emerald-500/10 p-4 rounded-full border border-emerald-500/20 mb-6">
          <CheckCircle className="w-16 h-16 text-emerald-500 bounce-in" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-2">ارزیابی ریسک با موفقیت ثبت شد</h3>
        <p className="text-muted-foreground font-medium">نتایج ارزیابی ریسک و محاسبات شاخص SRI با موفقیت ثبت گردید. در حال بازگشت...</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6 md:p-8 mb-8 shadow-sm fade-in">
      <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
        <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          ارزیابی ریسک تامین کنندگان (Supplier Risk Assessment)
        </h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}
          className="text-muted-foreground hover:text-foreground">
          <X />
        </Button>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Material Criticality */}
          <div className="space-y-3 p-4 bg-muted rounded-xl border border-border">
            <label className="block text-sm font-semibold text-foreground">۱. اهمیت ماده (Material Criticality)</label>
            <select value={criticality} onChange={e => setCriticality(Number(e.target.value))} className={cn(inputBaseClass, 'w-full cursor-pointer')}>
              <option value={5}>ماده موثره - امتیاز ۵</option>
              <option value={4}>اکسپیانت - امتیاز ۴</option>
              <option value={3}>حدواسط شیمیایی، حلال ها و واکنشگرها - امتیاز ۳</option>
              <option value={2}>اقلام بسته بندی اولیه - امتیاز ۲</option>
              <option value={1}>اقلام بسته بندی ثانویه - امتیاز ۱</option>
            </select>
          </div>

          {/* Probability of Failure */}
          <div className="space-y-3 p-4 bg-muted rounded-xl border border-border">
            <label className="block text-sm font-semibold text-foreground">۲. احتمال خرابی (Probability of failure)</label>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>SPS فعلی: <strong className="text-amber-600 dark:text-amber-400 text-sm">{spsScore > 0 ? spsScore : 'تعیین نشده'}</strong></span>
            </div>
            <select value={probability} onChange={e => setProbability(Number(e.target.value))} className={cn(inputBaseClass, 'w-full cursor-pointer')}>
              <option value={1}>عدم خرابی (SPS: 80-100) - امتیاز ۱</option>
              <option value={2}>احتمال کم (SPS: 60-79) - امتیاز ۲</option>
              <option value={3}>احتمال متوسط (SPS: 40-59) - امتیاز ۳</option>
              <option value={4}>احتمال زیاد (SPS: 25-39) - امتیاز ۴</option>
              <option value={5}>به شدت محتمل (SPS: 1-24) - امتیاز ۵</option>
            </select>
          </div>

          {/* Detectability */}
          <div className="space-y-3 p-4 bg-muted rounded-xl border border-border md:col-span-2">
            <label className="block text-sm font-semibold text-foreground">۳. تشخیص (Detectability)</label>
            <select value={detectability} onChange={e => setDetectability(Number(e.target.value))} className={cn(inputBaseClass, 'w-full cursor-pointer')}>
              <option value={1}>تمام مشکلات توسط QC قابل تشخیص - امتیاز ۱</option>
              <option value={2}>اکثر مشکلات قابل تشخیص - امتیاز ۲</option>
              <option value={3}>بخشی قابل تشخیص - امتیاز ۳</option>
              <option value={4}>تشخیص دشوار - امتیاز ۴</option>
              <option value={5}>تقریبا غیر قابل تشخیص - امتیاز ۵</option>
            </select>
          </div>
        </div>

        {/* Visual risk matrix */}
        <RiskHeatmap criticality={criticality} probability={probability} detectability={detectability} />

        {/* Info / Formulas */}
        <div className="bg-muted border border-border rounded-xl p-4 text-sm text-muted-foreground">
          <div className="font-bold text-foreground mb-2 border-b border-border pb-2">نحوه محاسبه شاخص‌ها:</div>
          <div className="space-y-2 font-mono text-xs md:text-sm" dir="ltr">
            <div className="flex gap-2">
               <span className="text-amber-600 dark:text-amber-400 font-bold shrink-0">RPN (Risk Score) =</span>
               <span className="text-muted-foreground break-all">Material Criticality × Probability of failure × Detectability</span>
            </div>
            <div className="flex gap-2">
               <span className="text-amber-600 dark:text-amber-400 font-bold shrink-0">SRI (Supplier Risk Index) =</span>
               <span className="text-muted-foreground break-all">(0.6 × RPN) + (0.4 × (100 - SPS Score))</span>
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl px-3.5 py-2.5 text-xs font-semibold">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Results */}
        <div className="bg-muted p-5 rounded-xl border border-border flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Risk Score</div>
              <div className="text-xl font-bold tabular-nums text-foreground">{riskScore}</div>
            </div>
            <div className="h-8 w-px bg-border"></div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Supplier Risk Index (SRI)</div>
              <div className="text-xl font-bold tabular-nums text-foreground">{sri.toFixed(1)}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-1">سطح ریسک (Risk Level)</div>
              <div className={`text-xl font-bold ${riskLevel === 'Low' ? 'text-emerald-600 dark:text-emerald-400' : riskLevel === 'Medium' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                {riskLevel === 'Low' ? 'پایین (Low)' : riskLevel === 'Medium' ? 'متوسط (Medium)' : 'بالا (High)'}
              </div>
            </div>
            <Button type="button" onClick={handleSubmit}>
              ثبت نتیجه ارزیابی ریسک
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- View: Evaluation Form Layout & Helpers ---
