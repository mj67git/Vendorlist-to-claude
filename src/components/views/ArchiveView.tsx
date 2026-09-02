import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronDown, Download, FileText, ListChecks, Printer, Search, Star, X } from 'lucide-react';
import { EntityName } from '../../components/EntityName';
import { Pagination } from '../../components/Pagination';
import { Button } from '../../components/ui/button';
import { PrintableArchiveList, PrintableEvaluationForm } from '../../components/PrintableForms';
import { categoryLabels } from '../../constants/categories';
import { BusinessPartner, Material, User, Vendor } from '../../types';
import { useExcelExport } from '../../hooks/useExcelExport';
import { authFetch, isLocalMode } from '../../services/authFetch';
import { describeSelection, selectionForVendor, type SourceSelectionRecord } from '../../utils/sourceSelection';
import { cleanPlaceholder } from '../../utils/vendorPartner';
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
  const [printingList, setPrintingList] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [perPage, setPerPage] = useState(20);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!exportMenuRef.current?.contains(e.target as Node)) setExportMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportMenuOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportMenuOpen]);

  /**
   * The recorded "this is the source we chose" decisions.
   *
   * The archive is the register people read and export, so a decision that was
   * made in the category view has to be visible here too — otherwise the
   * document handed to an auditor shows nine equal-looking rows for a material
   * where one of them is the one actually chosen.
   */
  const [selections, setSelections] = useState<SourceSelectionRecord[]>([]);
  const [onlySelected, setOnlySelected] = useState(false);

  useEffect(() => {
    if (isLocalMode()) return;
    let cancelled = false;
    authFetch('/api/source-selections')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && Array.isArray(data)) setSelections(data); })
      .catch(() => { /* no recorded choices to show */ });
    return () => { cancelled = true; };
  }, []);

  const [currentPage, setCurrentPage] = useState(1);
  const excel = useExcelExport();

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, gradeFilter, riskFilter, categoryFilter, statusFilter, onlySelected, perPage]);

  /**
   * The per-category button exports that category, so the on-screen filters do
   * not apply to it and it says so by carrying no filter summary. The button
   * beside it exports what is actually on screen.
   */
  const handleExportCategory = (catId: string, catLabel: string) => {
    void excel.run(xl => xl.exportCategoryToExcel(db, catId, catLabel, partners, materials, selections));
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
        (v.country && getDisplayCountry(v).toLowerCase().includes(term)) ||
        // People look a source up by the company it is connected to, which the
        // row does not print but the record knows.
        partners.some(p =>
          (p.id === v.manufacturerId || p.id === v.supplierId) &&
          ((p.name || '').toLowerCase().includes(term) || (p.nameEn || '').toLowerCase().includes(term)));
        
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
      
      const matchSelected = onlySelected ? !!selectionForVendor(v, selections) : true;

      return matchSearch && matchGrade && matchRisk && matchCategory && matchStatus && matchSelected;
    });
  }, [db, searchTerm, gradeFilter, riskFilter, categoryFilter, statusFilter, onlySelected, selections, partners]);

  const selectedCount = useMemo(
    () => db.filter(v => !!selectionForVendor(v, selections)).length,
    [db, selections],
  );

  // Rows per page, like the materials, partners and audit tables. The archive
  // is the longest list in the application and was the only one still fixed at
  // twenty.
  const ITEMS_PER_PAGE = perPage;
  const totalItems = filteredDb.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedDb = useMemo(() => {
    return filteredDb.slice(startIndex, endIndex);
  }, [filteredDb, startIndex, endIndex]);

  /**
   * What the printed extract was filtered by.
   *
   * A printed register that does not say what it excluded is not evidence of
   * anything — "these are our suppliers" reads very differently from "these are
   * our Grade A foreign suppliers". Built from the controls that are actually
   * set, so an unfiltered print says so plainly.
   */
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (categoryFilter) parts.push(`دسته: ${categoryLabels[categoryFilter as keyof typeof categoryLabels]?.fa || categoryFilter}`);
    if (gradeFilter) parts.push(`گرید: ${gradeFilter}`);
    if (riskFilter) parts.push(`ریسک: ${riskFilter}`);
    if (statusFilter) parts.push(`وضعیت: ${statusFilter}`);
    if (onlySelected) parts.push('فقط سورس‌های منتخب');
    if (searchTerm.trim()) parts.push(`جستجو: «${searchTerm.trim()}»`);
    return parts.length ? parts.join(' · ') : 'بدون فیلتر — کل آرشیو';
  }, [categoryFilter, gradeFilter, riskFilter, statusFilter, onlySelected, searchTerm]);

  if (printingList) {
    return (
      <PrintableArchiveList
        vendors={filteredDb}
        filterSummary={filterSummary}
        selections={selections}
        onBack={() => setPrintingList(false)}
      />
    );
  }

  if (printingVendor) {
    return (
      <PrintableEvaluationForm
        vendor={printingVendor}
        onBack={() => setPrintingVendor(null)}
        partners={partners}
        materials={materials}
        selection={selectionForVendor(printingVendor, selections)}
      />
    );
  }

  return (
    <div className="space-y-6 fade-in text-right">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-4">
        {/* Left side: Export Options */}
        <div className="flex items-center gap-2.5 flex-wrap order-2 md:order-1">
          {/* Primary Action: Multi-Sheet Comprehensive Workbook Export */}
          <Button
            type="button"
            variant="success"
            onClick={() => excel.run(xl => xl.exportFullArchiveMultiSheetExcel(db, partners, materials, selections))}
            disabled={excel.busy}
            title="دانلود خروجی جامع چند شیتی شامل کل آرشیو و تفکیک کلیه ۶ دسته‌بندی"
          >
            <Download />
            <span>خروجی اکسل چند شیتی (Multi-Sheet XLSX)</span>
          </Button>

          {/* Print the list itself. "PDF" in this module used to mean one
              evaluation form for one source; the register as a whole could only
              leave as a spreadsheet, which is not a document anyone signs. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => setPrintingList(true)}
            title="چاپ همین فهرست (با فیلترهای اعمال‌شده) — قابل ذخیره به‌صورت PDF"
          >
            <ListChecks className="text-primary" />
            <span>چاپ فهرست (PDF)</span>
          </Button>

          {/* The spreadsheet counterpart of the print button. Both other export
              buttons ignore the filters on screen — deliberately, they are
              "the whole archive" and "one category" — so someone who had
              narrowed the list down had no way to export what they were
              looking at. The sheet carries the same filter caption the printed
              register carries, so an extract cannot be mistaken for the whole. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => excel.run(xl => xl.exportCategoryToExcel(
              filteredDb, 'all', 'نمای_فیلترشده', partners, materials, selections, filterSummary,
            ))}
            disabled={excel.busy}
            title="خروجی اکسل از همین فهرست، با فیلترهای اعمال‌شده"
          >
            <Download className="text-primary" />
            <span>خروجی نمای فعلی ({filteredDb.length.toLocaleString('fa-IR')})</span>
          </Button>

          {/* Secondary menu: one category at a time.
              It used to open on `group-hover` alone — unreachable from the
              keyboard (Tab then Enter did nothing) and unusable on a tablet,
              where there is no hover at all. It is a real menu now: a button
              that toggles, Escape and an outside click to dismiss. */}
          <div className="relative" ref={exportMenuRef}>
            <Button
              type="button"
              variant="outline"
              onClick={() => setExportMenuOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
            >
              <FileText className="text-primary" />
              <span>خروجی تک‌دسته‌ای</span>
              <ChevronDown className={`text-muted-foreground transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
            </Button>

            <div role="menu" hidden={!exportMenuOpen} className="absolute left-0 mt-2 w-64 bg-card border border-border rounded-2xl shadow-xl py-2 z-20 divide-y divide-border text-right">
              <div className="px-3.5 py-2 text-2xs font-bold text-muted-foreground bg-muted/50 rounded-t-2xl tracking-wider select-none">
                انتخاب دسته‌بندی جهت خروجی تک‌شیت
              </div>
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => { setExportMenuOpen(false); handleExportCategory('all', 'کل_آرشیو'); }}
                  className="w-full text-right px-4 py-2 text-xs text-foreground hover:bg-accent hover:text-primary font-medium transition-colors flex items-center justify-between"
                >
                  <span className="font-mono text-2xs text-muted-foreground">All</span>
                  <span>گزارش تجمیعی کل آرشیو</span>
                </button>
                {Object.entries(categoryLabels).map(([key, labelData]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setExportMenuOpen(false); handleExportCategory(key, labelData.fa); }}
                    className="w-full text-right px-4 py-2 text-xs text-foreground hover:bg-accent hover:text-primary font-medium transition-colors flex items-center justify-between"
                  >
                    <span className="font-mono text-2xs text-muted-foreground">{key}</span>
                    <span>گزارش {labelData.fa}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* The spreadsheet writer is fetched on demand, so a download can now
              fail before it starts. Saying nothing would look like a dead
              button. */}
          {excel.busy && (
            <span className="text-xs text-muted-foreground self-center">در حال آماده‌سازی خروجی…</span>
          )}
          {excel.error && (
            <p className="text-xs text-rose-600 dark:text-rose-400 self-center max-w-sm">{excel.error}</p>
          )}
        </div>

        {/* Right side: Title */}
        <div className="order-1 md:order-2 text-right">
          <h2 className="text-2xl font-bold text-foreground mb-1 flex items-center justify-end gap-3">
            آرشیو کل تامین‌کنندگان
            <Archive className="w-6 h-6 text-muted-foreground" />
          </h2>
          <p className="text-muted-foreground text-sm">لیست جامع تمامی تامین‌کنندگان ارزیابی شده (Vendor Archive Data)</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-card/75 backdrop-blur-md border border-border rounded-2xl p-4 shadow-xs flex flex-col md:flex-row gap-4 items-center mb-6 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
        <div className="flex-1 flex items-center gap-3 w-full">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none text-right"
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
            { value: gradeFilter, setValue: setGradeFilter, options: [{val:'', label:'همه گریدها'}, {val:'A', label:'Grade A'}, {val:'B', label:'Grade B'}, {val:'C', label:'Grade C'}, {val:'rejected', label:'Rejected'}] },
            // `statusFilter` was already read by the filtering logic but no
            // control ever rendered for it, so it could only ever be the empty
            // default — dead state pretending to be a feature.
            { value: statusFilter, setValue: setStatusFilter, options: [{val:'', label:'همه وضعیت‌ها'}, {val:'approved', label:'تأییدشده'}, {val:'conditional', label:'مشروط'}, {val:'new', label:'جدید / در انتظار'}, {val:'rejected', label:'مردود'}] }
          ].map((filter, idx) => (
            <select 
              key={idx}
              className="bg-transparent border border-border text-muted-foreground text-xs rounded-xl py-2 px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex-1 md:flex-none text-right min-w-[110px]"
              value={filter.value}
              onChange={(e) => filter.setValue(e.target.value)}
            >
              {filter.options.map(opt => <option key={opt.val} value={opt.val}>{opt.label}</option>)}
            </select>
          ))}
          {/* A star invites the question "which ones are chosen?", so the answer
              is one click away rather than a scroll through every page. Hidden
              when nothing has been chosen yet, so it never offers an empty
              result. */}
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlySelected(v => !v)}
              aria-pressed={onlySelected}
              title="نمایش فقط سورس‌هایی که به‌عنوان منتخب ثبت شده‌اند"
              className={`shrink-0 flex items-center gap-1.5 text-xs font-bold rounded-xl py-2 px-3 border transition-colors cursor-pointer ${
                onlySelected
                  ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800'
                  : 'bg-transparent text-muted-foreground border-border hover:bg-accent'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${onlySelected ? 'fill-current' : ''}`} />
              <span>فقط منتخب‌ها ({selectedCount.toLocaleString('fa-IR')})</span>
            </button>
          )}
        </div>
      </div>

      {/* ARCHIVE TABLE */}
      <div className="rounded-2xl overflow-hidden border border-border shadow-xs bg-card mb-8">
        <div className="bg-muted border-b border-border grid grid-cols-12 gap-4 px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
          <div className="col-span-6 sm:col-span-4">تامین‌کننده</div>
          <div className="col-span-4 sm:col-span-3">ماده</div>
          <div className="col-span-2 hidden sm:block">دسته</div>
          <div className="col-span-2 hidden sm:block">کشور</div>
          <div className="col-span-2 sm:col-span-1 text-center">جزئیات</div>
        </div>

        <div className="divide-y divide-border">
          {filteredDb.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
              <Search className="w-8 h-8 opacity-20 mb-3" />
              <span>هیچ نتیجه‌ای یافت نشد.</span>
            </div>
          ) : paginatedDb.map((v, i) => {
            const chosen = selectionForVendor(v, selections);
            return (
            <div key={v.id} className="grid grid-cols-12 gap-4 px-5 py-3.5 items-center hover:bg-accent transition-colors vendor-row" style={{ animationDelay: `${i * 20}ms` }}>
              <div className="col-span-6 sm:col-span-4 min-w-0">
                {/* The star marks the row, not the company: a supplier can be the
                    chosen source for one material and not for another, so the
                    mark belongs to this vendor+material pair. The title carries
                    the reason and who signed for it, because a bare star only
                    raises the question "chosen for what, by whom?". */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {chosen && (
                    <span
                      className="shrink-0 inline-flex items-center gap-1 text-2xs font-bold text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900 px-1.5 py-0.5 rounded-md"
                      title={`سورس منتخب برای «${v.material || v.materialEn}» — ${describeSelection(chosen)}`}
                    >
                      <Star className="w-3 h-3 fill-current" />
                      <span>منتخب</span>
                    </span>
                  )}
                  <EntityName name={v.name} lines={2} className="font-semibold text-foreground text-sm" />
                </div>
                {/* Imported rows carry a literal "Unknown"/"N/A" as the Latin
                    name; printed under the company it read like the company's
                    actual English name. Nothing is clearer than a wrong name. */}
                {cleanPlaceholder(v.nameEn) && (
                  <EntityName as="div" name={v.nameEn} lines={1} dir="ltr" className="text-muted-foreground text-xs mt-0.5" />
                )}
              </div>
              <div className="col-span-4 sm:col-span-3 min-w-0">
                <EntityName as="div" name={v.material} lines={2} className="text-muted-foreground text-sm" />
                <div className="font-mono text-muted-foreground text-xs truncate mt-0.5">{v.cas || 'N/A'}</div>
              </div>
              <div className="col-span-2 hidden sm:block min-w-0">
                <span className="bg-muted border border-border text-xs text-muted-foreground rounded px-2 py-0.5 inline-block truncate max-w-full font-medium">
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
                {/* Printing follows `vendor.read`, the permission that already
                    lets someone open this page and export the whole archive to
                    Excel. Gating it on `role === 'admin'` protected nothing —
                    the same data left the building through the export button
                    next to it — while making QA ask an admin to print a form
                    they are entitled to read. */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setPrintingVendor(v)}
                  className="text-muted-foreground hover:text-primary border border-transparent hover:border-border"
                  title="چاپ فرم ارزیابی"
                >
                  <Printer />
                </Button>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="flex items-center gap-2 text-2xs font-bold text-muted-foreground shrink-0">
          <span>تعداد در هر صفحه</span>
          <select
            value={perPage}
            onChange={e => { setPerPage(Number(e.target.value)); setCurrentPage(1); }}
            className="bg-card border border-border rounded-lg px-2 py-1 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex-1">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            startIndex={startIndex}
            endIndex={endIndex}
            onPageChange={setCurrentPage}
          />
        </div>
      </div>
    </div>
  );
}

// --- View: Vendor Detail ---
