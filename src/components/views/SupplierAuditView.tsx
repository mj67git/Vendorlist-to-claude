import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Award, Briefcase, Building, Building2, CheckCircle, ChevronLeft, Coins, Factory, Globe, Handshake, Microscope, Pencil, Search, ShieldAlert, Warehouse, X } from 'lucide-react';
import { BusinessPartner, Scores, User, Vendor } from '../../types';
import { GradeBadge } from '../GradeBadge';
import { Pagination } from '../Pagination';
import { calculateOverallScore, getDisplayCountry } from '../../utils/vendorUtils';
import { isVendorRejected } from '../../utils/vendorState';
import { getScoreColorClass } from '../../components/ScoreBar';
import { categoryLabels } from '../../constants/categories';
import { canScoreDepartment } from '../../utils/permissions';

// --- View: Supplier Unified Audit & Analysis Module ---

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
  }

  export function SupplierAuditView({ db, onSelectVendor, currentUser, partners = [] }: SupplierAuditViewProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSupplierKey, setSelectedSupplierKey] = useState<string | null>(null);

    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
      setCurrentPage(1);
    }, [searchQuery]);

    // Group vendors list by supplier name
    const supplierGroups = useMemo(() => {
      const groups: Record<string, SupplierGroup> = {};

      db.forEach(v => {
        const key = v.name.trim().toLowerCase();
        if (!key) return;

        if (!groups[key]) {
          groups[key] = {
            key,
            name: v.name,
            nameEn: v.nameEn || 'N/A',
            country: getDisplayCountry(v) || 'مشخص نشده',
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

       // Business Partner Resolution for Active Supplier Header
    const activePartnerDetails = useMemo(() => {
      if (!activeSupplier) return null;

      const firstVendor = activeSupplier.vendors[0];
      const matchedPartner = partners.find(p => p.name.trim().toLowerCase() === activeSupplier.name.trim().toLowerCase());

      let mfgPartner = partners.find(p => p.id === firstVendor?.manufacturerId);
      let supPartner = partners.find(p => p.id === firstVendor?.supplierId);

      if (matchedPartner) {
        if (matchedPartner.type === 'Supplier') {
          supPartner = matchedPartner;
          if (!mfgPartner && matchedPartner.manufacturerId) {
            mfgPartner = partners.find(p => p.id === matchedPartner.manufacturerId);
          }
        } else if (matchedPartner.type === 'Manufacturer') {
          mfgPartner = matchedPartner;
        }
      }

      const mfgName = mfgPartner ? mfgPartner.name : (firstVendor?.name || activeSupplier.name);
      const mfgCountry = mfgPartner ? (mfgPartner.country || 'نامشخص') : (activeSupplier.country || 'نامشخص');

      const supName = supPartner ? supPartner.name : null;
      const supCountry = supPartner ? (supPartner.country || 'نامشخص') : null;
      const supGrade = supPartner?.evaluation?.grade || 'نامشخص';

      return {
        mfgName,
        mfgCountry,
        supName,
        supCountry,
        supGrade,
        supPartner
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

     list.forEach(v => {
       let overall = null;
       if (currentUser?.role === 'admin') {
         overall = calculateOverallScore(v.scores, true);
       } else if (currentUser?.role) {
         overall = v.scores?.[currentUser.role as keyof Scores] || 0;
       }
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
 
     return {
       totalItems,
       avgPerformance,
       deptAverages,
       statusDistribution,
       dominantGrade
     };
   }, [activeSupplier]);
 
   return (
     <div className="space-y-6 fade-in text-right">
       {/* Breadcrumbs / View switcher header */}
       <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-5">
         <div>
           {activeSupplier ? (
             <button 
               onClick={() => setSelectedSupplierKey(null)}
               className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-xs font-bold border border-border bg-card rounded-xl px-4 py-2.5 shadow-sm transition-all cursor-pointer"
             >
               <ChevronLeft className="w-4 h-4 rotate-180 text-muted-foreground" />
               <span>بازگشت به مانیتور جامع تامین‌کنندگان</span>
             </button>
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
                      {/* Manufacturer display (Bold) */}
                      <div className="font-bold text-foreground text-lg sm:text-xl lg:text-2xl leading-tight mb-1">
                        <span>تولید کننده : {activePartnerDetails.mfgName}</span>
                        <span className="mx-3 sm:mx-4 text-slate-300 font-normal">|</span>
                        <span>کشور : {activePartnerDetails.mfgCountry}</span>
                      </div>

                      {/* Supplier display (Regular) - Only if Source/Partner has a Supplier */}
                      {activePartnerDetails.supPartner && (
                        <div className="font-normal text-muted-foreground text-xs sm:text-sm leading-relaxed mt-1">
                          <span>فروشنده : {activePartnerDetails.supName}</span>
                          <span className="mx-3 text-slate-300">|</span>
                          <span>کشور : {activePartnerDetails.supCountry}</span>
                          <span className="mx-3 text-slate-300">|</span>
                          <span>Grade : {activePartnerDetails.supGrade}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-lg font-bold text-foreground flex items-center justify-start gap-2.5">
                      <span>{activeSupplier.name}</span>
                      {activeSupplier.country && (
                        <span className="bg-muted border border-border text-muted-foreground text-[10px] font-bold px-2 py-0.5 rounded-md font-mono max-w-[200px] truncate" title={activeSupplier.country}>
                          {activeSupplier.country}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-muted-foreground text-xs font-mono mt-1" dir="ltr" style={{ textAlign: 'right' }}>{activeSupplier.nameEn}</div>
                  {activeSupplier.contactInfo && (
                    <p className="text-muted-foreground text-xs mt-2 font-mono" dir="rtl">{activeSupplier.contactInfo}</p>
                  )}
                </div>
              </div>

             {stats.avgPerformance !== null && (
               <div className="bg-muted border border-border rounded-2xl p-4 flex items-center gap-4 self-stretch md:self-auto justify-between">
                 <div className="text-left">
                   <div className="text-[10px] uppercase font-bold text-muted-foreground">{currentUser?.role === 'admin' ? 'Integrated SPS Rating' : 'Departmental Average Rating'}</div>
                   <div className="text-xs text-muted-foreground font-medium font-sans mt-0.5" dir="rtl">{currentUser?.role === 'admin' ? 'شاخص کل عملکرد تامین‌کننده' : 'شاخص میانگین عملکرد واحد شما'}</div>
                 </div>
                 <div className={`text-3xl font-black font-mono leading-none ${getScoreColorClass(stats.avgPerformance)} bg-card px-4 py-3 rounded-xl border border-border shadow-sm`}>
                   {Math.round(stats.avgPerformance || 0).toLocaleString('en-US')}
                 </div>
               </div>
             )}
           </div>

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
               <span className="text-[10px] text-teal-600 font-bold bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-md">
                 تعداد اقلام ممیزی شده: <span className="font-mono">{stats.totalItems}</span> ماده فعال یا نمونه
               </span>
             </div>
 
             <div className="overflow-x-auto">
               <table className="w-full text-right divide-y divide-border">
                 <thead className="bg-muted/50 text-[10px] sm:text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border">
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
                               <div className="font-bold text-foreground text-[11px] sm:text-[12px] whitespace-nowrap" title={v.material}>{v.material || 'N/A'}</div>
                               <div className="text-muted-foreground text-[9px] sm:text-[10px] font-mono mt-0.5 whitespace-nowrap" dir="ltr" style={{ textAlign: 'right' }} title={v.materialEn}>{v.materialEn || 'N/A'}</div>
                             </div>
                           </div>
                         </td>
                         <td className="px-3 sm:px-4 py-2.5 text-center whitespace-nowrap">
                           <div className="inline-block text-right">
                             {v.cas && (
                                <div className="text-[10px] sm:text-xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50 inline-block font-mono" dir="ltr">
                                  <span className="text-muted-foreground font-sans font-bold text-[9px] mr-1">CAS No.:</span>
                                  <span>{v.cas}</span>
                                </div>
                              )}
                             {v.isSample && (
                               <div className="text-[9px] sm:text-[10px] text-teal-600 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded font-bold mt-1 block">
                                 نمونه ارزیابی اولیه / سمپل
                               </div>
                             )}
                           </div>
                         </td>
                         <td className="px-3 sm:px-4 py-2.5 text-center">
                           <GradeBadge grade={v.grade} status={v.status} scores={v.scores} />
                         </td>
                         <td className="px-3 sm:px-4 py-2.5 text-center whitespace-nowrap">
                           <button
                             type="button"
                             onClick={() => onSelectVendor(v)}
                             className="text-teal-600 hover:text-teal-700 bg-teal-50 hover:bg-teal-100/80 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-colors border border-teal-200/50 font-bold text-[10px] sm:text-xs cursor-pointer inline-flex items-center gap-1"
                           >
                             <Pencil className="w-3 h-3" />
                             <span>پرونده ممیزی</span>
                           </button>
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
 
             <div className={`grid grid-cols-1 ${currentUser?.role === 'admin' ? 'md:grid-cols-4' : 'max-w-md mx-auto'} gap-6`}>
               {[
                 { id: 'commercial', name: 'بازرگانی', avg: stats.deptAverages.commercial, icon: Briefcase, color: 'bg-[#0071E3]' },
                 { id: 'qa', name: 'کیفیت', avg: stats.deptAverages.qa, icon: Microscope, color: 'bg-emerald-600' },
                 { id: 'planning', name: 'برنامه‌ریزی و انبار', avg: stats.deptAverages.planning, icon: Warehouse, color: 'bg-violet-600' },
                 { id: 'finance', name: 'مالی', avg: stats.deptAverages.finance, icon: Coins, color: 'bg-amber-600' }
               ].filter(dept => canScoreDepartment(currentUser?.role, dept.id)).map((dept) => (
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
                    let s = null;
                    if (currentUser?.role === 'admin') {
                      s = calculateOverallScore(v.scores, true);
                    } else if (currentUser?.role) {
                      s = v.scores?.[currentUser.role as keyof Scores] || 0;
                    }
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
                         <div className="text-left font-mono text-[10px] text-muted-foreground font-semibold bg-muted px-2 py-0.5 rounded border border-border max-w-[150px] truncate" title={supplier.country}>
                           {supplier.country}
                         </div>
                       </div>
 
                       <h3 className="font-bold text-foreground text-base leading-snug tracking-tight group-hover:text-teal-600 transition-colors">
                         {supplier.name}
                       </h3>
                       <div className="text-muted-foreground text-xs font-mono mt-1" dir="ltr" style={{ textAlign: 'right' }}>{supplier.nameEn}</div>
 
                       {/* List of drugs supplied */}
                       <div className="mt-4 pt-3 border-t border-border">
                         <span className="text-[10px] font-bold text-muted-foreground block mb-1.5 uppercase font-sans">محصولات ثبت‌شده در دیتابیس:</span>
                         <div className="flex flex-wrap gap-1 justify-start">
                           {supplier.vendors.slice(0, 3).map((v) => (
                             <span key={v.id} className="text-[10px] bg-muted text-muted-foreground px-2 py-1 rounded border border-slate-150 font-medium max-w-[120px] truncate">
                               {v.material}
                             </span>
                           ))}
                           {supplier.vendors.length > 3 && (
                             <span className="text-[9px] bg-slate-900 text-white px-1.5 py-1 rounded font-bold font-mono">
                               +{supplier.vendors.length - 3} مورد دیگر
                             </span>
                           )}
                         </div>
                       </div>
                     </div>
 
                     <div className="mt-6 pt-3 border-t border-border flex items-center justify-between">
                       <div className="flex items-center gap-3">
                         <span className="text-[11px] text-muted-foreground font-sans">{currentUser?.role === 'admin' ? 'میانگین امتیاز ممیزی:' : 'میانگین امتیاز واحد شما:'}</span>
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
