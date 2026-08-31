import React, { useEffect, useState } from 'react';
import { Activity, AlertCircle, AlertTriangle, Building2, CheckCircle, ChevronLeft, ChevronRight, ClipboardCheck, DollarSign, Factory, FileText, Globe, Handshake, History, Info, Mail, MapPin, Microscope, Pencil, Phone, Plus, ShieldAlert, Trash2, User as UserIcon } from 'lucide-react';
import { CartesianGrid, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { EntityName } from '../../components/EntityName';
import { GradeBadge } from '../../components/GradeBadge';
import { getScoreColorClass, getScoreColorConfig } from '../../components/ScoreBar';
import { ScoreCard } from '../../components/ScoringGuide';
import { ShamsiDatePicker } from '../../components/ShamsiDatePicker';
import { authFetch } from '../../services/authFetch';
import { AnalysisRecord, BusinessPartner, Material, Status, User, Vendor } from '../../types';
import { Badge } from '../ui/badge';
import { calculateOverallScore, checkLicenseExpiry } from '../../utils/vendorUtils';
import { EvaluationForm } from './EvaluationForm';
import { RiskAssessmentForm } from './RiskAssessmentForm';
import { FORM_LAYOUT } from '../../constants/evaluationLayout';
import { resolveMaterialNames } from '../../utils/materialNames';
import { getRawScoreValue } from '../../utils/scoreUtils';
import { formatLocation, resolveVendorPartner } from '../../utils/vendorPartner';
import { can, canScoreDepartment, scorableDepartments } from '../../utils/permissions';

// extracted from App.tsx

export function VendorDetail({ vendor, db, onBack, onSave, onDelete, currentUser, materials = [], onAddMaterial, partners = [], onAddPartner, registerNavGuard, onEditVendor }: { vendor: Vendor, db: Vendor[], onBack: () => void, onSave: (v: Vendor, msg?: string | null) => void, onDelete: (id: string) => void, currentUser: User, materials?: Material[], onAddMaterial?: (m: Material) => void, partners?: BusinessPartner[], onAddPartner?: (p: BusinessPartner) => void, registerNavGuard?: (fn: (() => boolean) | null) => void, onEditVendor?: () => void }) {
  // Editing happens on its own page (#/…/vendor/<id>/edit), so this screen just
  // navigates to it. The unsaved-changes guard lives in VendorForm now, where
  // the form state it has to inspect actually is.

  const [showRiskAssessment, setShowRiskAssessment] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showAdminScoresEdit, setShowAdminScoresEdit] = useState(false);

  // Guided evaluation wizard: department scoring -> risk assessment -> lab results.
  // Only the stages the current user is allowed to perform are shown.
  const canRisk = can(currentUser, 'vendor.risk');
  const canAnalysis = can(currentUser, 'vendor.analysis');
  const canEditVendor = can(currentUser, 'vendor.edit');
  const canDeleteVendor = can(currentUser, 'vendor.delete');
  const evalStages = [
    ...(!vendor.isSample ? [{ id: 'score', title: 'امتیازدهی دپارتمان‌ها', icon: DollarSign }] : []),
    ...(!vendor.isSample && canRisk ? [{ id: 'risk', title: 'ارزیابی ریسک', icon: ShieldAlert }] : []),
    ...(canAnalysis ? [{ id: 'analysis', title: 'ثبت نتایج آزمایشگاهی', icon: Microscope }] : []),
  ];
  const [evalStageRaw, setEvalStageRaw] = useState<string>(evalStages[0]?.id || 'score');
  const stepperRef = React.useRef<HTMLDivElement | null>(null);
  /** Move to a step and bring it into view; the content swaps below the fold otherwise. */
  const setEvalStage = (id: string) => {
    setEvalStageRaw(id);
    requestAnimationFrame(() => {
      stepperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const evalStage = evalStages.some(s => s.id === evalStageRaw) ? evalStageRaw : (evalStages[0]?.id || 'score');
  const evalStageIdx = evalStages.findIndex(s => s.id === evalStage);
  const showEvalWizard = evalStages.length >= 2;

  const [showAddAnalysisForm, setShowAddAnalysisForm] = useState(false);
  const [analysisSuccess, setAnalysisSuccess] = useState(false);
  const [newAnalysis, setNewAnalysis] = useState({
    date: new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/[۰-۹]/g, c => '0123456789'[c.charCodeAt(0) - 1776]),
    qcCode: '',
    decision: 'Pass' as 'Pass' | 'Reject' | 'Approved Conditional',
    deviationReason: 'None' as 'None' | 'NCR' | 'Deviation' | 'OOS' | 'CAPA' | 'OOT' | 'Complaint' | 'Other',
    comments: ''
  });

  // Reject → status automation.
  // Samples: a single Reject QC result auto-flags 'rejected' (→ Black List); this is
  // acceptable because a sample is a one-shot go/no-go decision.
  // Sources/suppliers: NO automatic status change — a source can have many results and
  // one failure should not blacklist it automatically. The QA/admin decides manually via
  // the decision box, with a mandatory explanation (logged to audit + source).
  const deriveQcOutcome = (records: AnalysisRecord[]): { status: Status; rejectionReasons: string[] | null } => {
    const isSampleVendor = vendor.isSample || vendor.category === 'sample';
    if (!isSampleVendor) {
      return { status: vendor.status, rejectionReasons: vendor.rejectionReasons || null };
    }
    const existingReasons = vendor.rejectionReasons ? [...vendor.rejectionReasons] : [];
    const rejectRecords = records.filter(r => r.decision === 'Reject');
    if (rejectRecords.length >= 1) {
      const qcReasons = rejectRecords.map(r =>
        `مردود در آزمون QC [کد: ${r.qcCode} | تاریخ: ${r.date}]${r.deviationReason && r.deviationReason !== 'None' ? ` - انحراف: ${r.deviationReason}` : ''}${r.comments ? ` - شرح: ${r.comments}` : ''}`
      );
      const existingNonQc = existingReasons.filter(r => !r.startsWith('مردود در آزمون QC'));
      const merged = [...existingNonQc, ...qcReasons];
      return { status: 'rejected', rejectionReasons: merged.length > 0 ? merged : null };
    }
    // No Reject results remain → drop QC reasons, and restore status if it was auto-rejected by QC.
    const nonQcReasons = existingReasons.filter(r => !r.startsWith('مردود در آزمون QC'));
    let status = vendor.status;
    if (vendor.status === 'rejected' && nonQcReasons.length === 0) {
      status = (vendor.initialSampleStatus === 'not_approved' || vendor.initialSampleStatus === 'conditional') ? 'conditional' : 'approved';
    }
    return { status, rejectionReasons: nonQcReasons.length > 0 ? nonQcReasons : null };
  };

  const handleAddAnalysisSubmit = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!newAnalysis.date.trim()) {
      setAddAnalysisError('تاریخ آزمایش را انتخاب کنید.');
      return;
    }
    if (!newAnalysis.qcCode.trim()) {
      setAddAnalysisError('کد آزمایشگاهی (QC Code) را وارد کنید.');
      return;
    }
    setAddAnalysisError(null);

    const record = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
      date: newAnalysis.date,
      qcCode: newAnalysis.qcCode.trim(),
      decision: newAnalysis.decision,
      deviationReason: newAnalysis.deviationReason,
      comments: newAnalysis.comments.trim(),
      recordedBy: currentUser ? currentUser.name : 'کیفیت / سیستم'
    };

    const updatedRecords = [...(vendor.analysisRecords || []), record];

    const { status: finalStatus, rejectionReasons: derivedReasons } = deriveQcOutcome(updatedRecords);
    const statusChangedToRejected = finalStatus === 'rejected' && vendor.status !== 'rejected';

    const decisionMapList = { Pass: 'قبول (Pass)', Reject: 'مردود (Reject)', 'Approved Conditional': 'قبول مشروط (Approved Conditional)' };
    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `ثبت نتیجه آزمایش جدید برای سورس "${vendor.material}" (${vendor.name}) - تصمیم: [${decisionMapList[record.decision] || record.decision}] (کد QC: ${record.qcCode})${statusChangedToRejected ? ' — وضعیت سورس به «مردود» تغییر کرد و به لیست سیاه منتقل شد' : ''}`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };

    onSave({
      ...vendor,
      status: finalStatus,
      rejectionReasons: derivedReasons,
      analysisRecords: updatedRecords,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, null);

    setAnalysisSuccess(true);

    setTimeout(() => {
      setAnalysisSuccess(false);
      setShowAddAnalysisForm(false);
      setNewAnalysis({
        date: new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/[۰-۹]/g, c => '0123456789'[c.charCodeAt(0) - 1776]),
        qcCode: '',
        decision: 'Pass',
        deviationReason: 'None',
        comments: ''
      });
    }, 1000);
  };

  const [editingAnalysisId, setEditingAnalysisId] = useState<string | null>(null);
  const [editingAnalysis, setEditingAnalysis] = useState<{
    date: string;
    qcCode: string;
    decision: 'Pass' | 'Reject' | 'Approved Conditional';
    deviationReason: 'None' | 'NCR' | 'Deviation' | 'OOS' | 'CAPA' | 'OOT' | 'Complaint' | 'Other';
    comments: string;
  } | null>(null);
  const [confirmDeleteAnalysisId, setConfirmDeleteAnalysisId] = useState<string | null>(null);

   const handleEditAnalysisStart = (record: AnalysisRecord) => {
    setEditAnalysisError(null);
    setEditingAnalysisId(record.id);
    setEditingAnalysis({
      date: record.date || '',
      qcCode: record.qcCode,
      decision: record.decision,
      deviationReason: record.deviationReason,
      comments: record.comments || ''
    });
    setConfirmDeleteAnalysisId(null);
  };

  const handleEditAnalysisCancel = () => {
    setEditingAnalysisId(null);
    setEditingAnalysis(null);
    setEditAnalysisError(null);
  };

  const handleEditAnalysisSave = (recordId: string) => {
    if (!editingAnalysis || !editingAnalysis.date.trim()) {
      setEditAnalysisError('تاریخ آزمایش را انتخاب کنید.');
      return;
    }
    if (!editingAnalysis.qcCode.trim()) {
      setEditAnalysisError('کد آزمایشگاهی (QC Code) را وارد کنید.');
      return;
    }
    setEditAnalysisError(null);

    const updatedRecords = (vendor.analysisRecords || []).map(r => {
      if (r.id === recordId) {
        return {
          ...r,
          date: editingAnalysis.date,
          qcCode: editingAnalysis.qcCode.trim(),
          decision: editingAnalysis.decision,
          deviationReason: editingAnalysis.deviationReason,
          comments: editingAnalysis.comments.trim(),
          recordedBy: currentUser ? `${currentUser.name} (ویرایشگر)` : r.recordedBy
        };
      }
      return r;
    });

    const decisionMapList = { Pass: 'قبول (Pass)', Reject: 'مردود (Reject)', 'Approved Conditional': 'قبول مشروط (Approved Conditional)' };
    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `ویرایش نتیجه آزمایش برای سورس "${vendor.material}" (${vendor.name}) - تصمیم جدید: [${decisionMapList[editingAnalysis.decision] || editingAnalysis.decision}] (کد QC: ${editingAnalysis.qcCode})`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };

    const { status: finalStatus, rejectionReasons: derivedReasons } = deriveQcOutcome(updatedRecords);

    onSave({
      ...vendor,
      status: finalStatus,
      rejectionReasons: derivedReasons,
      analysisRecords: updatedRecords,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, 'نتیجه آزمایش با موفقیت ویرایش شد!');

    setEditingAnalysisId(null);
    setEditingAnalysis(null);
  };

  const handleDeleteAnalysis = (recordId: string) => {
    const updatedRecords = (vendor.analysisRecords || []).filter(r => r.id !== recordId);
    const deletedRecord = (vendor.analysisRecords || []).find(r => r.id === recordId);
    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `حذف نتیجه آزمایش برای سورس "${vendor.material}" (${vendor.name}) ${deletedRecord ? `(کد QC: ${deletedRecord.qcCode})` : ''}`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };

    const { status: finalStatus, rejectionReasons: derivedReasons } = deriveQcOutcome(updatedRecords);

    onSave({
      ...vendor,
      status: finalStatus,
      rejectionReasons: derivedReasons,
      analysisRecords: updatedRecords,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, 'نتیجه آزمایش با موفقیت حذف شد!');
    setConfirmDeleteAnalysisId(null);
  };

  // Admin manual decision for sources/suppliers (not samples): reject → Black List, or restore.
  /**
   * Validation messages for the laboratory records, shown next to the control
   * that is missing. These were native alert()s: they blocked the interface,
   * ignored the page's direction and theme, and once dismissed left no sign of
   * which field was at fault.
   */
  const [addAnalysisError, setAddAnalysisError] = useState<string | null>(null);
  const [editAnalysisError, setEditAnalysisError] = useState<string | null>(null);

  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectDecisionReason, setRejectDecisionReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const handleAdminRejectSource = () => {
    if (!rejectDecisionReason.trim()) {
      setRejectError('دلیل رد این سورس الزامی است.');
      return;
    }
    setRejectError(null);
    const reasonLine = `رد توسط ${currentUser?.name || 'ادمین'} بر اساس نتایج آزمایشگاهی — ${rejectDecisionReason.trim()}`;
    const existingNonQc = (vendor.rejectionReasons || []).filter(r => !r.startsWith('رد توسط'));
    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `رد سورس "${vendor.material}" (${vendor.name}) و انتقال به لیست سیاه توسط ${currentUser?.name || 'ادمین'} — دلیل: ${rejectDecisionReason.trim()}`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };
    onSave({
      ...vendor,
      status: 'rejected',
      rejectionReasons: [...existingNonQc, reasonLine],
      reasonForChange: `رد سورس بر اساس تصمیم کیفی: ${rejectDecisionReason.trim()}`,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, 'سورس به لیست سیاه منتقل شد.');
    setShowRejectBox(false);
    setRejectDecisionReason('');
  };

  const handleAdminRestoreSource = () => {
    if (!rejectDecisionReason.trim()) {
      setRejectError('دلیل بازگردانی این سورس الزامی است.');
      return;
    }
    setRejectError(null);
    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: `بازگردانی سورس "${vendor.material}" (${vendor.name}) از لیست سیاه توسط ${currentUser?.name || 'ادمین'} — دلیل: ${rejectDecisionReason.trim()}`,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };
    onSave({
      ...vendor,
      status: 'approved',
      rejectionReasons: null,
      reasonForChange: `بازگردانی سورس از لیست سیاه: ${rejectDecisionReason.trim()}`,
      activityLogs: [...(vendor.activityLogs || []), newLog]
    }, 'سورس از لیست سیاه بازگردانی شد.');
    setShowRejectBox(false);
    setRejectDecisionReason('');
  };

  const evalFormRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (showAdminScoresEdit && evalFormRef.current) {
      setTimeout(() => {
        evalFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [showAdminScoresEdit]);

  // Score history reconstructed from the audit trail (SPS over time).
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  useEffect(() => {
    if (vendor.isSample) return;
    let cancelled = false;
    authFetch(`/api/vendors/${vendor.id}/score-history`)
      .then(res => (res.ok ? res.json() : []))
      .then((data: any[]) => { if (!cancelled && Array.isArray(data)) setScoreHistory(data.filter(d => d.totalSPS !== null)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [vendor.id, vendor.isSample, vendor.scores]);

  // Risk assessment history reconstructed from the audit trail (SRI/RPN over time).
  const [riskHistory, setRiskHistory] = useState<any[]>([]);
  useEffect(() => {
    if (vendor.isSample) return;
    let cancelled = false;
    authFetch(`/api/vendors/${vendor.id}/risk-history`)
      .then(res => (res.ok ? res.json() : []))
      .then((data: any[]) => { if (!cancelled && Array.isArray(data)) setRiskHistory(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [vendor.id, vendor.isSample, vendor.riskAssessment]);

  const overall = calculateOverallScore(vendor.scores, true);
  let displayedScore: number | null = overall;
  // Someone responsible for a single department sees that department's score
  // rather than the weighted total. With per-user permissions a person can now
  // hold more than one, and then the overall figure is the meaningful one.
  const myDepartments = scorableDepartments(currentUser);
  const isDepartmentScore = !!currentUser && myDepartments.length === 1;
  if (isDepartmentScore) {
    displayedScore = (vendor.scores as any)?.[myDepartments[0]] ?? null;
  }
  const departmentLabel = isDepartmentScore
    ? ({ commercial: 'بازرگانی', qa: 'کیفیت', planning: 'برنامه‌ریزی', finance: 'مالی' } as Record<string, string>)[myDepartments[0]] || 'بخش شما'
    : '';
  const scoreConfig = getScoreColorConfig(displayedScore, vendor.status);

  // Who this source buys from, and in what role. A source links to exactly one
  // partner — resolving a "manufacturer" and a "supplier" separately used to
  // land on the same record and render it twice. See utils/vendorPartner.
  const sourcePartner = resolveVendorPartner(vendor, partners);
  const partnerIsManufacturer = sourcePartner.role === 'manufacturer';

  // Which catalogue entry actually carries the standard name for this source's
  // material — see utils/materialNames for why the linked record is not always it.
  const { material: matchedMaterial, standardNameFa: displayStandardNameFa, standardNameEn: displayStandardNameEn } =
    resolveMaterialNames(vendor, materials);


  return (
    <div className="space-y-6 fade-in relative pb-10 text-right" dir="rtl">
      
      {/* Back Button */}
      <button 
        onClick={onBack}
        className="group flex items-center gap-2 mb-6 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit font-medium"
      >
        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        <span>بازگشت به لیست</span>
      </button>

      {showConfirmDelete && (
        <div className="mb-6 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-center fade-in shadow-sm">
           <AlertCircle className="w-12 h-12 text-red-600 dark:text-red-400 mx-auto mb-4" />
           <h3 className="text-xl font-bold text-foreground mb-1">آیا از حذف این فایل مطمئن هستید؟</h3>
           <p className="text-red-700 dark:text-red-300 mb-6 font-medium text-sm">این عملیات غیر قابل بازگشت است و سورس به همراه تمامی ارزیابی‌های آن از سیستم حذف خواهد شد.</p>
           <div className="flex justify-center gap-4">
              <button 
                onClick={() => setShowConfirmDelete(false)}
                className="px-6 py-2 rounded-xl bg-card border border-border text-foreground hover:bg-accent font-bold text-sm"
              >
                انصراف
              </button>
              <button 
                onClick={() => onDelete(vendor.id)}
                className="px-6 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 font-bold text-sm shadow-[0_4px_14px_rgba(220,38,38,0.25)]"
              >
                بله، حذف شود
              </button>
           </div>
        </div>
      )}

      {/* HERO CARD */}
      <div className={`bg-card border border-border/60 rounded-2xl p-6 mb-6 shadow-sm ${scoreConfig.heroBorder}`}>
        <div className="flex flex-col xl:flex-row items-start justify-between gap-5 pb-1">
          <div className="flex items-center gap-5">
            {/* Score ring.
                The figure is the weighted total for most viewers but a single
                department's own score for someone who only scores that one, so
                it is captioned; unlabelled, two people read the same ring as
                the same thing. */}
            <div className="shrink-0 flex flex-col items-center gap-1.5">
              <div className={`w-20 h-20 rounded-full border-4 flex items-center justify-center bg-muted ${scoreConfig.border}`}>
                <span className="font-mono text-2xl font-black">
                  {displayedScore !== null ? displayedScore : '-'}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground font-medium whitespace-nowrap">
                {displayedScore === null
                  ? 'بدون امتیاز'
                  : isDepartmentScore
                    ? `امتیاز ${departmentLabel}`
                    : 'امتیاز کل'}
              </span>
            </div>
            
            <div className="text-right">
              {/* The partner, labelled by the role it actually has. */}
              <div className="font-bold text-foreground text-lg sm:text-xl lg:text-2xl leading-tight mb-1">
                <span>{sourcePartner.roleLabel}: {sourcePartner.name}</span>
                {sourcePartner.country && (
                  <>
                    <span className="mx-3 sm:mx-4 text-border font-normal">|</span>
                    <span>کشور: {sourcePartner.country}</span>
                  </>
                )}
              </div>

              {/* A source used to claim "bought straight from the maker" whenever
                  its partner happened to be a manufacturer. Manufacturers and
                  suppliers are independent records now, so that link says
                  nothing about whether a middleman exists. */}
              {sourcePartner.grade ? (
                <div className="font-normal text-muted-foreground text-xs sm:text-sm leading-relaxed mt-1 max-w-[75ch]">
                  <span>گرید ارزیابی فروشنده: {sourcePartner.grade}</span>
                </div>
              ) : null}
            </div>
          </div>
          
          <div className="flex flex-col items-start xl:items-end gap-2">
            <div className="flex gap-2">
              {/* Editing and deleting are separate permissions: commercial may
                  register and correct a source, but only an admin removes one. */}
              {canEditVendor && (
                <button 
                  onClick={() => onEditVendor?.()}
                  className="flex items-center justify-center gap-2 text-sm transition-all h-10 px-4 rounded-xl border font-bold bg-card text-foreground hover:bg-accent border-border shadow-sm"
                >
                  <Pencil className="w-4 h-4" />
                  <span>ویرایش اطلاعات</span>
                </button>
              )}
              {canDeleteVendor && (
                <button 
                  onClick={() => setShowConfirmDelete(true)}
                  className="flex items-center justify-center h-10 w-10 transition-colors rounded-xl border bg-card border-border text-muted-foreground hover:border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/40 dark:bg-red-950/30 hover:text-red-600 dark:text-red-400 shadow-sm"
                  title="حذف"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Label وضعیت / گرید */}
            <div className="mt-1">
              {vendor.isSample ? (
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold shadow-2xs ${
                  vendor.status === 'approved' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' :
                  vendor.status === 'conditional' ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800' :
                  'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}>
                  <ClipboardCheck className="w-4 h-4 ml-1.5" />
                  {vendor.status === 'approved' ? 'نمونه: تایید شده (Approved)' :
                   vendor.status === 'conditional' ? 'نمونه: تایید مشروط (Conditional)' : 'نمونه: مردود (Rejected)'}
                </div>
              ) : (
                <GradeBadge grade={vendor.grade} status={vendor.status} scores={vendor.scores} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* LICENSE EXPIRY PROMINENT ALERT (IF EXPIRING OR EXPIRED) */}
      {vendor.ircExpiryDate && (() => {
        const check = checkLicenseExpiry(vendor.ircExpiryDate);
        if (check.status === 'expired') {
          return (
            <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-2xl p-4 text-rose-900 dark:text-rose-300 shadow-xs flex items-center justify-between gap-4 fade-in">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-600/10 border border-rose-600/20 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-extrabold text-sm text-rose-900 dark:text-rose-300">
                    هشدار اضطراری: مجوز IRC / قانونی این سورس منقضی شده است!
                  </div>
                  <div className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                    تاریخ انقضا: <strong className="font-mono font-bold">{vendor.ircExpiryDate}</strong> ({Math.abs(check.daysLeft || 0)} روز گذشته). تمدید فوری مجوز الزامی است.
                  </div>
                </div>
              </div>
              <span className="px-3 py-1 bg-rose-600 text-white font-bold text-xs rounded-xl shadow-xs shrink-0">
                منقضی شده
              </span>
            </div>
          );
        }
        if (check.status === 'expiring_soon') {
          return (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-2xl p-4 text-amber-950 dark:text-amber-300 shadow-xs flex items-center justify-between gap-4 fade-in">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                  <AlertTriangle className="w-5 h-5 animate-bounce" />
                </div>
                <div>
                  <div className="font-extrabold text-sm text-amber-900 dark:text-amber-300">
                    اعلان تمدید مجوز (کمتر از ۲ ماه تا انقضا)
                  </div>
                  <div className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                    مجوز IRC این سورس در تاریخ <strong className="font-mono font-bold">{vendor.ircExpiryDate}</strong> منقضی می‌شود (<strong>{check.daysLeft} روز باقی‌مانده</strong>). لطفاً فرآیند تمدید را آغاز فرمایید.
                  </div>
                </div>
              </div>
              <span className="px-3 py-1 bg-amber-500 text-white font-bold text-xs rounded-xl shadow-xs shrink-0">
                {check.daysLeft} روز تا انقضا
              </span>
            </div>
          );
        }
        return null;
      })()}

      {/* 1. اطلاعات تامین کننده */}
      <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm text-right">
        <div className="flex items-center gap-2.5 mb-5 border-b border-border pb-3">
          <Globe className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          <h3 className="font-bold text-foreground text-sm">مشخصات فنی و اطلاعات عمومی</h3>
        </div>
        
        <div className="flex flex-col gap-5 text-sm">
          {/* مشخصات اصلی ماده اولیه و کدهای ثبتی */}
          <div className="space-y-4">
            {/* جعبه شاخص ماده اولیه */}
            <div className="bg-muted/40 border border-border rounded-xl p-4 shadow-inner space-y-3">
              <div>
                <div className="text-muted-foreground text-xs font-bold mb-1">نام استاندارد فارسی:</div>
                <div className="font-black text-foreground text-lg sm:text-xl leading-relaxed" title={displayStandardNameFa}>
                  {displayStandardNameFa}
                </div>
              </div>
              <div className="pt-2.5 border-t border-border/60">
                <div className="text-muted-foreground text-xs font-bold mb-1">نام استاندارد انگلیسی:</div>
                <div className="text-sm sm:text-base font-mono font-bold text-foreground" dir="ltr">
                  {displayStandardNameEn}
                </div>
              </div>
            </div>

            {/* کارت‌های فرعی مشخصات عددی */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl p-4 shadow-xs text-right flex flex-col justify-between">
                <div>
                  <div className="text-muted-foreground text-xs mb-1.5">شمارهٔ CAS</div>
                  <div className="font-mono text-foreground font-bold bg-muted text-center py-1.5 px-3 rounded-lg border border-border text-sm" dir="ltr">
                    {vendor.cas && vendor.cas.trim() && vendor.cas.toLowerCase() !== 'n/a' && vendor.cas.toLowerCase() !== 'unknown' ? vendor.cas : '-'}
                  </div>
                </div>
              </div>
              
              <div className="bg-card border border-border rounded-xl p-4 shadow-xs text-right flex flex-col justify-between">
                <div>
                  <div className="text-muted-foreground text-xs mb-1.5">
                    {vendor.category === 'veterinary' ? 'کد IVC' : 'کد IRC'}
                  </div>
                  <div className="font-mono text-foreground font-bold bg-muted text-center py-1.5 px-3 rounded-lg border border-border text-sm" dir="ltr">
                    {vendor.irc && vendor.irc.trim() && vendor.irc.toLowerCase() !== 'n/a' && vendor.irc.toLowerCase() !== 'unknown' ? vendor.irc : '-'}
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-medium">تاریخ دریافت / صدور:</span>
                    <span className="font-mono font-bold text-foreground" dir="ltr">
                      {vendor.lastAudit || vendor.registrationDate || 'ثبت نشده'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-medium">تاریخ انقضای مجوز:</span>
                    {vendor.ircExpiryDate ? (() => {
                      const check = checkLicenseExpiry(vendor.ircExpiryDate);
                      return (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-foreground" dir="ltr">
                            {vendor.ircExpiryDate}
                          </span>
                          {check.status === 'expired' && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300">
                              منقضی
                            </span>
                          )}
                          {check.status === 'expiring_soon' && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-300">
                              {check.daysLeft} روز
                            </span>
                          )}
                          {check.status === 'valid' && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300">
                              معتبر
                            </span>
                          )}
                        </div>
                      );
                    })() : (
                      <span className="text-muted-foreground font-mono">ثبت نشده</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 shadow-xs text-right flex flex-col justify-between">
                <div>
                  <div className="text-muted-foreground text-xs mb-1.5">کد داخلی سامانه</div>
                  <div className="font-mono text-muted-foreground text-center py-1.5 px-3 text-sm" dir="ltr" title="شناسهٔ داخلی رکورد؛ کد ثبتی رگولاتوری نیست.">
                    {vendor.id.substring(0, 8).toUpperCase()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* اطلاعات تماس و آدرسِ شریکِ این سورس (یکی است: فروشنده یا تولیدکننده) */}
          <div className="bg-muted/60 border border-border/50 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2 text-foreground font-bold text-xs sm:text-sm border-b border-border/60 pb-3">
              <Building2 className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              <span>اطلاعات تماس و آدرس</span>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="bg-card border border-border/80 rounded-xl p-4 shadow-2xs space-y-2 text-right">
                <div className={`flex items-center gap-2 font-extrabold text-sm border-b border-border pb-2 ${partnerIsManufacturer ? 'text-indigo-900 dark:text-indigo-300' : 'text-emerald-900 dark:text-emerald-300'}`}>
                  {partnerIsManufacturer
                    ? <Factory className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    : <Handshake className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />}
                  {/* The role label is kept out of the clip so it cannot spend
                      the budget the partner name needs. */}
                  <span className="shrink-0">{sourcePartner.roleLabel}:</span>
                  <EntityName name={sourcePartner.name} lines={2} />
                </div>

                <div className="space-y-1.5 text-xs text-muted-foreground leading-relaxed pt-1 max-w-[75ch]">
                  <div className="flex items-start gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <span><strong>کشور / شهر:</strong> {formatLocation(sourcePartner) || 'ثبت‌نشده'}</span>
                  </div>

                  {sourcePartner.address && (
                    <div className="flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <span><strong>آدرس:</strong> {sourcePartner.address}</span>
                    </div>
                  )}

                  {sourcePartner.contactPerson && (
                    <div className="flex items-center gap-1.5">
                      <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span><strong>شخص رابط:</strong> {sourcePartner.contactPerson}</span>
                    </div>
                  )}

                  {(sourcePartner.phone || sourcePartner.email) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                      {sourcePartner.phone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span dir="ltr" className="font-mono">{sourcePartner.phone}</span>
                        </div>
                      )}
                      {sourcePartner.email && (
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span dir="ltr" className="font-mono">{sourcePartner.email}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {!sourcePartner.address && !sourcePartner.contactPerson && !sourcePartner.phone
                    && !sourcePartner.email && !sourcePartner.website && (
                    <div className="flex items-start gap-1.5 pt-1 text-muted-foreground">
                      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>
                        اطلاعات تماس این شریک در مخزن شرکای تجاری ثبت نشده است؛
                        از همان‌جا قابل تکمیل است.
                      </span>
                    </div>
                  )}

                  {sourcePartner.website && (
                    <div className="flex items-center gap-1.5 pt-0.5" dir="ltr">
                      <a href={sourcePartner.website.startsWith('http') ? sourcePartner.website : `https://${sourcePartner.website}`} target="_blank" rel="noreferrer" className="text-cyan-700 dark:text-cyan-300 hover:underline font-mono text-[11px]">
                        {sourcePartner.website}
                      </a>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* سوابق انحرافات */}
          {vendor.rejectionReasons && vendor.rejectionReasons.length > 0 && (
            <div className="bg-muted/60 border border-border/50 rounded-xl p-5 shadow-xs">
              <div className="flex items-center gap-2 mb-3 text-foreground font-bold text-xs sm:text-sm">
                <AlertTriangle className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <span>سوابق انحرافات</span>
              </div>
              <div className="text-foreground font-medium text-sm leading-relaxed whitespace-pre-wrap text-right max-w-[75ch]" dir="auto">
                <ul className="list-disc list-inside space-y-1.5">
                  {vendor.rejectionReasons.map((reason, idx) => (
                    <li key={idx} className="break-words">{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {vendor.isSample && (
        <div className="bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-6 shadow-sm flex items-start gap-4">
          <div className="bg-indigo-100 dark:bg-indigo-900/40 p-3 rounded-xl border border-indigo-200 dark:border-indigo-800 shrink-0 text-indigo-600 dark:text-indigo-400">
            <Info className="w-5 h-5" />
          </div>
          <div className="text-right">
            <h3 className="text-base font-bold text-indigo-900 dark:text-indigo-300 mb-1">نمونه تستی (Sample)</h3>
            <p className="text-indigo-700 dark:text-indigo-300 text-sm font-medium">برای مواردی که به عنوان «نمونه» ثبت می‌شوند، نیازی به ارزیابی ریسک و فرم امتیازدهی دوره‌ای دپارتمان‌ها نمی‌باشد.</p>
          </div>
        </div>
      )}

      {vendor.status === 'rejected' && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-2xl p-6 md:p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="bg-rose-100 dark:bg-rose-900/40 p-3 rounded-xl border border-rose-200 dark:border-rose-800 shrink-0 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div className="text-right flex-1 min-w-0">
              {vendor.isSample || vendor.category === 'sample' ? (
                <>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-lg font-black text-rose-900 dark:text-rose-300">وضعیت: نمونه مردود در کنترل کیفیت (QC Rejected Sample)</h3>
                    <span className="bg-rose-600 text-white font-bold text-xs px-2.5 py-0.5 rounded-full">
                      مردود / Reject
                    </span>
                  </div>
                  <p className="text-rose-700 dark:text-rose-300 text-sm mb-5 font-semibold">
                    این نمونه بر اساس نتایج آزمایشگاهی دپارتمان کنترل کیفیت (QC) و به دلیل عدم انطباق با مشخصات فنی/فارماکوپه‌ای تایید نگردیده و مردود شده است:
                  </p>

                  {/* Rejected QC Analysis Records Display */}
                  {(() => {
                    const rejectedQCRecords = (vendor.analysisRecords || []).filter(r => r.decision === 'Reject');
                    const nonQcRejectionReasons = (vendor.rejectionReasons || []).filter(
                      reason => !reason.startsWith('مردود در آزمون QC')
                    );

                    return (
                      <div className="space-y-3">
                        {rejectedQCRecords.length > 0 && (
                          <div className="space-y-3">
                            {rejectedQCRecords.map((r, idx) => (
                              <div key={r.id || idx} className="bg-card border border-rose-200/80 dark:border-rose-800 rounded-xl p-4 shadow-xs space-y-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 dark:border-rose-800 pb-2 text-xs">
                                  <div className="flex items-center gap-3">
                                    <span className="font-bold text-rose-900 dark:text-rose-300">
                                      برگه آزمایش {idx + 1}: کد QC <span className="font-mono bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-800 font-bold">{r.qcCode}</span>
                                    </span>
                                    <span className="text-border">|</span>
                                    <span className="text-muted-foreground font-medium">تاریخ آزمایش: <span className="font-mono font-bold text-foreground">{r.date}</span></span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {r.deviationReason && r.deviationReason !== 'None' && (
                                      <span className="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded text-[11px] font-bold">
                                        <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                        انحراف: {
                                          r.deviationReason === 'OOS' ? 'خارج از حدود مشخصات (OOS)' :
                                          r.deviationReason === 'OOT' ? 'خارج از روند (OOT)' :
                                          r.deviationReason === 'NCR' ? 'گزارش عدم انطباق (NCR)' :
                                          r.deviationReason === 'CAPA' ? 'اقدام اصلاحی/پیشگیرانه (CAPA)' :
                                          r.deviationReason === 'Complaint' ? 'شکایت کیفی' :
                                          r.deviationReason === 'Deviation' ? 'انحراف فرآیندی' : r.deviationReason
                                        }
                                      </span>
                                    )}
                                    <span className="bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded text-[11px] font-bold">
                                      تصمیم: مردود (Reject)
                                    </span>
                                  </div>
                                </div>

                                {r.comments && (
                                  <div className="text-xs text-foreground bg-rose-50/40 dark:bg-rose-950/30 p-2.5 rounded-lg border border-rose-100/60 dark:border-rose-800 leading-relaxed">
                                    <span className="font-bold text-rose-900 dark:text-rose-300 block mb-0.5">گزارش و توضیحات کارشناس کنترل کیفیت:</span>
                                    <p className="whitespace-pre-wrap">{r.comments}</p>
                                  </div>
                                )}

                                {r.recordedBy && (
                                  <div className="text-[11px] text-muted-foreground font-medium text-left">
                                    ثبت‌شده توسط: <span className="text-muted-foreground font-bold">{r.recordedBy}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Other general rejection reasons if any */}
                        {nonQcRejectionReasons.length > 0 && (
                          <div className="mt-3 space-y-2">
                            <h4 className="text-xs font-bold text-rose-900 dark:text-rose-300">سایر دلایل و ملاحظات عدم تایید:</h4>
                            <ul className="space-y-1.5">
                              {nonQcRejectionReasons.map((reason, idx) => (
                                <li key={idx} className="bg-card border border-rose-100 dark:border-rose-800 px-3.5 py-2.5 rounded-xl text-rose-800 dark:text-rose-300 text-xs flex gap-2.5 items-start font-medium shadow-xs">
                                  <span className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-[10px] w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold">{idx + 1}</span>
                                  <span>{reason}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {rejectedQCRecords.length === 0 && nonQcRejectionReasons.length === 0 && vendor.rejectionReasons && (
                          <ul className="space-y-2">
                            {vendor.rejectionReasons.map((reason, idx) => (
                              <li key={idx} className="bg-card border border-rose-100 dark:border-rose-800 px-4 py-3 rounded-xl text-rose-800 dark:text-rose-300 text-sm flex gap-3 items-start font-medium shadow-sm">
                                <span className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-xs w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold">{idx + 1}</span>
                                <span>{reason}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-rose-800 dark:text-rose-300 mb-1">وضعیت: لیست سیاه — تامین‌کننده رد صلاحیت شده</h3>
                  <p className="text-rose-700 dark:text-rose-300 text-sm mb-5 max-w-2xl font-semibold">این تامین‌کننده به دلایل زیر از لیست تامین‌کنندگان مجاز حذف شده است (Disqualified due to critical non-conformities):</p>
                  
                  <ul className="space-y-2">
                    {vendor.rejectionReasons?.map((reason, idx) => (
                      <li key={idx} className="bg-card border border-rose-100 dark:border-rose-800 px-4 py-3 rounded-xl text-rose-800 dark:text-rose-300 text-sm flex gap-3 items-start font-medium shadow-sm">
                        <span className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-xs w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold">{idx + 1}</span>
                        {reason}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 border-t border-rose-200 dark:border-rose-800 pt-4 flex items-center text-xs text-rose-600 dark:text-rose-400/70 font-mono">
                    <Info className="w-4 h-4 mr-2" /> {vendor.category === 'veterinary' ? 'IVC' : 'IRC'}_ISSUE_DATE: {vendor.lastAudit || 'N/A'}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Guided evaluation wizard header (stepper) */}
      {showEvalWizard && (
        <div ref={stepperRef} className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm scroll-mt-4">
          <div className="flex items-center gap-2.5 mb-4">
            <ClipboardCheck className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-sm">فرآیند ارزیابی سورس <span className="text-muted-foreground text-xs font-normal font-mono">(Evaluation Workflow)</span></h3>
          </div>
          <div className="flex items-center">
            {evalStages.map((s, i) => {
              const done = i < evalStageIdx;
              const current = i === evalStageIdx;
              const Ic = s.icon;
              return (
                <React.Fragment key={s.id}>
                  <button type="button" onClick={() => setEvalStage(s.id)} className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer group" title={s.title}>
                    <span className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                      current ? 'border-primary text-primary bg-primary/5 ring-4 ring-primary/10' :
                      done ? 'border-primary bg-primary text-white' :
                      'border-border text-muted-foreground bg-card group-hover:border-border'
                    }`}>
                      {done ? <CheckCircle className="w-4 h-4" /> : <Ic className="w-4 h-4" />}
                    </span>
                    <span className={`text-[10px] sm:text-xs font-semibold whitespace-nowrap ${current ? 'text-primary' : done ? 'text-muted-foreground' : 'text-muted-foreground'}`}>{s.title}</span>
                  </button>
                  {i < evalStages.length - 1 && (
                    <div className="flex-1 h-[2px] mx-2 sm:mx-3 -mt-4 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${i < evalStageIdx ? 'bg-primary w-full' : 'w-0'}`} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. اول بخش امتیاز دهی بیاد */}
      {!vendor.isSample && (!showEvalWizard || evalStage === 'score') && (
        <div className="bg-card border border-border/60 rounded-2xl shadow-sm overflow-hidden text-right">
          <div className="border-b border-border px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <FileText className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              <h3 className="font-bold text-foreground text-sm">ارزیابی عملکرد تامین‌کنندگان <span className="text-muted-foreground text-xs font-normal font-mono relative top-[0.5px]">(Evaluation)</span></h3>
            </div>
            {currentUser && currentUser.role !== 'lab' && !showAdminScoresEdit && (
              <button 
                onClick={() => setShowAdminScoresEdit(true)}
                className="px-3 py-1.5 rounded-lg bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-900/50 dark:bg-cyan-900/40 border border-cyan-200 dark:border-cyan-800 transition-colors text-xs font-bold flex items-center gap-1.5"
              >
                {vendor.scores && Object.values(vendor.scores).some(v => v > 0) ? 'تغییر امتیازات' : 'ثبت امتیاز ارزیابی'}
              </button>
            )}
            {showAdminScoresEdit && (
              <button 
                onClick={() => setShowAdminScoresEdit(false)}
                className="flex items-center justify-center gap-1.5 text-xs transition-colors w-fit px-4 py-1.5 rounded-lg border font-bold bg-card text-foreground hover:bg-accent border-border shadow-sm"
              >
                <span>انصراف</span>
              </button>
            )}
          </div>

          <div className="p-6">
            {showAdminScoresEdit ? (
              <div ref={evalFormRef} className="space-y-6">
                <div className="bg-cyan-600/5 border border-cyan-600/20 rounded-xl p-4 flex items-center gap-3 text-cyan-700 dark:text-cyan-300 text-right">
                  <Info className="w-5 h-5 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold text-sm">{vendor.scores && Object.values(vendor.scores).some(v => v > 0) ? 'ویرایش امتیازات ارزیابی' : 'ثبت ارزیابی جدید'}</h4>
                    <p className="text-xs opacity-90 mt-0.5">لطفاً ارزیابی مربوط به بخش خود را بر اساس مستندات ثبت کنید.</p>
                  </div>
                </div>
                <EvaluationForm vendor={vendor} onSave={onSave} onClose={() => setShowAdminScoresEdit(false)} currentUser={currentUser} />
              </div>
            ) : vendor.scores ? (
              <div className="space-y-6">
                {/* Weighted average score, beautifully centered and designed */}
                {currentUser?.role === 'admin' ? (
                  <div className="flex justify-center p-2">
                    <div className="text-center bg-muted border border-border p-5 rounded-2xl flex flex-col items-center justify-center min-w-[240px] shadow-sm relative overflow-hidden">
                      <div className="absolute top-0 right-0 left-0 h-[3px] bg-cyan-600" />
                      <span className="text-muted-foreground text-xs font-bold mb-1">امتیاز کل (میانگین وزنی)</span>
                      <span className="text-[10px] text-muted-foreground font-mono mb-2">Weighted Average Score</span>
                      <span id="weighted-average-score-badge" className={`text-3xl font-extrabold font-mono tracking-tighter ${getScoreColorClass(overall)}`}>
                        {overall !== null ? overall : '-'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-muted/50 border border-border/60 rounded-xl p-4 text-right flex items-center gap-3 text-muted-foreground mb-2">
                    <div className="w-1.5 h-8 bg-cyan-600 rounded-full" />
                    <div className="text-xs">
                      کاربر گرامی، شما با سطح دسترسی <strong className="text-cyan-700 dark:text-cyan-300">
                        {currentUser?.role === 'qa' ? 'کیفیت (QA)' : 
                         currentUser?.role === 'commercial' ? 'بازرگانی' : 
                         currentUser?.role === 'planning' ? 'برنامه‌ریزی و انبار' : 
                         currentUser?.role === 'finance' ? 'مالی' : 'کاربر'}
                      </strong> وارد شده‌اید. بر این اساس، صرفاً به امتیاز ارزیابی ثبت شده واحد خود دسترسی دارید.
                    </div>
                  </div>
                )}

                <div className="mt-8 space-y-6">
                  {/* ScoreCards - 2x2 Grid Layout */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {FORM_LAYOUT.map(layout => {
                      const deptScore = vendor.scores[layout.id as keyof typeof vendor.scores];
                      if (deptScore === undefined || deptScore === null) return null;
                      
                      // Only the department a user may score is shown to them.
                      if (!canScoreDepartment(currentUser, layout.id)) return null;
                      
                      return (
                        <ScoreCard 
                           key={layout.id} 
                           title={layout.title} 
                           titleEn={
                             layout.id === 'commercial' ? 'COMMERCIAL DEPT' : 
                             layout.id === 'qa' ? 'QUALITY' : 
                             layout.id === 'planning' ? 'PLANNING & WAREHOUSE' : 'FINANCE DEPT'}
                           icon={layout.icon}
                           score={deptScore}
                           items={layout.criteria.map(crit => ({
                             label: crit.label,
                             value: getRawScoreValue(vendor, layout.id, crit.key),
                             max: 5
                           }))}
                        />
                      );
                    })}
                  </div>

                  {/* Radar Chart (Distribution) is now below the scores, Admin only */}
                  {currentUser?.role === 'admin' && (
                    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                      <div className="text-center mb-4">
                        <h4 className="font-bold text-foreground text-sm mb-1">نمودار توزیع امتیازات بخش‌ها <span className="font-mono text-xs">(Score Distribution)</span></h4>
                        <div className="w-16 h-1 bg-cyan-500/20 mx-auto rounded-full" />
                      </div>
                      <div className="h-56 sm:h-64 w-full" dir="ltr">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={[
                            { subject: 'بازرگانی', A: vendor.scores.commercial || 0, fullMark: 100 },
                            { subject: 'کیفیت', A: vendor.scores.qa || 0, fullMark: 100 },
                            { subject: 'برنامه‌ریزی و انبار', A: vendor.scores.planning || 0, fullMark: 100 },
                            { subject: 'مالی', A: vendor.scores.finance || 0, fullMark: 100 },
                          ]}>
                            <PolarGrid stroke="#e2e8f0" />
                            <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'Vazirmatn FD' }} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                            <Radar name="Vendor" dataKey="A" stroke="#0ea5e9" fill="#38bdf8" fillOpacity={0.3} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-xs bg-muted/50 rounded-xl border border-dashed border-border">
                هیچ امتیازی برای این تامین‌کننده ثبت نشده است. لطفاً نسبت به ثبت ارزیابی اقدام کنید.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Score history & trend (reconstructed from the audit trail) */}
      {!vendor.isSample && (!showEvalWizard || evalStage === 'score') && scoreHistory.length > 0 && (
        <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm text-right">
          <div className="flex items-center justify-between gap-3 mb-5 border-b border-border pb-3">
            <div className="flex items-center gap-2.5">
              <History className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-foreground text-sm">تاریخچه و روند نمرات <span className="text-muted-foreground text-xs font-normal font-mono relative top-[0.5px]">(Score History)</span></h3>
            </div>
            <Badge variant="outline" className="text-[11px] px-2 py-0.5">{scoreHistory.length} تغییر</Badge>
          </div>

          {scoreHistory.length >= 2 && (
            <div className="h-52 w-full mb-5" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={scoreHistory.map((h, i) => ({
                  idx: i + 1,
                  label: new Date(h.date).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }),
                  sps: h.totalSPS,
                }))} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'Vazirmatn FD' }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <RTooltip
                    contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                    formatter={(v: any) => [`${v}`, 'SPS']}
                    labelFormatter={(l: any) => l}
                  />
                  <Line type="monotone" dataKey="sps" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, fill: '#2563eb' }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-right font-semibold py-2 px-2">تاریخ</th>
                  <th className="text-center font-semibold py-2 px-2">SPS</th>
                  <th className="text-center font-semibold py-2 px-2">تغییر</th>
                  <th className="text-center font-semibold py-2 px-2">گرید</th>
                  <th className="text-right font-semibold py-2 px-2">کاربر</th>
                </tr>
              </thead>
              <tbody>
                {[...scoreHistory].reverse().map((h) => {
                  const delta = (typeof h.totalSPS === 'number' && typeof h.previousSPS === 'number') ? +(h.totalSPS - h.previousSPS).toFixed(1) : null;
                  return (
                    <tr key={h.id} className="border-b border-border hover:bg-accent/60">
                      <td className="py-2 px-2 text-foreground">{new Date(h.date).toLocaleDateString('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                      <td className="py-2 px-2 text-center font-mono font-bold text-foreground">{h.totalSPS}</td>
                      <td className="py-2 px-2 text-center font-mono">
                        {delta === null || delta === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : delta > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400">▲ {delta}</span>
                        ) : (
                          <span className="text-red-500 dark:text-red-400">▼ {Math.abs(delta)}</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {h.grade ? <Badge variant={h.grade === 'A' ? 'gradeA' : h.grade === 'B' ? 'gradeB' : h.grade === 'C' ? 'gradeC' : 'gradeReject'} className="text-[10px] px-2 py-0">{h.grade}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">{h.user}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. ارزیابی ریسک تامین کنندگان */}
      {!vendor.isSample && (!showEvalWizard || evalStage === 'risk') && canRisk && (
        <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm text-right">
          <div className="flex items-center justify-between gap-3 mb-5 border-b border-border pb-3">
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <h3 className="font-bold text-foreground text-sm">ارزیابی ریسک تامین کنندگان <span className="text-muted-foreground text-xs font-normal font-mono relative top-[0.5px]">(Risk Assessment)</span></h3>
            </div>
            {canRisk && !showRiskAssessment && (
              <button 
                onClick={() => setShowRiskAssessment(true)}
                className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800 transition-colors text-xs font-bold"
              >
                {vendor.riskAssessment ? 'بروزرسانی ارزیابی ریسک' : 'ثبت ارزیابی ریسک'}
              </button>
            )}
          </div>

          {showRiskAssessment ? (
            <RiskAssessmentForm 
              vendor={vendor} 
              onSave={onSave} 
              onClose={() => setShowRiskAssessment(false)} 
              currentUser={currentUser} 
            />
          ) : vendor.riskAssessment ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              <div className={`p-5 rounded-2xl border flex items-center justify-between gap-4 md:col-span-1 ${
                vendor.riskAssessment.riskLevel === 'Low' ? 'bg-emerald-50/40 dark:bg-emerald-950/30 border-emerald-500/20' : 
                vendor.riskAssessment.riskLevel === 'Medium' ? 'bg-amber-50/40 dark:bg-amber-950/30 border-amber-500/20' : 
                'bg-red-50/40 dark:bg-red-950/30 border-red-500/20'
              }`}>
                <div className="flex items-center gap-3">
                  <Activity className={`w-6 h-6 shrink-0 ${
                    vendor.riskAssessment.riskLevel === 'Low' ? 'text-emerald-600 dark:text-emerald-400' : 
                    vendor.riskAssessment.riskLevel === 'Medium' ? 'text-amber-600 dark:text-amber-400' : 
                    'text-red-600 dark:text-red-400'
                  }`} />
                  <div className="text-right">
                    <div className="font-black text-foreground text-base">
                      سطح ریسک: {vendor.riskAssessment.riskLevel === 'Low' ? 'پایین' : vendor.riskAssessment.riskLevel === 'Medium' ? 'متوسط' : 'بالا'}
                    </div>
                    <div className="text-muted-foreground text-[10px] uppercase font-mono tracking-wide mt-0.5">Supplier Risk Index</div>
                  </div>
                </div>
                <div className={`text-3xl font-black font-mono shrink-0 leading-none ${
                    vendor.riskAssessment.riskLevel === 'Low' ? 'text-emerald-600 dark:text-emerald-400' : 
                    vendor.riskAssessment.riskLevel === 'Medium' ? 'text-amber-600 dark:text-amber-400' : 
                    'text-red-600 dark:text-red-400'
                }`}>
                  {Number(vendor.riskAssessment.sri).toFixed(1)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 md:col-span-2">
                <div className="bg-muted/50 p-4 rounded-xl border border-border flex items-center justify-between px-5">
                  <span className="text-xs text-muted-foreground font-semibold font-mono">Risk Score</span>
                  <span className="text-sm font-black font-mono text-foreground">{vendor.riskAssessment.riskScore}</span>
                </div>
                <div className="bg-muted/50 p-4 rounded-xl border border-border flex items-center justify-between px-5">
                  <span className="text-xs text-muted-foreground font-semibold">کلاس ریسک کلی</span>
                  <span className={`text-sm font-bold ${
                    vendor.riskAssessment.riskLevel === 'Low' ? 'text-emerald-600 dark:text-emerald-400' :
                    vendor.riskAssessment.riskLevel === 'Medium' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                  }`}>{vendor.riskAssessment.riskLevel}</span>
                </div>
                <div className="bg-muted/50 p-4 rounded-xl border border-border col-span-2 flex justify-between items-center px-5">
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-0.5">Evaluator</div>
                    <div className="text-xs font-bold text-foreground">{vendor.riskAssessment.evaluator}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-0.5">Evaluation Date</div>
                    <div className="text-xs font-bold text-foreground font-mono" dir="ltr">{vendor.riskAssessment.date}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-muted-foreground text-xs bg-muted/50 rounded-xl border border-dashed border-border">
              هیچ ارزیابی ریسکی برای این تامین‌کننده ثبت نشده است.
            </div>
          )}

          {/* Risk assessment history & SRI/RPN trend (reconstructed from the audit trail) */}
          {!showRiskAssessment && riskHistory.length > 0 && (
            <div className="mt-6 pt-6 border-t border-border">
              <div className="flex items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-2.5">
                  <History className="w-4 h-4 text-primary" />
                  <h3 className="font-bold text-foreground text-sm">تاریخچه و روند ریسک <span className="text-muted-foreground text-xs font-normal font-mono relative top-[0.5px]">(Risk History)</span></h3>
                </div>
                <Badge variant="outline" className="text-[11px] px-2 py-0.5">{riskHistory.length} ارزیابی</Badge>
              </div>

              {riskHistory.length >= 2 && (
                <div className="h-52 w-full mb-5" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={riskHistory.map((h, i) => ({
                      idx: i + 1,
                      label: new Date(h.date).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }),
                      sri: h.sri,
                      rpn: h.riskScore,
                    }))} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'Vazirmatn FD' }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <RTooltip
                        contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                      />
                      <Line type="monotone" dataKey="sri" name="SRI" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3, fill: '#dc2626' }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="rpn" name="RPN" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-right font-semibold py-2 px-2">تاریخ</th>
                      <th className="text-center font-semibold py-2 px-2">سطح ریسک</th>
                      <th className="text-center font-semibold py-2 px-2">RPN</th>
                      <th className="text-center font-semibold py-2 px-2">SRI</th>
                      <th className="text-right font-semibold py-2 px-2">ارزیاب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...riskHistory].reverse().map((h) => (
                      <tr key={h.id} className="border-b border-border hover:bg-accent/60">
                        <td className="py-2 px-2 text-foreground">{new Date(h.date).toLocaleDateString('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                        <td className="py-2 px-2 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                            h.riskLevel === 'Low' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' :
                            h.riskLevel === 'Medium' ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' :
                            h.riskLevel === 'High' ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800' : 'bg-muted text-muted-foreground border-border'
                          }`}>
                            {h.riskLevel === 'Low' ? 'پایین' : h.riskLevel === 'Medium' ? 'متوسط' : h.riskLevel === 'High' ? 'بالا' : (h.riskLevel || '—')}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-foreground">{h.riskScore ?? '—'}</td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-foreground">{typeof h.sri === 'number' ? h.sri.toFixed(1) : '—'}</td>
                        <td className="py-2 px-2 text-muted-foreground">{h.user}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. ثبت نتایج آزمایشگاه */}
      {(!showEvalWizard || evalStage === 'analysis') && canAnalysis && (
        <div id="purchase-history-analysis-section" className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm text-right">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <Microscope className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-pulse" />
              <div>
                <h3 className="font-bold text-foreground text-sm">سابقه خرید و نتایج آنالیز آزمایشگاهی</h3>
                <p className="text-xs text-muted-foreground mt-1">مدیریت و ثبت اطلاعات آزمایش، کدهای آزمایشگاهی (QC)، وضعیت انحراف و تصمیم نهایی (صرفاً ادمین و واحد کیفیت)</p>
              </div>
            </div>
            <button
              id="add-analysis-record-btn"
              onClick={() => setShowAddAnalysisForm(!showAddAnalysisForm)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>ثبت نتیجه آزمایش جدید</span>
            </button>
          </div>

          {/* Inline Form to add laboratory record */}
          {showAddAnalysisForm && (
            <div id="add-analysis-form" className="mb-6 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-800 bg-indigo-50/25 dark:bg-indigo-950/30 space-y-4">
              {analysisSuccess ? (
                <div className="flex items-center justify-center gap-3 py-8 px-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-800 dark:text-emerald-300 font-bold text-sm fade-in">
                  <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 bounce-in" />
                  <span>سابقه آزمایش با موفقیت ثبت گردید.</span>
                </div>
              ) : (
                <>
                  <div className="text-sm font-bold text-indigo-950 dark:text-indigo-300 flex items-center gap-1.5 pb-2 border-b border-indigo-100 dark:border-indigo-800">
                    <Microscope className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>فرم ثبت نتایج و سوابق آنالیز ماده</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Date */}
                    <div>
                      <label className="block text-muted-foreground font-semibold text-xs mb-1.5">تاریخ آزمایش <span className="text-red-500 dark:text-red-400">*</span></label>
                      <ShamsiDatePicker
                        value={newAnalysis.date}
                        onChange={(date) => setNewAnalysis({ ...newAnalysis, date })}
                        placeholder="YYYY/MM/DD"
                      />
                    </div>

                    {/* QC Code */}
                    <div>
                      <label className="block text-muted-foreground font-semibold text-xs mb-1.5">کد آزمایشگاهی / QC Code <span className="text-red-500 dark:text-red-400">*</span></label>
                      <input
                        id="new-qc-code-input"
                        type="text"
                        required
                        value={newAnalysis.qcCode}
                        onChange={e => setNewAnalysis({ ...newAnalysis, qcCode: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono text-left"
                        placeholder="مثال: QC-1405-102"
                        dir="ltr"
                      />
                    </div>

                    {/* Final Decision */}
                    <div>
                      <label className="block text-muted-foreground font-semibold text-xs mb-1.5">نتیجه نهایی (Decision)</label>
                      <select
                        id="new-decision-select"
                        value={newAnalysis.decision}
                        onChange={e => setNewAnalysis({ ...newAnalysis, decision: e.target.value as any })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                      >
                        <option value="Pass">Pass</option>
                        <option value="Approved Conditional">Approved Conditional</option>
                        <option value="Reject">Reject</option>
                      </select>
                    </div>

                    {/* Deviation Reason / regulatory */}
                    <div>
                      <label className="block text-muted-foreground font-semibold text-xs mb-1.5">وضعیت انحراف</label>
                      <select
                        id="new-deviation-select"
                        value={newAnalysis.deviationReason}
                        onChange={e => setNewAnalysis({ ...newAnalysis, deviationReason: e.target.value as any })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                      >
                        <option value="None">None</option>
                        <option value="NCR">NCR</option>
                        <option value="Deviation">Deviation</option>
                        <option value="OOS">OOS</option>
                        <option value="CAPA">CAPA</option>
                        <option value="OOT">OOT</option>
                        <option value="Complaint">Complaint</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  {/* Comments */}
                  <div>
                    <label className="block text-muted-foreground font-semibold text-xs mb-1.5">توضیحات و گزارش آنالیز (Comments)</label>
                    <textarea
                      id="new-comments-textarea"
                      value={newAnalysis.comments}
                      onChange={e => setNewAnalysis({ ...newAnalysis, comments: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                      placeholder="گزارش دقیق آنالیز، درصد خلوص، ناخالصی‌ها، تطابق آزمون‌های فیزیکوشیمیایی یا میکروبیولوژی با مراجع فارماکوپه..."
                    />
                  </div>

                  {addAnalysisError && (
                    <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl px-3.5 py-2.5 text-xs font-semibold">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{addAnalysisError}</span>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      id="cancel-analysis-btn"
                      type="button"
                      onClick={() => {
                        setAddAnalysisError(null);
                        setShowAddAnalysisForm(false);
                        setNewAnalysis({ date: new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/[۰-۹]/g, c => '0123456789'[c.charCodeAt(0) - 1776]), qcCode: '', decision: 'Pass', deviationReason: 'None', comments: '' });
                      }}
                      className="px-3 py-1.5 text-xs font-bold text-muted-foreground bg-muted hover:bg-accent active:bg-border rounded-lg transition-all"
                    >
                      انصراف
                    </button>
                    <button
                      id="submit-analysis-btn"
                      type="button"
                      onClick={handleAddAnalysisSubmit}
                      className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg transition-all shadow-sm"
                    >
                      ثبت آزمایش در سابقه سورس
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Lab results summary + chronological timeline */}
          {vendor.analysisRecords && vendor.analysisRecords.length > 0 && (() => {
            const recs = vendor.analysisRecords!;
            const pass = recs.filter(r => r.decision === 'Pass').length;
            const cond = recs.filter(r => r.decision === 'Approved Conditional').length;
            const rej = recs.filter(r => r.decision === 'Reject').length;
            const total = recs.length;
            const passRate = total > 0 ? Math.round(((pass + cond) / total) * 100) : 0;
            const sorted = [...recs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            return (
              <div className="mb-6 space-y-4">
                {/* Summary strip */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-center">
                    <div className="text-2xl font-black font-mono text-emerald-700 dark:text-emerald-300">{pass}</div>
                    <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">قبول (Pass)</div>
                  </div>
                  <div className="bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-center">
                    <div className="text-2xl font-black font-mono text-blue-700 dark:text-blue-300">{cond}</div>
                    <div className="text-[11px] font-bold text-blue-600 dark:text-blue-400">قبول مشروط</div>
                  </div>
                  <div className="bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl p-3 text-center">
                    <div className="text-2xl font-black font-mono text-rose-700 dark:text-rose-300">{rej}</div>
                    <div className="text-[11px] font-bold text-rose-600 dark:text-rose-400">مردود (Reject)</div>
                  </div>
                  <div className="bg-muted border border-border rounded-xl p-3 text-center">
                    <div className={`text-2xl font-black font-mono ${passRate >= 80 ? 'text-emerald-700 dark:text-emerald-300' : passRate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-700 dark:text-rose-300'}`}>{passRate}%</div>
                    <div className="text-[11px] font-bold text-muted-foreground">نرخ قبولی</div>
                  </div>
                </div>

                {/* Lab results trend line chart (Pass=100 / Conditional=50 / Reject=0) */}
                <div className="bg-muted/50 border border-border/60 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <h4 className="font-bold text-foreground text-xs">روند کیفی نتایج آزمایشگاهی <span className="text-muted-foreground font-normal font-mono">(Lab Quality Trend)</span></h4>
                  </div>
                  <div className="h-56 w-full" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sorted.map((r) => ({
                        label: r.date,
                        qc: r.qcCode,
                        level: r.decision === 'Pass' ? 100 : r.decision === 'Approved Conditional' ? 50 : 0,
                        decision: r.decision,
                      }))} margin={{ top: 10, right: 16, left: -8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'Vazirmatn FD' }} />
                        <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v: number) => v === 100 ? 'Pass' : v === 50 ? 'Cond.' : v === 0 ? 'Reject' : ''} tick={{ fill: '#94a3b8', fontSize: 10 }} width={48} />
                        <RTooltip
                          contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                          formatter={(v: any) => [v === 100 ? 'قبول (Pass)' : v === 50 ? 'قبول مشروط' : 'مردود (Reject)', 'نتیجه']}
                          labelFormatter={(l: any, p: any) => `${l}${p && p[0] ? ' • ' + p[0].payload.qc : ''}`}
                        />
                        <Line type="monotone" dataKey="level" name="نتیجه" stroke="#4f46e5" strokeWidth={2.5}
                          dot={(props: any) => {
                            const c = props.payload.decision === 'Pass' ? '#10b981' : props.payload.decision === 'Approved Conditional' ? '#3b82f6' : '#e11d48';
                            return <circle key={props.key} cx={props.cx} cy={props.cy} r={4.5} fill={c} stroke="#fff" strokeWidth={1.5} />;
                          }}
                          activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Admin decision box for sources/suppliers (not samples) */}
                {!(vendor.isSample || vendor.category === 'sample') && canAnalysis && (
                  <div className={`rounded-xl p-4 border ${vendor.status === 'rejected' ? 'bg-rose-50/50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800' : 'bg-amber-50/40 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <ShieldAlert className={`w-4 h-4 ${vendor.status === 'rejected' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`} />
                      <h4 className="font-bold text-foreground text-xs">تصمیم‌گیری کیفی دربارهٔ سورس <span className="text-muted-foreground font-normal font-mono">(QA Decision)</span></h4>
                    </div>
                    {vendor.status === 'rejected' ? (
                      <p className="text-[11px] text-rose-700 dark:text-rose-300 leading-relaxed mb-3">این سورس در حال حاضر در <strong>لیست سیاه</strong> است. در صورت رفع مشکل می‌توانید آن را بازگردانی کنید (با ذکر دلیل).</p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                        وجود {rej > 0 ? <strong className="text-rose-600 dark:text-rose-400">{rej} نتیجهٔ مردود</strong> : 'نتایج آزمایشگاهی'} به‌تنهایی سورس را رد نمی‌کند. تصمیم نهایی رد سورس با کارشناس کیفیت است و باید با ذکر دلیل ثبت شود (در audit و سابقهٔ سورس ثبت می‌گردد).
                      </p>
                    )}
                    {showRejectBox ? (
                      <div className="space-y-2">
                        <textarea
                          value={rejectDecisionReason}
                          onChange={e => setRejectDecisionReason(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          placeholder={vendor.status === 'rejected' ? 'دلیل بازگردانی از لیست سیاه (الزامی)...' : 'دلیل رد سورس بر اساس نتایج آزمایشگاهی (الزامی)...'}
                        />
                        {rejectError && (
                          <div role="alert" className="flex items-start gap-2 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                            <span>{rejectError}</span>
                          </div>
                        )}
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => { setShowRejectBox(false); setRejectDecisionReason(''); setRejectError(null); }} className="px-3 py-1.5 text-xs font-bold text-muted-foreground bg-muted hover:bg-accent rounded-lg">انصراف</button>
                          {vendor.status === 'rejected' ? (
                            <button type="button" onClick={handleAdminRestoreSource} className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg">تأیید بازگردانی</button>
                          ) : (
                            <button type="button" onClick={handleAdminRejectSource} className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg">تأیید رد و انتقال به لیست سیاه</button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setShowRejectBox(true)} className={`px-4 py-1.5 text-xs font-bold text-white rounded-lg ${vendor.status === 'rejected' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>
                        {vendor.status === 'rejected' ? 'بازگردانی سورس از لیست سیاه' : 'رد سورس و انتقال به لیست سیاه'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Lab Records List / Table */}
          {vendor.analysisRecords && vendor.analysisRecords.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border/60 shadow-xs">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-muted text-foreground border-b border-border/60 font-semibold text-foreground">
                    <th className="py-2.5 px-3 font-bold text-center w-12">ردیف</th>
                    <th className="py-2.5 px-3">تاریخ آزمایش</th>
                    <th className="py-2.5 px-3">کد آزمایشگاهی (QC Code)</th>
                    <th className="py-2.5 px-3">تصمیم نهایی (Decision)</th>
                    <th className="py-2.5 px-3">وضعیت انحراف</th>
                    <th className="py-2.5 px-3 max-w-sm">گزارش و توضیحات آزمایش</th>
                    <th className="py-2.5 px-3">کاربر ثبت‌کننده</th>
                    <th className="py-2.5 px-3 text-center w-36">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...vendor.analysisRecords].reverse().map((record, index) => {
                    const rowNumber = vendor.analysisRecords!.length - index;
                    const isEditingThis = editingAnalysisId === record.id;
                    const isDeletingThis = confirmDeleteAnalysisId === record.id;

                    return (
                      <tr key={record.id || index} className={`${isEditingThis ? 'bg-indigo-50/30 dark:bg-indigo-950/30' : 'hover:bg-accent/50'} transition-all`}>
                        <td className="py-3 px-3 text-center font-mono text-muted-foreground font-semibold">{rowNumber}</td>
                        <td className="py-3 px-3">
                          {isEditingThis ? (
                            <div className="w-40 mx-auto">
                              <ShamsiDatePicker
                                value={editingAnalysis?.date || ''}
                                onChange={date => setEditingAnalysis({ ...editingAnalysis!, date })}
                                placeholder="YYYY/MM/DD"
                              />
                            </div>
                          ) : (
                            <div className="font-mono text-muted-foreground" dir="ltr">{record.date}</div>
                          )}
                        </td>
                        
                        {/* QC Code */}
                        <td className="py-3 px-3">
                          {isEditingThis ? (
                            <input
                              type="text"
                              value={editingAnalysis?.qcCode || ''}
                              onChange={e => setEditingAnalysis({ ...editingAnalysis!, qcCode: e.target.value })}
                              className="px-2 py-1 rounded-lg border border-border font-mono text-center text-xs w-full bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              dir="ltr"
                            />
                          ) : (
                            <span className="font-bold text-foreground font-mono tracking-wide" dir="ltr">{record.qcCode}</span>
                          )}
                        </td>

                        {/* Decision */}
                        <td className="py-3 px-3 font-mono">
                          {isEditingThis ? (
                            <select
                              value={editingAnalysis?.decision || 'Pass'}
                              onChange={e => setEditingAnalysis({ ...editingAnalysis!, decision: e.target.value as any })}
                              className="px-2 py-1 rounded-lg border border-border text-xs w-full text-right bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-medium"
                            >
                              <option value="Pass">Pass</option>
                              <option value="Approved Conditional">Approved Conditional</option>
                              <option value="Reject">Reject</option>
                            </select>
                          ) : (
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              record.decision === 'Pass' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' :
                              record.decision === 'Approved Conditional' ? 'bg-indigo-50 dark:bg-indigo-950/30 text-[#3b82f6] border border-blue-200 dark:border-blue-800' :
                              'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${record.decision === 'Pass' ? 'bg-emerald-500 animate-pulse' : record.decision === 'Approved Conditional' ? 'bg-blue-500' : 'bg-rose-500'}`} />
                              <span>{record.decision === 'Pass' ? 'قبول (Pass)' : record.decision === 'Approved Conditional' ? 'قبول مشروط' : 'مردود (Reject)'}</span>
                            </span>
                          )}
                        </td>

                          {/* Deviation */}
                          <td className="py-3 px-3 font-mono">
                            {isEditingThis ? (
                              <select
                                value={editingAnalysis?.deviationReason || 'None'}
                                onChange={e => setEditingAnalysis({ ...editingAnalysis!, deviationReason: e.target.value as any })}
                                className="px-2 py-1 rounded-lg border border-border text-xs w-full text-right bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-medium"
                              >
                                <option value="None">None</option>
                                <option value="NCR">NCR</option>
                                <option value="Deviation">Deviation</option>
                                <option value="OOS">OOS</option>
                                <option value="CAPA">CAPA</option>
                                <option value="OOT">OOT</option>
                                <option value="Complaint">Complaint</option>
                                <option value="Other">Other</option>
                              </select>
                            ) : (
                              <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold tracking-wide ${
                                record.deviationReason === 'None' ? 'bg-muted text-muted-foreground' :
                                record.deviationReason === 'NCR' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 border border-orange-200 dark:border-orange-800' :
                                record.deviationReason === 'Deviation' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800' :
                                record.deviationReason === 'OOS' ? 'bg-red-100 dark:bg-red-900/40 text-red-900 dark:text-red-300 border border-red-300 dark:border-red-800' :
                                record.deviationReason === 'CAPA' ? 'bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800' :
                                record.deviationReason === 'OOT' ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800' :
                                'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                              }`}>
                                {record.deviationReason}
                              </span>
                            )}
                          </td>

                          {/* Comments */}
                          <td className="py-3 px-3 max-w-sm">
                            {isEditingThis ? (
                              <textarea
                                rows={2}
                                value={editingAnalysis?.comments || ''}
                                onChange={e => setEditingAnalysis({ ...editingAnalysis!, comments: e.target.value })}
                                className="px-2 py-1 rounded-lg border border-border text-xs w-full text-right bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring leading-normal"
                                placeholder="توضیحات..."
                              />
                            ) : (
                              <span className="text-muted-foreground leading-relaxed font-light">{record.comments || 'فاقد توضیحات تکمیلی'}</span>
                            )}
                          </td>

                          {/* RecordedBy */}
                          <td className="py-3 px-3 text-muted-foreground font-semibold">
                            {record.recordedBy}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 text-center">
                            {isEditingThis && editAnalysisError && (
                              <div role="alert" className="mb-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 whitespace-normal">
                                {editAnalysisError}
                              </div>
                            )}
                            {isEditingThis ? (
                              <div className="flex items-center justify-center gap-1.5" dir="ltr">
                                <button
                                  onClick={() => handleEditAnalysisSave(record.id)}
                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded transition-all"
                                  title="ذخیره"
                                >
                                  ذخیره
                                </button>
                                <button
                                  onClick={handleEditAnalysisCancel}
                                  className="px-2 py-1 bg-muted hover:bg-accent text-muted-foreground font-bold text-[10px] rounded transition-all"
                                  title="انصراف"
                                >
                                  انصراف
                                </button>
                              </div>
                            ) : isDeletingThis ? (
                              <div className="flex items-center justify-center gap-1.5" dir="ltr">
                                <button
                                  onClick={() => handleDeleteAnalysis(record.id)}
                                  className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] rounded transition-all"
                                  title="تایید حذف"
                                >
                                  حذف قطعی
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteAnalysisId(null)}
                                  className="px-2 py-1 bg-muted hover:bg-accent text-muted-foreground font-bold text-[10px] rounded transition-all"
                                  title="لغو"
                                >
                                  لغو
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1" dir="ltr">
                                <button
                                  onClick={() => handleEditAnalysisStart(record)}
                                  className="p-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 dark:bg-indigo-950/30 rounded transition-all"
                                  title="ویرایش"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteAnalysisId(record.id)}
                                  className="p-1 text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/40 dark:bg-rose-950/30 rounded transition-all"
                                  title="حذف"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground text-xs bg-muted/50 rounded-xl border border-dashed border-border">
                هیچ سابقه خرید یا نتیجه آنالیز آزمایشگاهی برای این سورس ثبت نشده است.
              </div>
            )}
          </div>
        )}

        {/* Evaluation wizard navigation */}
        {showEvalWizard && (
          <div className="flex items-center justify-between gap-3 bg-card border border-border/60 rounded-2xl px-5 py-4 shadow-sm">
            <button type="button" onClick={() => setEvalStage(evalStages[Math.max(0, evalStageIdx - 1)].id)} disabled={evalStageIdx === 0}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold text-sm text-muted-foreground border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
              <ChevronRight className="w-4 h-4" /> مرحله قبل
            </button>
            <span className="text-xs text-muted-foreground font-medium">مرحله {evalStageIdx + 1} از {evalStages.length}</span>
            {evalStageIdx < evalStages.length - 1 ? (
              <button type="button" onClick={() => setEvalStage(evalStages[Math.min(evalStages.length - 1, evalStageIdx + 1)].id)}
                className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-primary hover:bg-primary-hover transition-colors shadow-sm cursor-pointer">
                مرحله بعد <ChevronLeft className="w-4 h-4" />
              </button>
            ) : (
              <span className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle className="w-4 h-4" /> آخرین مرحله
              </span>
            )}
          </div>
        )}

      </div>
  );
}



// --- View: Risk Assessment Form ---
// FMEA 5×5 risk matrix (Criticality × Probability). Highlights the live cell.
