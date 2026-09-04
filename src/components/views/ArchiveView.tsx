import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronDown, Download, ExternalLink, FileText, ListChecks, Printer, Search, Star, X } from 'lucide-react';
import { EntityName } from '../../components/EntityName';
import { GradeBadge } from '../../components/GradeBadge';
import { cn } from '../../lib/utils';
import { Pagination } from '../../components/Pagination';
import { Button } from '../../components/ui/button';
import { Input, inputBaseClass } from '../../components/ui/input';
import { PageTitle } from '../../components/ui/page-title';
import { SortHeader } from '../../components/ui/sort-header';
import { TableEmptyRow } from '../../components/ui/table-empty-row';
import { TableSkeletonRows } from '../../components/ui/table-skeleton-rows';
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

/** The archive columns that can be ordered. */
type ArchiveSortField = 'name' | 'material' | 'category' | 'country' | 'grade' | 'risk' | 'updated';

/** Persian-aware ordering, the same collator the other tables use. */
const archiveCollator = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });

/** Risk levels in the order they matter, so "High" sorts above "Low". */
const RISK_ORDER: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

/** Grades in rubric order; an unscored source sorts below every graded one. */
const GRADE_ORDER: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, rejected: 0, 'black list': 0 };

const RISK_LABEL: Record<string, string> = { High: 'بالا', Medium: 'متوسط', Low: 'پایین' };

export function ArchiveView({ db, currentUser, partners = [], materials = [], onSelectVendor, isLoading = false }: {
  db: Vendor[],
  currentUser: User,
  partners?: BusinessPartner[],
  materials?: Material[],
  /** Open a source's own page. The archive could print a row but not open it. */
  onSelectVendor?: (vendor: Vendor) => void,
  /** True while the first load of the source list is still in flight. */
  isLoading?: boolean,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  
  const [printingVendor, setPrintingVendor] = useState<Vendor | null>(null);
  const [printingList, setPrintingList] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [perPage, setPerPage] = useState(20);
  /**
   * The archive is the longest list in the application and was the only one
   * that could not be ordered at all — a register you can only read in insert
   * order is not a register anyone can review.
   */
  const [sortField, setSortField] = useState<ArchiveSortField>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
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
  const sortedDb = useMemo(() => {
    const dir = sortOrder === 'asc' ? 1 : -1;
    const value = (v: Vendor): string | number => {
      switch (sortField) {
        case 'material': return v.material || '';
        case 'category': return categoryLabels[v.category as keyof typeof categoryLabels]?.fa || v.category || '';
        case 'country': return getDisplayCountry(v) || '';
        // Grade and risk are ranked, not alphabetical: "A" above "B" and
        // "High" above "Low" is the order a reviewer means by "sort by risk".
        case 'grade': return GRADE_ORDER[String(v.grade)] ?? -1;
        case 'risk': return RISK_ORDER[String(v.riskAssessment?.riskLevel)] ?? 0;
        case 'updated': return v.updatedAt ? new Date(v.updatedAt).getTime() : 0;
        default: return v.name || '';
      }
    };
    return [...filteredDb].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : archiveCollator.compare(String(av), String(bv));
      // Ties fall back to the company name so the order never shuffles.
      return (cmp || archiveCollator.compare(a.name || '', b.name || '')) * dir;
    });
  }, [filteredDb, sortField, sortOrder]);

  const handleSort = (field: ArchiveSortField) => {
    if (field === sortField) {
      setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('');
    setRiskFilter('');
    setGradeFilter('');
    setStatusFilter('');
    setOnlySelected(false);
    setCurrentPage(1);
  };
  const anyFilterSet = !!(searchTerm || categoryFilter || riskFilter || gradeFilter || statusFilter || onlySelected);

  const ITEMS_PER_PAGE = perPage;
  const totalItems = filteredDb.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedDb = useMemo(() => {
    return sortedDb.slice(startIndex, endIndex);
  }, [sortedDb, startIndex, endIndex]);

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
        {/* The title leads, on the right, the way every other module's header
            reads. It used to be second in the DOM with `order` classes trying
            to place it — but this container is RTL, so `order-1` put the export
            cluster on the right and pushed the title to the left, the opposite
            of what those classes were written for. Source order alone does the
            right thing here: first child right on desktop, first child on top
            when the row stacks.

            `PageTitle` rather than a hand-built heading, for the same reason
            the four repository screens use it: this one was the last `h2`
            standing in as a page title, so a screen reader heard a different
            document outline here than on every other page. */}
        <PageTitle
          eyebrow="Vendor Archive Data"
          eyebrowIcon={Archive}
          title="آرشیو کل تامین‌کنندگان"
          subtitle="لیست جامع تمامی تامین‌کنندگان ارزیابی شده"
        />

        {/* Exports, on the left. */}
        <div className="flex items-center gap-2.5 flex-wrap">
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

      </div>

      {/* Search and filters.

          The search was a bare `<input>` inside a frosted panel — the same
          pattern removed from the supplier module — and the four selects were
          rendered from an array with no labels at all, so they could only be
          told apart by the wording of their default option. Each now says what
          it filters, and the bar reports how much of the archive is showing. */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-xs space-y-3 mb-6">
        <div className="relative">
          <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted-foreground">
            <Search className="w-4 h-4" />
          </span>
          <Input
            type="text"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            placeholder="جستجو در نام شرکت، ماده، کد CAS، IRC، کشور یا شریک تجاری…"
            className="pr-10 pl-10 w-full"
            aria-label="جستجو در آرشیو"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="پاک کردن جستجو"
              className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {([
            {
              key: 'category', label: 'دسته‌بندی', value: categoryFilter, setValue: setCategoryFilter,
              options: [{ val: '', label: 'همهٔ دسته‌ها' }, ...Object.entries(categoryLabels).map(([k, v]) => ({ val: k, label: v.fa }))],
            },
            {
              key: 'risk', label: 'سطح ریسک', value: riskFilter, setValue: setRiskFilter,
              options: [
                { val: '', label: 'همهٔ سطوح' }, { val: 'Low', label: 'پایین (Low)' },
                { val: 'Medium', label: 'متوسط (Medium)' }, { val: 'High', label: 'بالا (High)' },
              ],
            },
            {
              key: 'grade', label: 'گرید کیفی', value: gradeFilter, setValue: setGradeFilter,
              options: [
                { val: '', label: 'همهٔ گریدها' }, { val: 'A', label: 'Grade A' },
                { val: 'B', label: 'Grade B' }, { val: 'C', label: 'Grade C' },
                { val: 'rejected', label: 'مردود / لیست سیاه' },
              ],
            },
            {
              key: 'status', label: 'وضعیت', value: statusFilter, setValue: setStatusFilter,
              options: [
                { val: '', label: 'همهٔ وضعیت‌ها' }, { val: 'approved', label: 'تأییدشده' },
                { val: 'conditional', label: 'مشروط' }, { val: 'new', label: 'جدید / در انتظار' },
                { val: 'rejected', label: 'مردود' },
              ],
            },
          ] as const).map(filter => (
            <label key={filter.key} className="flex flex-col gap-1 min-w-[150px] flex-1 md:flex-none">
              <span className="text-2xs font-bold text-muted-foreground">{filter.label}</span>
              <select
                value={filter.value}
                onChange={e => { filter.setValue(e.target.value); setCurrentPage(1); }}
                className={cn(inputBaseClass, 'w-full md:w-44')}
              >
                {filter.options.map(opt => <option key={opt.val} value={opt.val}>{opt.label}</option>)}
              </select>
            </label>
          ))}

          {/* A star invites the question "which ones are chosen?", so the answer
              is one click away rather than a scroll through every page. Hidden
              when nothing has been chosen yet, so it never offers an empty
              result. */}
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => { setOnlySelected(v => !v); setCurrentPage(1); }}
              aria-pressed={onlySelected}
              title="نمایش فقط سورس‌هایی که به‌عنوان منتخب ثبت شده‌اند"
              className={`shrink-0 flex items-center gap-1.5 text-xs font-bold rounded-xl py-2 px-3 border transition-colors cursor-pointer ${
                onlySelected
                  ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800'
                  : 'bg-card text-muted-foreground border-border hover:bg-accent'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${onlySelected ? 'fill-current' : ''}`} />
              <span>فقط منتخب‌ها ({selectedCount.toLocaleString('fa-IR')})</span>
            </button>
          )}

          {anyFilterSet && (
            <div className="flex items-center gap-2 pb-0.5">
              <Button type="button" variant="outline" size="sm" onClick={clearFilters} className="font-bold">
                حذف فیلترها
              </Button>
              <span className="text-2xs text-muted-foreground">
                {totalItems.toLocaleString('fa-IR')} از {db.length.toLocaleString('fa-IR')} رکورد
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ARCHIVE TABLE

          A real `<table>`, not a grid of `div`s. The rows carried the whole
          register in `grid-cols-12` divs, so a screen reader heard a pile of
          text with no column names, nothing could be sorted, and the empty and
          loading states were hand-built copies of the shared ones.

          Grade and risk get columns of their own: both were filterable and
          neither was displayed, so choosing "Grade A" gave a list nobody could
          check by eye. */}
      <div className="rounded-2xl overflow-hidden border border-border shadow-xs bg-card mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-right" aria-busy={isLoading}>
            <caption className="sr-only">آرشیو کامل سورس‌ها با امکان مرتب‌سازی بر اساس هر ستون</caption>
            <thead>
              <tr className="bg-muted text-muted-foreground border-b border-border text-xs">
                <SortHeader field="name" label="تأمین‌کننده" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="material" label="ماده" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="grade" label="گرید" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} center className="hidden md:table-cell" />
                <SortHeader field="risk" label="ریسک" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} center className="hidden md:table-cell" />
                <SortHeader field="category" label="دسته" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="hidden sm:table-cell" />
                <SortHeader field="country" label="کشور" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="hidden sm:table-cell" />
                <SortHeader field="updated" label="آخرین تغییر" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="hidden lg:table-cell" />
                <th scope="col" className="py-3 px-4 text-xs font-bold text-center w-24">اقدام</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {isLoading ? (
                <TableSkeletonRows
                  rows={8}
                  columns={8}
                  barClassName="h-3"
                  rowClassName="border-b border-border/60 last:border-0"
                  width={(c, i) => (c === 7 ? '4rem' : `${55 + ((i + c) % 3) * 15}%`)}
                />
              ) : sortedDb.length === 0 ? (
                anyFilterSet ? (
                  <TableEmptyRow
                    colSpan={8}
                    icon={Search}
                    message="هیچ رکوردی با این فیلترها پیدا نشد."
                    action={
                      <Button type="button" variant="outline" size="sm" onClick={clearFilters} className="font-bold">
                        حذف فیلترها
                      </Button>
                    }
                    note="جستجو نام شرکت، ماده، کد CAS، IRC، کشور و شریک تجاری را می‌گردد."
                  />
                ) : (
                  <TableEmptyRow
                    colSpan={8}
                    icon={Archive}
                    message="آرشیو خالی است."
                    note="با ثبت اولین سورس، رکورد آن همین‌جا بایگانی می‌شود."
                  />
                )
              ) : paginatedDb.map(v => {
                const chosen = selectionForVendor(v, selections);
                const risk = v.riskAssessment?.riskLevel;
                return (
                  <tr key={v.id} className="hover:bg-accent transition-colors">
                    <td className="py-3 px-4 min-w-0">
                      {/* The star marks the row, not the company: a supplier can
                          be the chosen source for one material and not for
                          another, so the mark belongs to this vendor+material
                          pair. The title carries the reason and who signed for
                          it, because a bare star only raises the question
                          "chosen for what, by whom?". */}
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
                      {/* Imported rows carry a literal "Unknown"/"N/A" as the
                          Latin name; printed under the company it read like the
                          company's actual English name. Nothing is clearer than
                          a wrong name. */}
                      {cleanPlaceholder(v.nameEn) && (
                        <EntityName as="div" name={v.nameEn} lines={1} dir="ltr" className="text-muted-foreground text-xs mt-0.5" />
                      )}
                    </td>
                    <td className="py-3 px-4 min-w-0">
                      <EntityName as="div" name={v.material} lines={2} className="text-muted-foreground text-sm" />
                      <div className="font-mono text-muted-foreground text-xs truncate mt-0.5">{v.cas || 'N/A'}</div>
                    </td>
                    <td className="py-3 px-4 text-center hidden md:table-cell">
                      <GradeBadge grade={v.grade} status={v.status} scores={v.scores} />
                    </td>
                    <td className="py-3 px-4 text-center hidden md:table-cell">
                      {/* "Not assessed" is a finding of its own — the risk
                          backlog on the dashboard counts exactly these — so it
                          is named rather than left blank. */}
                      {risk ? (
                        <span className={`text-2xs font-bold px-2 py-0.5 rounded-md border ${
                          risk === 'High'
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900'
                            : risk === 'Medium'
                            ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                        }`}>
                          {RISK_LABEL[risk] || risk}
                        </span>
                      ) : (
                        <span className="text-2xs text-muted-foreground">ارزیابی نشده</span>
                      )}
                    </td>
                    <td className="py-3 px-4 min-w-0 hidden sm:table-cell">
                      <span className="bg-muted border border-border text-xs text-muted-foreground rounded px-2 py-0.5 inline-block truncate max-w-full font-medium">
                        {v.isSample
                          ? (v.status === 'rejected' ? 'نمونه تایید نشده' : 'نمونه تایید شده')
                          : (categoryLabels[v.category as keyof typeof categoryLabels]?.fa || v.category)
                        }
                      </span>
                    </td>
                    <td className="py-3 px-4 min-w-0 hidden sm:table-cell text-muted-foreground text-sm truncate">
                      {getDisplayCountry(v).split(' ')[0]}
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell text-muted-foreground">
                      {v.updatedAt ? (
                        <span className="font-mono text-2xs" title={new Date(v.updatedAt).toLocaleString('fa-IR')}>
                          {new Date(v.updatedAt).toLocaleDateString('fa-IR')}
                        </span>
                      ) : (
                        <span className="text-2xs text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1">
                        {/* The archive could print a record but not open it:
                            seeing the detail meant finding the same source again
                            through its category. */}
                        {onSelectVendor && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onSelectVendor(v)}
                            className="text-muted-foreground hover:text-primary border border-transparent hover:border-border"
                            title={`باز کردن پروندهٔ «${v.name}»`}
                          >
                            <ExternalLink />
                          </Button>
                        )}
                        {/* Printing follows `vendor.read`, the permission that
                            already lets someone open this page and export the
                            whole archive to Excel. Gating it on
                            `role === 'admin'` protected nothing — the same data
                            left the building through the export button next to
                            it — while making QA ask an admin to print a form
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
