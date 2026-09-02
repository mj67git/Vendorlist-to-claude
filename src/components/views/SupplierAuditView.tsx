import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Award, Briefcase, Building, Building2, CheckCircle, ChevronLeft, Coins, Factory, Globe, Handshake, Microscope, Pencil, Search, ShieldAlert, Warehouse, X } from 'lucide-react';
import { BusinessPartner, Material, User, Vendor } from '../../types';
import { EntityName } from '../EntityName';
import { GradeBadge } from '../GradeBadge';
import { Pagination } from '../Pagination';
import { Button } from '../ui/button';
import { calculateOverallScore, getDisplayCountry } from '../../utils/vendorUtils';
import { isVendorRejected } from '../../utils/vendorState';
import { getScoreColorClass } from '../../components/ScoreBar';
import { categoryLabels } from '../../constants/categories';
import { canScoreDepartment, scorableDepartments } from '../../utils/permissions';
import { SOP_DOCUMENTS_DEF } from '../../utils/sopEvaluation';
import { useExcelExport } from '../../hooks/useExcelExport';
import { authFetch, isLocalMode } from '../../services/authFetch';
import { cleanPlaceholder, resolveVendorPartner } from '../../utils/vendorPartner';
import { checkLicenseExpiry } from '../../utils/vendorUtils';

// --- View: Supplier Unified Audit & Analysis Module ---

/**
 * The key that decides "these sources are the same company".
 *
 * Grouping stays on the name rather than on the linked business partner: only
 * 2 of 76 sources currently carry a partner link, so keying on the partner
 * would split the other 74 apart instead of consolidating anything.
 *
 * The normalisation is insurance for real data. Persian text routinely arrives
 * with the Arabic ي and ك in place of ی and ک, and with a zero-width non-joiner
 * where a space is meant. Those look identical on screen but are different
 * strings, so one company would silently become two rows with half its
 * materials each.
 */
export function supplierKey(name: string): string {
  return (name || '')
    .replace(/[يﻱﻲ]/g, 'ی')
    .replace(/[كﻙﻚ]/g, 'ک')
    .replace(/[أإآ]/g, 'ا')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

 interface SupplierGroup {
   key: string;
   name: string;
   nameEn: string;
   country: string;
   contactInfo: string;
   registrationDate: string;
   vendors: Vendor[];
 }

  interface SupplierAuditViewProps {
    db: Vendor[];
    onSelectVendor: (vendor: Vendor) => void;
    currentUser: User | null;
    partners?: BusinessPartner[];
    materials?: Material[];
    /** Jump to another module — used to open the linked partner record. */
    onNavigate?: (view: string) => void;
  }

/** The recorded "this is the source we buy from" decision, per material. */
interface SourceSelection {
  materialKey: string;
  category: string;
  vendorId: string;
  reason: string;
  decidedBy: string;
  decidedAt: string;
}

  export function SupplierAuditView({ db, onSelectVendor, currentUser, partners = [], materials = [], onNavigate }: SupplierAuditViewProps) {
    const excel = useExcelExport();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSupplierKey, setSelectedSupplierKey] = useState<string | null>(null);

    const [currentPage, setCurrentPage] = useState(1);

    /** Departments this person may score; drives which figure they are shown. */
    const myDepartments = useMemo(() => scorableDepartments(currentUser), [currentUser]);

    // The recorded purchasing decisions, so this page can say how many of the
    // company's materials it is actually the chosen source for.
    const [selections, setSelections] = useState<SourceSelection[]>([]);
    useEffect(() => {
      if (isLocalMode()) return;
      authFetch('/api/source-selections')
        .then(res => (res.ok ? res.json() : null))
        .then(data => { if (Array.isArray(data)) setSelections(data); })
        .catch(() => { /* the card simply reports none on record */ });
    }, []);

    useEffect(() => {
      setCurrentPage(1);
    }, [searchQuery]);

    // Group vendors list by supplier name
    const supplierGroups = useMemo(() => {
      const groups: Record<string, SupplierGroup> = {};

      db.forEach(v => {
        const key = supplierKey(v.name);
        if (!key) return;

        if (!groups[key]) {
          groups[key] = {
            key,
            name: v.name,
            nameEn: cleanPlaceholder(v.nameEn) || '',
            country: cleanPlaceholder(getDisplayCountry(v)) || '',
            contactInfo: v.contactInfo || '',
            registrationDate: v.registrationDate || '',
            vendors: []
          };
        }
        groups[key].vendors.push(v);
      });

      return Object.values(groups);
    }, [db]);

    // Filter matching suppliers list
    const filteredSuppliers = useMemo(() => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return supplierGroups;

      return supplierGroups.filter(s => 
        s.name.toLowerCase().includes(query) ||
        s.nameEn.toLowerCase().includes(query) ||
        s.country.toLowerCase().includes(query) ||
        s.vendors.some(v => 
          v.material.toLowerCase().includes(query) ||
          v.materialEn.toLowerCase().includes(query) ||
          (v.cas && v.cas.toLowerCase().includes(query))
        )
      );
    }, [supplierGroups, searchQuery]);

    const ITEMS_PER_PAGE = 20;
    const totalItems = filteredSuppliers.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
   const endIndex = startIndex + ITEMS_PER_PAGE;
   const paginatedSuppliers = useMemo(() => {
     return filteredSuppliers.slice(startIndex, endIndex);
   }, [filteredSuppliers, startIndex, endIndex]);

   // Find active supplier details
   const activeSupplier = useMemo(() => {
     if (!selectedSupplierKey) return null;
     return supplierGroups.find(s => s.key === selectedSupplierKey) || null;
   }, [supplierGroups, selectedSupplierKey]);

    /**
     * Who this company is, resolved across every source in the group.
     *
     * It used to read only `vendors[0]`, so a company whose materials were
     * linked to different partner records showed just the first one. It also
     * followed `partner.manufacturerId`, a field the database does not have —
     * the schema notes that suppliers no longer reference a manufacturer — so
     * that branch could never run.
     */
    const activePartnerDetails = useMemo(() => {
      if (!activeSupplier) return null;

      const resolved = activeSupplier.vendors
        .map(v => resolveVendorPartner(v, partners))
        .filter(info => info.partner);

      const manufacturers = [...new Map(
        resolved.filter(r => r.role === 'manufacturer').map(r => [r.partner!.id, r])).values()];
      const suppliers = [...new Map(
        resolved.filter(r => r.role === 'supplier').map(r => [r.partner!.id, r])).values()];

      const primaryMfg = manufacturers[0] ?? null;
      const primarySup = suppliers[0] ?? null;

      return {
        /**
         * Only a real manufacturer record. This used to fall back to the
         * group's own name, so a company that is a *seller* — or one not in
         * Business Partners at all — was labelled «تولید کننده» in the header.
         * The role is a regulated fact about the company, not a place to put a
         * name because the line would otherwise be empty (rule 4).
         */
        mfgPartner: primaryMfg?.partner ?? null,
        mfgName: primaryMfg?.name ?? null,
        mfgCountry: primaryMfg?.country ?? null,
        supName: primarySup?.name ?? null,
        supCountry: primarySup?.country ?? null,
        // «نامشخص» read as if the grade were lost; nobody has evaluated it.
        supGrade: primarySup?.grade ?? 'ارزیابی نشده',
        supPartner: primarySup?.partner ?? null,
        /** More than one distinct partner behind one company name. */
        extraPartners: Math.max(0, manufacturers.length - 1) + Math.max(0, suppliers.length - 1),
        linkedCount: resolved.length,
      };
    }, [activeSupplier, partners]);

    // Aggregate performance metrics for active supplier
   const stats = useMemo(() => {
     if (!activeSupplier) return null;

     const list = activeSupplier.vendors;
     const totalItems = list.length;

     let scoredCount = 0;
     let scoresSum = 0;
     const deptTotals = { commercial: 0, qa: 0, planning: 0, finance: 0 };
     const deptCounts = { commercial: 0, qa: 0, planning: 0, finance: 0 };

     // Which figure this person should see follows their permissions, not
     // their job title. Someone responsible for exactly one department sees
     // that department's average; anyone broader sees the weighted total. Read
     // off the role, this showed a `commercial` account the commercial score
     // even after an admin had moved their permission to QA.
     const myDepartments = scorableDepartments(currentUser);
     const showsOwnDepartment = myDepartments.length === 1;

     list.forEach(v => {
       const overall = showsOwnDepartment
         ? ((v.scores as any)?.[myDepartments[0]] || 0)
         : calculateOverallScore(v.scores, true);
       if (overall !== null && overall > 0) {
         scoresSum += overall;
         scoredCount++;
       }

       if (v.scores) {
         if (v.scores.commercial > 0) { deptTotals.commercial += v.scores.commercial; deptCounts.commercial++; }
         if (v.scores.qa > 0) { deptTotals.qa += v.scores.qa; deptCounts.qa++; }
         if (v.scores.planning > 0) { deptTotals.planning += v.scores.planning; deptCounts.planning++; }
         if (v.scores.finance > 0) { deptTotals.finance += v.scores.finance; deptCounts.finance++; }
       }
     });
 
     const avgPerformance = scoredCount > 0 ? Math.round(scoresSum / scoredCount) : null;
 
     const deptAverages = {
       commercial: deptCounts.commercial > 0 ? Math.round(deptTotals.commercial / deptCounts.commercial) : 0,
       qa: deptCounts.qa > 0 ? Math.round(deptTotals.qa / deptCounts.qa) : 0,
       planning: deptCounts.planning > 0 ? Math.round(deptTotals.planning / deptCounts.planning) : 0,
       finance: deptCounts.finance > 0 ? Math.round(deptTotals.finance / deptCounts.finance) : 0,
     };
 
     // Group count of items by standard status
     const statusDistribution = { approved: 0, conditional: 0, rejected: 0, new: 0 };
     list.forEach(v => {
       statusDistribution[v.status as keyof typeof statusDistribution] = (statusDistribution[v.status as keyof typeof statusDistribution] || 0) + 1;
     });
 
     // Find dominant grade representation
     const gradeCounts: Record<string, number> = {};
     list.forEach(v => {
       if (v.grade) {
         gradeCounts[v.grade] = (gradeCounts[v.grade] || 0) + 1;
       }
     });
 
     let dominantGrade = 'N/A';
     let maxCount = 0;
     Object.entries(gradeCounts).forEach(([g, count]) => {
       if (count > maxCount) {
         maxCount = count;
         dominantGrade = g;
       }
     });
 
     // --- Company-level quality signals -------------------------------------
     // Each of these existed per material and nowhere per company, which is the
     // question this page is actually asked.

     // Laboratory record across everything this company supplies.
     let pass = 0, conditional = 0, reject = 0;
     list.forEach(v => (v.analysisRecords || []).forEach(r => {
       if (r.decision === 'Pass') pass++;
       else if (r.decision === 'Approved Conditional') conditional++;
       else if (r.decision === 'Reject') reject++;
     }));
     const labTotal = pass + conditional + reject;
     const lab = {
       pass, conditional, reject, total: labTotal,
       rate: labTotal > 0 ? Math.round(((pass + conditional) / labTotal) * 100) : null,
       materialsTested: list.filter(v => (v.analysisRecords || []).length > 0).length,
     };

     // Risk: the worst case matters more than the average. One High-risk
     // material is a different conversation from an all-Low portfolio.
     const riskCounts = { High: 0, Medium: 0, Low: 0, none: 0 };
     list.forEach(v => {
       const level = v.riskAssessment?.riskLevel;
       if (level === 'High' || level === 'Medium' || level === 'Low') riskCounts[level]++;
       else riskCounts.none++;
     });
     const highestRisk = riskCounts.High > 0 ? 'High' : riskCounts.Medium > 0 ? 'Medium' : riskCounts.Low > 0 ? 'Low' : null;

     // Licences about to lapse, or already lapsed.
     const licences = { expired: 0, expiring: 0 };
     list.forEach(v => {
       const check = checkLicenseExpiry(v.ircExpiryDate);
       if (check.status === 'expired') licences.expired++;
       else if (check.status === 'expiring_soon') licences.expiring++;
     });

     // Supply continuity: materials for which this company is the only source
     // we hold. Nothing else in the app answers this.
     const soleSource = list.filter(v => {
       if (v.isSample || isVendorRejected(v)) return false;
       const key = (v.material || '').trim().toLowerCase();
       if (!key) return false;
       const alternatives = db.filter(other =>
         other.id !== v.id &&
         !other.isSample &&
         !isVendorRejected(other) &&
         (other.material || '').trim().toLowerCase() === key &&
         supplierKey(other.name) !== activeSupplier.key);
       return alternatives.length === 0;
     });

     // How many of this company's materials it is the recorded source for.
     const chosenFor = list.filter(v =>
       selections.some(sel => sel.vendorId === v.id));

     return {
       chosenFor,
       totalItems,
       avgPerformance,
       deptAverages,
       statusDistribution,
       dominantGrade,
       showsOwnDepartment,
       myDepartmentLabel: showsOwnDepartment ? myDepartments[0] : null,
       lab,
       riskCounts,
       highestRisk,
       licences,
       soleSource,
     };
   }, [activeSupplier, currentUser, db, selections]);
 
   return (
     <div className="space-y-6 fade-in text-right">
       {/* Breadcrumbs / View switcher header */}
       <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-5">
         <div>
           {activeSupplier ? (
             <Button
               variant="outline"
               onClick={() => setSelectedSupplierKey(null)}
             >
               <ChevronLeft className="rotate-180 text-muted-foreground" />
               <span>بازگشت به مانیتور جامع تامین‌کنندگان</span>
             </Button>
           ) : (
             <div className="flex items-center gap-2 bg-teal-50 text-teal-600 border border-teal-200/50 px-3 py-1 rounded-lg text-xs font-bold font-mono">
               <Activity className="w-3.5 h-3.5 animate-pulse" />
               <span>PROACTIVE ACTIVE DISCOVERY MODULE</span>
             </div>
           )}
         </div>
 
         <div className="order-1 md:order-2 text-right">
           <h2 className="text-2xl font-bold text-foreground mb-1.5 flex items-center justify-end gap-3">
             {activeSupplier ? 'کارنامه جامع ممیزی و تامین' : 'بررسی یکپارچه تامین‌کنندگان (Supplier Core)'}
             <Handshake className="w-6 h-6 text-teal-600" />
           </h2>
           <p className="text-[#6E6E73] text-sm">
             {activeSupplier 
               ? 'تجمیع اطلاعات تامین کالا، پایداری کیفیت و سوابق ممیزی اقلام'
               : 'مشاهده و مانیتورینگ متمرکز تامین‌کنندگان، تعداد مواد عرضه شده و گرید کیفی میانگین'
             }
           </p>
         </div>
       </div>

       {/* DETAIL VIEW OF SINGLE SUPPLIER */}
       {activeSupplier && stats ? (
         <div className="space-y-6">
           {/* Supplier Profile Banner Card */}
           <div className="bg-card border border-slate-900/10 rounded-2xl p-6 shadow-sm relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
             <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-teal-600" />
             <div className="flex flex-col sm:flex-row sm:items-center gap-4 text-right">
               <div className="bg-teal-50 border border-teal-100 text-teal-600 p-3 rounded-xl shrink-0 self-start sm:self-center">
                 <Building className="w-7 h-7" />
                </div>
                <div>
                  {activePartnerDetails ? (
                    <>
                      {/* The company's role, only when a partner record states
                          it. A source links to exactly one partner — a seller
                          or a manufacturer, never both (rule 4) — so for most
                          companies only one of these two lines appears. */}
                      {activePartnerDetails.mfgPartner ? (
                        <div className="font-bold text-foreground text-lg sm:text-xl lg:text-2xl leading-tight mb-1">
                          <span>تولیدکننده : {activePartnerDetails.mfgName}</span>
                          {activePartnerDetails.mfgCountry && (
                            <>
                              <span className="mx-3 sm:mx-4 text-slate-300 font-normal">|</span>
                              <span>کشور : {activePartnerDetails.mfgCountry}</span>
                            </>
                          )}
                        </div>
                      ) : !activePartnerDetails.supPartner && (
                        /* No partner record at all: name the company without
                           claiming what it does. Saying "تولید کننده" here was
                           a guess printed as a fact. */
                        <div className="font-bold text-foreground text-lg sm:text-xl lg:text-2xl leading-tight mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>{activeSupplier.name}</span>
                          {activeSupplier.country && (
                            <span className="font-normal text-muted-foreground text-sm">کشور : {activeSupplier.country}</span>
                          )}
                          <span className="text-2xs font-bold bg-muted border border-border text-muted-foreground px-2 py-0.5 rounded-md">
                            نوع شریک ثبت نشده
                          </span>
                        </div>
                      )}

                      {/* Supplier display (Regular) - Only if Source/Partner has a Supplier */}
                      {activePartnerDetails.supPartner && (
                        /* When there is no manufacturer, the seller IS the
                           company on this page, so it gets the heading weight
                           instead of reading as a footnote to a missing line. */
                        <div className={activePartnerDetails.mfgPartner
                          ? 'font-normal text-muted-foreground text-xs sm:text-sm leading-relaxed mt-1'
                          : 'font-bold text-foreground text-lg sm:text-xl lg:text-2xl leading-tight mb-1'}>
                          <span>فروشنده : {activePartnerDetails.supName}</span>
                          {activePartnerDetails.supCountry && (
                            <>
                              <span className="mx-3 text-slate-300 font-normal">|</span>
                              <span>کشور : {activePartnerDetails.supCountry}</span>
                            </>
                          )}
                          <span className="mx-3 text-slate-300 font-normal">|</span>
                          <span className={activePartnerDetails.mfgPartner ? '' : 'text-sm font-semibold'}>
                            گرید SOP : {activePartnerDetails.supGrade}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-lg font-bold text-foreground flex items-center justify-start gap-2.5">
                      <span>{activeSupplier.name}</span>
                      {activeSupplier.country && (
                        <span className="bg-muted border border-border text-muted-foreground text-2xs font-bold px-2 py-0.5 rounded-md font-mono max-w-[200px] truncate" title={activeSupplier.country}>
                          {activeSupplier.country}
                        </span>
                      )}
                    </div>
                  )}
                  {activeSupplier.nameEn && (
                    <div className="text-muted-foreground text-xs font-mono mt-1" dir="ltr" style={{ textAlign: 'right' }}>{activeSupplier.nameEn}</div>
                  )}
                  {activeSupplier.contactInfo && (
                    <p className="text-muted-foreground text-xs mt-2 font-mono" dir="rtl">{activeSupplier.contactInfo}</p>
                  )}
                </div>
              </div>

             {stats.avgPerformance !== null && (
               <div className="bg-muted border border-border rounded-2xl p-4 flex items-center gap-4 self-stretch md:self-auto justify-between">
                 <div className="text-left">
                   <div className="text-2xs uppercase font-bold text-muted-foreground">{stats.showsOwnDepartment ? 'Departmental Average Rating' : 'Integrated SPS Rating'}</div>
                   <div className="text-xs text-muted-foreground font-medium font-sans mt-0.5" dir="rtl">{stats.showsOwnDepartment ? 'شاخص میانگین عملکرد واحد شما' : 'شاخص کل عملکرد تامین‌کننده'}</div>
                 </div>
                 <div className={`text-3xl font-black font-mono leading-none ${getScoreColorClass(stats.avgPerformance)} bg-card px-4 py-3 rounded-xl border border-border shadow-sm`}>
                   {Math.round(stats.avgPerformance || 0).toLocaleString('en-US')}
                 </div>
               </div>
             )}
           </div>

           {/* Company-level signals. Each of these was only ever visible per
               material, which is not the question this page is asked. */}
           <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
             {/* Laboratory record */}
             <div className="bg-card border border-border rounded-2xl p-4">
               <div className="flex items-center gap-2 mb-2">
                 <Microscope className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                 <span className="text-2xs font-bold text-muted-foreground">سابقهٔ آزمایشگاه</span>
               </div>
               {stats.lab.total > 0 ? (
                 <>
                   <div className={`text-2xl font-black font-mono leading-none ${stats.lab.reject > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                     {stats.lab.rate}<span className="text-sm">٪</span>
                   </div>
                   <p className="text-2xs text-muted-foreground mt-1.5 leading-relaxed">
                     {stats.lab.total} تست روی {stats.lab.materialsTested} ماده ·{' '}
                     <span className="text-emerald-700 dark:text-emerald-400 font-bold">{stats.lab.pass + stats.lab.conditional} قبول</span>
                     {stats.lab.reject > 0 && (
                       <> · <span className="text-rose-700 dark:text-rose-400 font-bold">{stats.lab.reject} مردود</span></>
                     )}
                   </p>
                 </>
               ) : (
                 <p className="text-2xs text-muted-foreground mt-1">هنوز تستی ثبت نشده است.</p>
               )}
             </div>

             {/* Risk — the worst case, not the average */}
             <div className="bg-card border border-border rounded-2xl p-4">
               <div className="flex items-center gap-2 mb-2">
                 <ShieldAlert className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                 <span className="text-2xs font-bold text-muted-foreground">بالاترین ریسک</span>
               </div>
               {stats.highestRisk ? (
                 <>
                   <div className={`text-2xl font-black leading-none ${
                     stats.highestRisk === 'High' ? 'text-rose-600'
                     : stats.highestRisk === 'Medium' ? 'text-amber-600' : 'text-emerald-600'
                   }`}>
                     {stats.highestRisk === 'High' ? 'بالا' : stats.highestRisk === 'Medium' ? 'متوسط' : 'پایین'}
                   </div>
                   <p className="text-2xs text-muted-foreground mt-1.5 leading-relaxed">
                     بالا {stats.riskCounts.High} · متوسط {stats.riskCounts.Medium} · پایین {stats.riskCounts.Low}
                     {stats.riskCounts.none > 0 && (
                       <> · <span className="text-amber-700 dark:text-amber-400 font-bold">{stats.riskCounts.none} بدون ارزیابی</span></>
                     )}
                   </p>
                 </>
               ) : (
                 <p className="text-2xs text-amber-700 dark:text-amber-400 mt-1">
                   هیچ‌کدام از {stats.totalItems} ماده ارزیابی ریسک ندارد.
                 </p>
               )}
             </div>

             {/* Licences */}
             <div className="bg-card border border-border rounded-2xl p-4">
               <div className="flex items-center gap-2 mb-2">
                 <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                 <span className="text-2xs font-bold text-muted-foreground">وضعیت IRC</span>
               </div>
               {stats.licences.expired + stats.licences.expiring > 0 ? (
                 <>
                   <div className="text-2xl font-black font-mono leading-none text-rose-600">
                     {stats.licences.expired + stats.licences.expiring}
                   </div>
                   <p className="text-2xs text-muted-foreground mt-1.5 leading-relaxed">
                     {stats.licences.expired > 0 && <span className="text-rose-700 dark:text-rose-400 font-bold">{stats.licences.expired} منقضی</span>}
                     {stats.licences.expired > 0 && stats.licences.expiring > 0 && ' · '}
                     {stats.licences.expiring > 0 && <span className="text-amber-700 dark:text-amber-400 font-bold">{stats.licences.expiring} نزدیک انقضا</span>}
                   </p>
                 </>
               ) : (
                 <>
                   <div className="text-2xl font-black font-mono leading-none text-emerald-600">۰</div>
                   <p className="text-2xs text-muted-foreground mt-1.5">هیچ مجوزی منقضی یا نزدیک انقضا نیست.</p>
                 </>
               )}
             </div>

             {/* Supply continuity */}
             <div className="bg-card border border-border rounded-2xl p-4">
               <div className="flex items-center gap-2 mb-2">
                 <Warehouse className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                 <span className="text-2xs font-bold text-muted-foreground">تک‌منبع</span>
               </div>
               <div className={`text-2xl font-black font-mono leading-none ${stats.soleSource.length > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                 {stats.soleSource.length}
               </div>
               <p className="text-2xs text-muted-foreground mt-1.5 leading-relaxed">
                 {stats.soleSource.length > 0
                   ? 'مادهٔ بدون سورس جایگزین — قطع تأمین از این شرکت مستقیماً تولید را متوقف می‌کند.'
                   : 'برای همهٔ مواد این شرکت سورس جایگزین وجود دارد.'}
               </p>
             </div>
           </div>

           {/* SOP documents live on the partner record; this page only ever
               showed the resulting grade, which says nothing about which
               paperwork is missing or how old the assessment is. */}
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
             <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-4">
               <div className="flex items-center justify-between gap-2 mb-3">
                 <span className="text-2xs font-bold text-muted-foreground flex items-center gap-2">
                   <Award className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                   ارزیابی مدارک SOP
                 </span>
                 {activePartnerDetails?.supPartner && onNavigate && (
                   <button type="button" onClick={() => onNavigate('business-partners')}
                     className="text-2xs font-bold text-primary hover:underline cursor-pointer shrink-0">
                     مشاهده در مخزن شرکای تجاری ←
                   </button>
                 )}
               </div>

               {activePartnerDetails?.supPartner?.evaluation ? (
                 <>
                   <div className="flex flex-wrap items-center gap-3 mb-3">
                     <GradeBadge
                       grade={activePartnerDetails.supPartner.evaluation.grade as any}
                       status={activePartnerDetails.supPartner.evaluation.status as any}
                     />
                     <span className="font-mono font-bold text-foreground text-sm">
                       {activePartnerDetails.supPartner.evaluation.totalScore} <span className="text-2xs text-muted-foreground">از ۱۰۰</span>
                     </span>
                     <span className="text-2xs text-muted-foreground">
                       آخرین ارزیابی: {activePartnerDetails.supPartner.evaluation.updatedAt
                         ? new Date(activePartnerDetails.supPartner.evaluation.updatedAt).toLocaleDateString('fa-IR')
                         : 'نامشخص'}
                       {activePartnerDetails.supPartner.evaluation.updatedBy && ` · ${activePartnerDetails.supPartner.evaluation.updatedBy}`}
                     </span>
                   </div>
                   <div className="space-y-1">
                     {SOP_DOCUMENTS_DEF.map(def => {
                       const doc = activePartnerDetails.supPartner!.evaluation!.documents?.[def.key];
                       const status = doc?.status || 'Not Submitted';
                       const tone =
                         status === 'Approved' ? 'text-emerald-700 dark:text-emerald-400'
                         : status === 'Permit Approval' ? 'text-blue-700 dark:text-blue-400'
                         : status === 'Expired' ? 'text-amber-700 dark:text-amber-400'
                         : 'text-rose-700 dark:text-rose-400';
                       const label =
                         status === 'Approved' ? 'تأییدشده'
                         : status === 'Permit Approval' ? 'تأیید موقت'
                         : status === 'Expired' ? 'منقضی' : 'ارائه نشده';
                       return (
                         <div key={def.key} className="flex items-center justify-between gap-3 text-2xs border-b border-border/50 last:border-0 py-1">
                           <EntityName name={def.nameFa} lines={1} className="text-foreground" />
                           <span className={`font-bold shrink-0 ${tone}`}>{label}</span>
                         </div>
                       );
                     })}
                   </div>
                 </>
               ) : (
                 <p className="text-2xs text-muted-foreground leading-relaxed">
                   {activePartnerDetails?.supPartner
                     ? 'این فروشنده هنوز ارزیابی SOP ندارد.'
                     : 'هیچ‌کدام از اقلام این تأمین‌کننده به یک رکورد فروشنده در مخزن شرکای تجاری متصل نیست، پس ارزیابی SOP در دسترس نیست.'}
                 </p>
               )}
             </div>

             {/* Recorded purchasing decisions + the dossier export */}
             <div className="bg-card border border-border rounded-2xl p-4 flex flex-col justify-between gap-4">
               <div>
                 <div className="flex items-center gap-2 mb-2">
                   <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                   <span className="text-2xs font-bold text-muted-foreground">سورس منتخب</span>
                 </div>
                 <div className="text-2xl font-black font-mono leading-none text-foreground">
                   {stats.chosenFor.length}<span className="text-sm text-muted-foreground"> / {stats.totalItems}</span>
                 </div>
                 <p className="text-2xs text-muted-foreground mt-1.5 leading-relaxed">
                   {stats.chosenFor.length > 0
                     ? 'ماده‌ای که این شرکت به‌عنوان سورس منتخب برایش ثبت شده است.'
                     : 'برای هیچ‌کدام از اقلام این شرکت تصمیم رسمی سورس ثبت نشده است.'}
                 </p>
               </div>

               <Button
                 type="button"
                 variant="success"
                 className="w-full"
                 disabled={excel.busy}
                 onClick={() => excel.run(xl => xl.exportSupplierDossierToExcel({
                   supplierName: activeSupplier.name,
                   vendors: activeSupplier.vendors,
                   partners,
                   materials,
                   chosenMaterials: stats.chosenFor.map(v => v.material),
                   soleSourceMaterials: stats.soleSource.map(v => v.material),
                 }))}
               >
                 <Briefcase />
                 {excel.busy ? 'در حال آماده‌سازی…' : 'خروجی پروندهٔ این تأمین‌کننده'}
               </Button>
               {excel.error && (
                 <p className="mt-2 text-2xs text-rose-600 dark:text-rose-400">{excel.error}</p>
               )}
             </div>
           </div>

           {stats.soleSource.length > 0 && (
             <div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
               <p className="text-2xs font-bold text-amber-900 dark:text-amber-300 mb-2">
                 موادی که فقط از این شرکت تأمین می‌شوند:
               </p>
               <div className="flex flex-wrap gap-1.5">
                 {stats.soleSource.map(v => (
                   <EntityName key={v.id} name={v.material} lines={1}
                     className="text-2xs bg-card text-foreground px-2 py-1 rounded-lg border border-amber-200 dark:border-amber-800 font-medium max-w-[200px]" />
                 ))}
               </div>
             </div>
           )}

           {/* Elegant summary callout instead of the 4 boxes */}
            <div className="bg-muted border border-border/50 rounded-2xl p-4 flex items-center justify-between gap-4 text-right mb-4">
              <div className="flex items-center gap-3 w-full justify-start">
                <div className="bg-teal-50 border border-teal-100 text-teal-600 p-2.5 rounded-xl shrink-0">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-foreground font-bold text-sm">وضعیت تامین کالا</div>
                  <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
                    تاکنون از این تامین‌کننده تعداد <span className="font-bold font-mono text-foreground text-sm mx-1 bg-card border border-border px-1.5 py-0.5 rounded-md shadow-sm">{stats.totalItems}</span> مورد تامین و ارزیابی شده است که جزئیات عملکرد هر یک به تفکیک در جدول زیر ارائه گردیده است:
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-slate-900/10 rounded-2xl shadow-sm overflow-hidden mb-6">
             <div className="bg-muted px-6 py-4 border-b border-slate-900/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
               <div className="w-full sm:w-auto uppercase font-bold text-muted-foreground text-xs tracking-wider text-right">
                 جدول مقایسه نمرات مواد تامین شده (Materials Performance Matrix)
               </div>
               <span className="text-2xs text-teal-600 font-bold bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-md">
                 تعداد اقلام ممیزی شده: <span className="font-mono">{stats.totalItems}</span> ماده فعال یا نمونه
               </span>
             </div>
 
             <div className="overflow-x-auto">
               <table className="w-full text-right divide-y divide-border">
                 <thead className="bg-muted/50 text-2xs sm:text-2xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border">
                   <tr>
                     <th className="px-3 sm:px-4 py-3 text-right">ماده</th>
                     <th className="px-3 sm:px-4 py-3 text-center">CAS No.</th>
                     <th className="px-3 sm:px-4 py-3 text-center">وضعیت</th>
                     <th className="px-3 sm:px-4 py-3 text-center">عملیات</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-border text-xs sm:text-sm">
                   {activeSupplier.vendors.map((v) => {
                     const matchedCat = categoryLabels[v.category as keyof typeof categoryLabels] || { fa: v.category, icon: Globe };
                     const CatIcon = matchedCat.icon;
 
                     return (
                       <tr key={v.id} className="hover:bg-accent/80 transition-colors">
                         <td className="px-3 sm:px-4 py-2.5">
                           <div className="flex items-center gap-2">
                             <div className="bg-muted border border-border text-muted-foreground p-1.5 rounded-lg shrink-0">
                               <CatIcon className="w-3.5 h-3.5" />
                             </div>
                             <div className="min-w-0">
                               <div className="font-bold text-foreground text-2xs sm:text-[12px] whitespace-nowrap" title={v.material}>{v.material || 'N/A'}</div>
                               <div className="text-muted-foreground text-2xs font-mono mt-0.5 whitespace-nowrap" dir="ltr" style={{ textAlign: 'right' }} title={v.materialEn}>{v.materialEn || 'N/A'}</div>
                             </div>
                           </div>
                         </td>
                         <td className="px-3 sm:px-4 py-2.5 text-center whitespace-nowrap">
                           <div className="inline-block text-right">
                             {v.cas && (
                                <div className="text-2xs sm:text-xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50 inline-block font-mono" dir="ltr">
                                  <span className="text-muted-foreground font-sans font-bold text-2xs mr-1">CAS No.:</span>
                                  <span>{v.cas}</span>
                                </div>
                              )}
                             {v.isSample && (
                               <div className="text-2xs text-teal-600 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded font-bold mt-1 block">
                                 نمونه ارزیابی اولیه / سمپل
                               </div>
                             )}
                           </div>
                         </td>
                         <td className="px-3 sm:px-4 py-2.5 text-center">
                           <GradeBadge grade={v.grade} status={v.status} scores={v.scores} />
                         </td>
                         <td className="px-3 sm:px-4 py-2.5 text-center whitespace-nowrap">
                           <Button
                             type="button"
                             variant="ghost"
                             size="sm"
                             onClick={() => onSelectVendor(v)}
                             className="text-teal-600 hover:text-teal-700 bg-teal-50 hover:bg-teal-100/80 border border-teal-200/50 font-bold"
                           >
                             <Pencil />
                             <span>پرونده ممیزی</span>
                           </Button>
                         </td>
                       </tr>
                     );
                   })}
                 </tbody>
               </table>
             </div>
           </div>
 
           {/* Multi-Dimensional Audit Score Breakdown (CSS Infographics Column Charts) */}
           <div className="bg-card border border-slate-900/10 rounded-2xl p-6 shadow-sm">
             <h3 className="text-base text-foreground font-bold mb-6 flex items-center justify-start gap-2.5">
               <span>شاخص میانگین عملکرد تفکیک شده دپارتمانی (Departmental Performance)</span>
               <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-ping" />
             </h3>
 
             <div className={`grid grid-cols-1 ${myDepartments.length > 1 ? 'md:grid-cols-4' : 'max-w-md mx-auto'} gap-6`}>
               {[
                 { id: 'commercial', name: 'بازرگانی', avg: stats.deptAverages.commercial, icon: Briefcase, color: 'bg-primary' },
                 { id: 'qa', name: 'کیفیت', avg: stats.deptAverages.qa, icon: Microscope, color: 'bg-emerald-600' },
                 { id: 'planning', name: 'برنامه‌ریزی و انبار', avg: stats.deptAverages.planning, icon: Warehouse, color: 'bg-violet-600' },
                 { id: 'finance', name: 'مالی', avg: stats.deptAverages.finance, icon: Coins, color: 'bg-amber-600' }
               ].filter(dept => canScoreDepartment(currentUser, dept.id)).map((dept) => (
                 <div key={dept.id} className="bg-muted border border-border rounded-xl p-4 flex flex-col justify-between hover:shadow-md hover:border-border transition-all">
                   <div>
                     <div className="flex items-center justify-between text-foreground font-bold text-sm mb-4">
                       <div className="flex items-center gap-2">
                         <dept.icon className="w-4 h-4 text-muted-foreground" />
                         <span>{dept.name}</span>
                       </div>
                       <span className={`text-sm font-bold font-mono ${getScoreColorClass(dept.avg)}`}>{dept.avg} / 100</span>
                     </div>
                   </div>

                   <div>
                     <div className="w-full bg-slate-200/80 h-2 rounded-full overflow-hidden">
                       <div className={`${getScoreColorClass(dept.avg, true)} h-full rounded-full transition-all`} style={{ width: `${dept.avg}%` }} />
                     </div>
                   </div>
                 </div>
               ))}
             </div>
           </div>
 

 
         </div>
       ) : (
         /* GLOBAL SEARCH & DISCOVERY DIRECTORY OF ALL UNIQUE SUPPLIERS */
         <div className="space-y-6">
           {/* Large Elegant Search Panel */}
           <div className="bg-card/75 backdrop-blur-md border border-slate-900/10 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row gap-4 items-center focus-within:ring-2 focus-within:ring-teal-500/20 transition-all">
             <div className="flex-1 flex items-center gap-3 w-full">
               <Search className="w-5 h-5 text-muted-foreground shrink-0" />
               <input
                 type="text"
                 className="flex-1 bg-transparent text-sm text-foreground placeholder-slate-400 focus:outline-none text-right"
                 placeholder="نام تامین‌کننده، نام داروی شیمیایی، کد CAS یا کشور را جستجو کنید..."
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
               />
               {searchQuery && (
                 <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-muted-foreground">
                   <X className="w-4 h-4" />
                 </button>
               )}
             </div>
           </div>
 
           {/* Grid list of Suppliers */}
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {filteredSuppliers.length === 0 ? (
               <div className="col-span-full bg-card border border-border p-16 rounded-2xl text-center text-muted-foreground flex flex-col items-center">
                 <Building className="w-12 h-12 opacity-20 mb-4 text-teal-600" />
                 <span className="font-bold text-muted-foreground text-lg">هیچ تامین‌کننده‌ای یافت نشد.</span>
                 <p className="text-muted-foreground text-sm mt-1">تغییر کوئری بدهید یا نام انگلیسی دقیق یا فارسی را وارد نمایید.</p>
               </div>
             ) : (
               paginatedSuppliers.map((supplier) => {
                 // calculate simple overall score average for highlight
                 let scoresSum = 0;
                 let scoredCount = 0;
                 supplier.vendors.forEach(v => {
                    const s = myDepartments.length === 1
                      ? ((v.scores as any)?.[myDepartments[0]] || 0)
                      : calculateOverallScore(v.scores, true);
                   if (s !== null && s > 0) {
                     scoresSum += s;
                     scoredCount++;
                   }
                 });
                 const avgScore = scoredCount > 0 ? Math.round(scoresSum / scoredCount) : null;
 
                 return (
                   <div 
                     key={supplier.key}
                     role="button"
                     tabIndex={0}
                     aria-label={`بررسی ممیزی ${supplier.name}`}
                     onClick={() => setSelectedSupplierKey(supplier.key)}
                     onKeyDown={(event) => {
                       if (event.key === 'Enter' || event.key === ' ') {
                         event.preventDefault();
                         setSelectedSupplierKey(supplier.key);
                       }
                     }}
                     className="bg-card border border-slate-900/10 rounded-2xl p-5 hover:shadow-md hover:border-teal-500/20 transition-all cursor-pointer group flex flex-col justify-between text-right"
                   >
                     <div>
                       <div className="flex items-start justify-between gap-3 mb-4">
                         <div className="bg-teal-50 border border-teal-100 text-teal-600 p-2.5 rounded-xl group-hover:bg-teal-600 group-hover:text-white transition-colors">
                           <Building className="w-5 h-5" />
                         </div>
                         {supplier.country && (
                           <div className="text-left font-mono text-2xs text-muted-foreground font-semibold bg-muted px-2 py-0.5 rounded border border-border max-w-[150px] truncate" title={supplier.country}>
                             {supplier.country}
                           </div>
                         )}
                       </div>
 
                       <h3 className="font-bold text-foreground text-base leading-snug tracking-tight group-hover:text-teal-600 transition-colors">
                         {supplier.name}
                       </h3>
                       {supplier.nameEn && (
                         <div className="text-muted-foreground text-xs font-mono mt-1" dir="ltr" style={{ textAlign: 'right' }}>{supplier.nameEn}</div>
                       )}
 
                       {/* List of drugs supplied */}
                       <div className="mt-4 pt-3 border-t border-border">
                         <span className="text-2xs font-bold text-muted-foreground block mb-1.5 uppercase font-sans">محصولات ثبت‌شده در دیتابیس:</span>
                         <div className="flex flex-wrap gap-1 justify-start">
                           {supplier.vendors.slice(0, 3).map((v) => (
                             <EntityName
                               key={v.id}
                               name={v.material}
                               lines={1}
                               className="text-2xs bg-muted text-muted-foreground px-2 py-1 rounded border border-slate-150 font-medium max-w-[160px]"
                             />
                           ))}
                           {supplier.vendors.length > 3 && (
                             <span className="text-2xs bg-slate-900 text-white px-1.5 py-1 rounded font-bold font-mono">
                               +{supplier.vendors.length - 3} مورد دیگر
                             </span>
                           )}
                         </div>
                       </div>
                     </div>
 
                     <div className="mt-6 pt-3 border-t border-border flex items-center justify-between">
                       <div className="flex items-center gap-3">
                         <span className="text-2xs text-muted-foreground font-sans">{myDepartments.length === 1 ? 'میانگین امتیاز واحد شما:' : 'میانگین امتیاز ممیزی:'}</span>
                         <span className={`text-xs font-bold ${getScoreColorClass(avgScore)} font-mono`}>
                           {avgScore !== null ? `${avgScore}%` : 'N/A'}
                         </span>
                       </div>
                       <span className="text-teal-600 group-hover:translate-x-[-4px] transition-transform text-xs font-bold flex items-center gap-1 font-mono">
                         بررسی ممیزی
                         <ChevronLeft className="w-3.5 h-3.5" />
                       </span>
                     </div>
                   </div>
                 );
               })
             )}
           </div>

           <Pagination 
             currentPage={currentPage}
             totalPages={totalPages}
             totalItems={totalItems}
             startIndex={startIndex}
             endIndex={endIndex}
             onPageChange={setCurrentPage}
           />
         </div>
       )}
     </div>
   );
 }
