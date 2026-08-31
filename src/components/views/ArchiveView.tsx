import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, Download, FileText, Printer, Search, X } from 'lucide-react';
import { EntityName } from '../../components/EntityName';
import { Pagination } from '../../components/Pagination';
import { PrintableEvaluationForm } from '../../components/PrintableForms';
import { categoryLabels } from '../../constants/categories';
import { BusinessPartner, Material, User, Vendor } from '../../types';
import { exportCategoryToExcel, exportFullArchiveMultiSheetExcel } from '../../utils/excelExport';
import { isInBlacklistCategory, isVendorRejected } from '../../utils/vendorState';
import { getDisplayCountry } from '../../utils/vendorUtils';

// extracted from App.tsx

export function ArchiveView({ db, currentUser, partners = [], materials = [] }: { db: Vendor[], currentUser: User, partners?: BusinessPartner[], materials?: Material[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  
  const [printingVendor, setPrintingVendor] = useState<Vendor | null>(null);

  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, gradeFilter, riskFilter, categoryFilter, statusFilter]);

  const handleExportCategory = (catId: string, catLabel: string) => {
    exportCategoryToExcel(db, catId, catLabel, partners, materials);
  };

  const filteredDb = useMemo(() => {
    return db.filter(v => {
      const term = searchTerm.toLowerCase();
      const matchSearch = 
        v.name.toLowerCase().includes(term) || 
        v.nameEn.toLowerCase().includes(term) ||
        v.material.toLowerCase().includes(term) ||
        v.materialEn.toLowerCase().includes(term) ||
        v.cas.toLowerCase().includes(term) ||
        (v.irc && v.irc.toLowerCase().includes(term)) ||
        (v.country && getDisplayCountry(v).toLowerCase().includes(term));
        
      const matchGrade = gradeFilter ? v.grade === gradeFilter : true;
      const matchCategory = categoryFilter 
        ? ((categoryFilter as string) === 'sample'
            ? (v.isSample || v.category === 'sample')
            : (categoryFilter as string) === 'approved_samples' 
            ? (v.isSample && (v.status === 'approved' || v.status === 'conditional'))
            : (categoryFilter as string) === 'rejected_samples'
            ? (v.isSample && isVendorRejected(v))
            : (categoryFilter as string) === 'blacklist'
            ? isInBlacklistCategory(v)
            : (v.category === categoryFilter && v.status !== 'rejected' && v.grade !== 'rejected')
          )
        : true;
      const matchStatus = statusFilter ? v.status === statusFilter : true;
      const riskLevel = v.riskAssessment?.riskLevel || 'Unknown';
      const matchRisk = riskFilter 
        ? (riskFilter === 'None' ? (!v.riskAssessment) : riskLevel === riskFilter) 
        : true;
      
      return matchSearch && matchGrade && matchRisk && matchCategory && matchStatus;
    });
  }, [db, searchTerm, gradeFilter, riskFilter, categoryFilter, statusFilter]);

  const ITEMS_PER_PAGE = 20;
  const totalItems = filteredDb.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedDb = useMemo(() => {
    return filteredDb.slice(startIndex, endIndex);
  }, [filteredDb, startIndex, endIndex]);

  if (printingVendor) {
    return <PrintableEvaluationForm vendor={printingVendor} onBack={() => setPrintingVendor(null)} partners={partners} materials={materials} />;
  }

  return (
    <div className="space-y-6 fade-in text-right">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-4">
        {/* Left side: Export Options */}
        <div className="flex items-center gap-2.5 flex-wrap order-2 md:order-1">
          {/* Primary Action: Multi-Sheet Comprehensive Workbook Export */}
          <button 
            type="button" 
            onClick={() => exportFullArchiveMultiSheetExcel(db, partners, materials)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-[0_2px_8px_rgba(5,150,105,0.25)] hover:shadow-[0_4px_14px_rgba(5,150,105,0.35)] transition-all cursor-pointer active:scale-95"
            title="دانلود خروجی جامع چند شیتی شامل کل آرشیو و تفکیک کلیه ۶ دسته‌بندی"
          >
            <Download className="w-4 h-4" />
            <span>خروجی اکسل چند شیتی (Multi-Sheet XLSX)</span>
          </button>

          {/* Secondary Dropdown: Specific single category export */}
          <div className="relative group">
            <button 
              type="button" 
              className="flex items-center gap-2 bg-card hover:bg-accent text-foreground border border-border/90 text-xs font-semibold px-3.5 py-2.5 rounded-xl shadow-xs transition-all cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-primary" />
              <span>خروجی تک‌دسته‌ای</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            
            {/* Custom dropdown menu */}
            <div className="absolute left-0 mt-2 w-64 bg-card border border-border/80 rounded-2xl shadow-xl py-2 z-10 hidden group-hover:block hover:block divide-y divide-border text-right transition-all">
              <div className="px-3.5 py-2 text-[10px] font-bold text-muted-foreground bg-muted/50 rounded-t-2xl tracking-wider select-none">
                انتخاب دسته‌بندی جهت خروجی تک‌شیت
              </div>
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => handleExportCategory('all', 'کل_آرشیو')}
                  className="w-full text-right px-4 py-2 text-xs text-foreground hover:bg-accent hover:text-primary font-medium transition-colors flex items-center justify-between"
                >
                  <span className="font-mono text-[9px] text-muted-foreground">All</span>
                  <span>گزارش تجمیعی کل آرشیو</span>
                </button>
                {Object.entries(categoryLabels).map(([key, labelData]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleExportCategory(key, labelData.fa)}
                    className="w-full text-right px-4 py-2 text-xs text-foreground hover:bg-accent hover:text-primary font-medium transition-colors flex items-center justify-between"
                  >
                    <span className="font-mono text-[9px] text-muted-foreground">{key}</span>
                    <span>گزارش {labelData.fa}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right side: Title */}
        <div className="order-1 md:order-2 text-right">
          <h2 className="text-2xl font-bold text-foreground mb-1 flex items-center justify-end gap-3">
            آرشیو کل تامین‌کنندگان
            <Archive className="w-6 h-6 text-muted-foreground" />
          </h2>
          <p className="text-[#6E6E73] text-sm">لیست جامع تمامی تامین‌کنندگان ارزیابی شده (Vendor Archive Data)</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-card/75 backdrop-blur-md border border-slate-900/10 rounded-2xl p-4 shadow-[0_1px_4px_rgba(15,23,42,0.06)] flex flex-col md:flex-row gap-4 items-center mb-6 focus-within:ring-2 focus-within:ring-cyan-500/20 transition-all">
        <div className="flex-1 flex items-center gap-3 w-full">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            className="flex-1 bg-transparent text-sm text-foreground placeholder-slate-400 focus:outline-none text-right"
            placeholder="جستجو کلمه کلیدی، نام، ماده، CAS، کشور..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="text-muted-foreground hover:text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          {[
            { value: categoryFilter, setValue: setCategoryFilter, options: [{val:'', label:'همه دسته‌ها'}, ...Object.entries(categoryLabels).map(([k,v])=>({val:k, label:v.fa}))] },
            { value: riskFilter, setValue: setRiskFilter, options: [{val:'', label:'همه سطوح ریسک (Risk Level)'}, {val:'Low', label:'ریسک پایین (Low)'}, {val:'Medium', label:'ریسک متوسط (Medium)'}, {val:'High', label:'ریسک بالا (High)'}] },
            { value: gradeFilter, setValue: setGradeFilter, options: [{val:'', label:'همه گریدها'}, {val:'A', label:'Grade A'}, {val:'B', label:'Grade B'}, {val:'C', label:'Grade C'}, {val:'rejected', label:'Rejected'}] }
          ].map((filter, idx) => (
            <select 
              key={idx}
              className="bg-transparent border border-slate-900/10 text-muted-foreground text-xs rounded-xl py-2 px-3 focus:outline-none focus:border-cyan-500/30 flex-1 md:flex-none text-right min-w-[110px]"
              value={filter.value}
              onChange={(e) => filter.setValue(e.target.value)}
            >
              {filter.options.map(opt => <option key={opt.val} value={opt.val}>{opt.label}</option>)}
            </select>
          ))}
        </div>
      </div>

      {/* ARCHIVE TABLE */}
      <div className="rounded-2xl overflow-hidden border border-slate-900/10 shadow-[0_1px_4px_rgba(15,23,42,0.06)] bg-card mb-8">
        <div className="bg-muted border-b border-slate-900/10 grid grid-cols-12 gap-4 px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
          <div className="col-span-6 sm:col-span-4">تامین‌کننده</div>
          <div className="col-span-4 sm:col-span-3">ماده</div>
          <div className="col-span-2 hidden sm:block">دسته</div>
          <div className="col-span-2 hidden sm:block">کشور</div>
          <div className="col-span-2 sm:col-span-1 text-center">جزئیات</div>
        </div>

        <div className="divide-y divide-slate-900/5">
          {filteredDb.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
              <Search className="w-8 h-8 opacity-20 mb-3" />
              <span>هیچ نتیجه‌ای یافت نشد.</span>
            </div>
          ) : paginatedDb.map((v, i) => (
            <div key={v.id} className="grid grid-cols-12 gap-4 px-5 py-3.5 items-center hover:bg-accent transition-colors vendor-row" style={{ animationDelay: `${i * 20}ms` }}>
              <div className="col-span-6 sm:col-span-4 min-w-0">
                <EntityName as="div" name={v.name} lines={2} className="font-semibold text-foreground text-sm" />
                <EntityName as="div" name={v.nameEn} lines={1} dir="ltr" className="text-muted-foreground text-xs mt-0.5" />
              </div>
              <div className="col-span-4 sm:col-span-3 min-w-0">
                <EntityName as="div" name={v.material} lines={2} className="text-muted-foreground text-sm" />
                <div className="font-mono text-muted-foreground text-xs truncate mt-0.5">{v.cas || 'N/A'}</div>
              </div>
              <div className="col-span-2 hidden sm:block min-w-0">
                <span className="bg-slate-900/5 border border-slate-900/10 text-xs text-muted-foreground rounded px-2 py-0.5 inline-block truncate max-w-full font-medium">
                  {v.isSample 
                    ? (v.status === 'rejected' ? 'نمونه تایید نشده' : 'نمونه تایید شده')
                    : (categoryLabels[v.category as keyof typeof categoryLabels]?.fa || v.category)
                  }
                </span>
              </div>
              <div className="col-span-2 hidden sm:block min-w-0 text-muted-foreground text-sm truncate">
                {getDisplayCountry(v).split(' ')[0]}
              </div>
              <div className="col-span-2 sm:col-span-1 text-center flex items-center justify-center gap-2">
                {currentUser?.role === 'admin' ? (
                  <button 
                    onClick={() => setPrintingVendor(v)}
                    className="p-1.5 text-muted-foreground hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors border border-transparent hover:border-cyan-200"
                    title="چاپ فرم ارزیابی"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground font-medium font-mono">-</span>
                )}
              </div>
            </div>
          ))}
        </div>
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
  );
}

// --- View: Vendor Detail ---
