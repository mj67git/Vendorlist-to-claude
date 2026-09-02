import React, { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Archive, CheckCircle } from 'lucide-react';
import { getScoreColorClass } from '../../components/ScoreBar';
import { ScoringGuide } from '../../components/ScoringGuide';
import { Scores, User, Vendor } from '../../types';
import { calculateOverallScore } from '../../utils/vendorUtils';
import { FORM_LAYOUT } from '../../constants/evaluationLayout';
import { calculateDeptAverage, getRawScoreValue, deconstructScores } from '../../utils/scoreUtils';
import { canScoreDepartment } from '../../utils/permissions';

// extracted from App.tsx

// --- View: Evaluation Form ---
export function EvaluationForm({ vendor, onSave, onClose, currentUser, onDirtyChange }: { vendor: Vendor, onSave: (v: Vendor, msg?: string | null) => void, onClose: () => void, currentUser: User | null, onDirtyChange?: (dirty: boolean) => void }) {
  const [scores, setScores] = useState<Record<string, Record<string, number>>>(() => {
    const initialDepts = ['commercial', 'qa', 'planning', 'finance'];
    const res: Record<string, Record<string, number>> = {};
    initialDepts.forEach(dept => {
      res[dept] = {};
      const layout = FORM_LAYOUT.find(l => l.id === dept);
      if (layout) {
        layout.criteria.forEach(crit => {
          res[dept][crit.key] = getRawScoreValue(vendor, dept, crit.key);
        });
      }
    });
    return res;
  });

  useEffect(() => {
    const initialDepts = ['commercial', 'qa', 'planning', 'finance'];
    const res: Record<string, Record<string, number>> = {};
    initialDepts.forEach(dept => {
      res[dept] = {};
      const layout = FORM_LAYOUT.find(l => l.id === dept);
      if (layout) {
        layout.criteria.forEach(crit => {
          res[dept][crit.key] = getRawScoreValue(vendor, dept, crit.key);
        });
      }
    });
    setScores(res);
  }, [vendor.id, vendor.scores, vendor.rawScores]);

  const [modifiedDepts, setModifiedDepts] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // This form is an inline section of the source page, not a dialog, so leaving
  // the page is what loses it. It reports upward and the page registers the same
  // unsaved-changes guard the source form uses. `modifiedDepts` is the honest
  // signal: it is set when a score is actually moved, so merely opening the form
  // to look at the questions does not raise a warning.
  useEffect(() => {
    const dirty = Object.values(modifiedDepts).some(Boolean) || comments.trim().length > 0;
    onDirtyChange?.(dirty);
  }, [modifiedDepts, comments, onDirtyChange]);

  // Leaving the form must clear the guard, or the page keeps warning about a
  // form that is no longer on screen.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const [isSuccess, setIsSuccess] = useState(false);

  // Only the departments this user may score are rendered — admin gets all four.
  const visibleFormLayout = FORM_LAYOUT.filter(d => canScoreDepartment(currentUser, d.id));

  const handleSlider = (deptId: string, critKey: string, val: string) => {
    setScores(prev => ({
      ...prev,
      [deptId]: { ...prev[deptId], [critKey]: parseInt(val, 10) }
    }));
    setModifiedDepts(prev => ({
      ...prev,
      [deptId]: true
    }));
  };


  const handleSave = () => {
    setIsSaving(true);
    
    setTimeout(() => {
      const prevScores = vendor.scores || { commercial: 0, qa: 0, planning: 0, finance: 0 };
      const submittedScores = {
        commercial: calculateDeptAverage('commercial', scores.commercial),
        qa: calculateDeptAverage('qa', scores.qa),
        planning: calculateDeptAverage('planning', scores.planning),
        finance: calculateDeptAverage('finance', scores.finance)
      };

      const effectiveModifiedDepts = { ...modifiedDepts };
      visibleFormLayout.forEach(dept => {
        effectiveModifiedDepts[dept.id] = true;
      });

      const finalScores = {
        commercial: effectiveModifiedDepts.commercial ? submittedScores.commercial : (prevScores.commercial || 0),
        qa: effectiveModifiedDepts.qa ? submittedScores.qa : (prevScores.qa || 0),
        planning: effectiveModifiedDepts.planning ? submittedScores.planning : (prevScores.planning || 0),
        finance: effectiveModifiedDepts.finance ? submittedScores.finance : (prevScores.finance || 0)
      };

      const finalRawScores = {
        commercial: effectiveModifiedDepts.commercial ? scores.commercial : vendor.rawScores?.commercial,
        qa: effectiveModifiedDepts.qa ? scores.qa : vendor.rawScores?.qa,
        planning: effectiveModifiedDepts.planning ? scores.planning : vendor.rawScores?.planning,
        finance: effectiveModifiedDepts.finance ? scores.finance : vendor.rawScores?.finance
      };

      const isFullyScored = finalScores.commercial > 0 && finalScores.qa > 0 && finalScores.planning > 0 && finalScores.finance > 0;
      
      let grade = vendor.grade;
      let pStatus = vendor.status;
      const pCategory = vendor.category;

      if (isFullyScored) {
        const overall = calculateOverallScore(finalScores);
        if (overall! >= 80) {
          grade = 'A';
          pStatus = 'approved';
        } else if (overall! >= 60) {
          grade = 'B';
          pStatus = 'approved';
        } else if (overall! >= 40) {
          grade = 'C';
          pStatus = 'conditional';
        } else {
          grade = 'rejected';
          pStatus = 'rejected';
        }
      }

      const statusMapList = { approved: 'تایید شده', conditional: 'تایید مشروط', rejected: 'مردود', new: 'جدید' };
      const newLog = {
        id: 'log_' + Math.random().toString(36).substring(2, 8),
        action: `ثبت ارزیابی نهایی سورس "${vendor.material}" (${vendor.name}) - گرید نهایی: [Grade ${grade}]، وضعیت جدید: [${statusMapList[pStatus] || pStatus}] (امتیازات: آزمایشگاهی: ${finalScores.qa || 0}، بازرگانی: ${finalScores.commercial || 0}، برنامه‌ریزی: ${finalScores.planning || 0}، مالی: ${finalScores.finance || 0})`,
        date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
        user: currentUser?.name || 'کاربر سیستم'
      };

      onSave({
        ...vendor,
        status: pStatus,
        grade: grade,
        category: pCategory,
        scores: finalScores,
        rawScores: finalRawScores,
        lastAudit: isFullyScored ? new Date().toLocaleDateString('fa-IR') : vendor.lastAudit,
        activityLogs: [...(vendor.activityLogs || []), newLog]
      }, null);

      setIsSaving(false);
      setIsSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1000);
    }, 600);
  };

  if (isSuccess) {
    return (
      <div className="bg-card border border-emerald-500/20 rounded-xl p-16 text-center shadow-sm flex flex-col items-center justify-center fade-in">
        <div className="bg-emerald-50/10 p-4 rounded-full border border-emerald-500/20 mb-6">
          <CheckCircle className="w-16 h-16 text-emerald-500 bounce-in" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-2">ارزیابی با موفقیت ثبت شد</h3>
        <p className="text-muted-foreground font-medium">اطلاعات امتیازدهی و نتایج ارزیابی با موفقیت ثبت گردید. در حال بازگشت...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ScoringGuide currentUser={currentUser} />

      <div className="bg-card border border-border rounded-xl p-6 md:p-8 fade-in shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {visibleFormLayout.map(dept => {
             const Icon = dept.icon;
             const isModified = modifiedDepts[dept.id] || false;
             const prevDeptScore = vendor.scores?.[dept.id as keyof Scores] || 0;
             const avg = isModified ? calculateDeptAverage(dept.id, scores[dept.id]) : prevDeptScore;

             return (
               <div key={dept.id} className="bg-muted border border-border rounded-xl p-5 relative overflow-hidden group">
                  <div className={`absolute top-0 right-0 w-full h-[3px] opacity-80 ${getScoreColorClass(avg, true)}`} />
                  <div className="flex justify-between items-center mb-6">
                     <div className="flex items-center gap-3">
                       <div className="bg-card p-2 rounded-lg border border-border shadow-sm">
                         <Icon className="w-5 h-5 text-muted-foreground" />
                       </div>
                       <div>
                         <h4 className="font-bold text-foreground leading-none">{dept.title}</h4>
                         <span className="text-2xs text-muted-foreground font-medium block mt-1">
                           <span className="text-muted-foreground">بخش ارزیابی دپارتمانی</span>
                         </span>
                       </div>
                     </div>
                     <div className="text-right">
                       <div className="text-2xs text-muted-foreground font-semibold mb-0.5">میانگین بخش</div>
                       <div className={`text-2xl font-black font-mono tracking-tighter ${getScoreColorClass(avg)}`}>
                         {avg}
                       </div>
                     </div>
                  </div>

                  <div className="space-y-4">
                    {dept.criteria.map(crit => {
                      const prevValue = vendor.rawScores?.[dept.id]?.[crit.key] ??
                                        (vendor.scores && (vendor.scores as any)[dept.id] > 0
                                          ? Math.round((vendor.scores as any)[dept.id] / 20)
                                          : 0);
                      const isChanged = scores[dept.id][crit.key] !== prevValue;

                      return (
                        <div key={crit.key} className="bg-card border border-border rounded-lg p-3 space-y-2 shadow-xs">
                          <div className="flex justify-between items-start text-xs">
                            <span className="text-foreground font-medium leading-relaxed max-w-[70%]">{crit.label} <span className="text-cyan-600 font-semibold ml-1">(وزن: {crit.weight})</span></span>
                            <div className="flex items-center gap-1.5 shrink-0 select-none">
                              {prevValue > 0 && (
                                <span className="text-2xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/60 font-medium">
                                  قبلی: {prevValue}
                                </span>
                              )}
                              <span className={`text-2xs px-1.5 py-0.5 rounded border font-mono font-bold ${
                                isChanged
                                  ? 'text-amber-700 bg-amber-50 border-amber-200 animate-pulse'
                                  : 'text-muted-foreground bg-muted border-border'
                              }`}>
                                {scores[dept.id][crit.key]} / 5
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <input
                              type="range" dir="ltr"
                              min="1" max="5" step="1"
                              value={scores[dept.id][crit.key]}
                              onChange={(e) => handleSlider(dept.id, crit.key, e.target.value)}
                              className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-cyan-600 focus:outline-none"
                            />

                          </div>
                        </div>
                      );
                    })}
                  </div>
               </div>
             )
          })}
       </div>

       <div className="mb-8">
         <label className="block text-sm font-bold text-foreground mb-2">توضیحات و توجیه ارزیابی</label>
         <textarea
          
           rows={4}
           className="w-full bg-card border border-border rounded-xl p-4 text-sm text-foreground focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 resize-none shadow-sm transition-shadow"
           placeholder="موارد کیفی مهم، تعهدات اخذ شده جهت بهبود، یا دلایل اعطای نمرات پایین..."
           value={comments}
           onChange={(e) => setComments(e.target.value)}
         ></textarea>
       </div>

       <div className="flex flex-col md:flex-row items-center justify-end gap-6 border-t border-border pt-6">
         <Button
           size="lg"
           onClick={handleSave}
           disabled={isSaving}
           className="w-full md:w-auto flex-row-reverse bg-foreground text-background hover:bg-foreground/90"
         >
           {isSaving ? (
             <span className="inline-block w-5 h-5 border-2 border-muted-foreground border-t-background rounded-full animate-spin" />
           ) : (
             <Archive className="w-5 h-5" />
           )}
            <span>ذخیره ارزیابی</span>
          </Button>
        </div>
     </div>
     </div>
   );
}
