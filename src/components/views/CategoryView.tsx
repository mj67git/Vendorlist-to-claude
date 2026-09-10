import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, Download, Search, X } from 'lucide-react';
import { Pagination } from '../../components/Pagination';
import { PerPageSelect } from '../ui/per-page-select';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input, inputBaseClass } from '../../components/ui/input';
import { categoryLabels, categoryRank } from '../../constants/categories';
import { BusinessPartner, Category, Material, User, Vendor } from '../../types';
import { useExcelExport } from '../../hooks/useExcelExport';
import { adminRejectionReason, hasQcReject, isInCategoryRegister, isVendorRejected } from '../../utils/vendorState';
import { describeVendorRank } from '../../utils/vendorRank';
import { describeSampleStatus, isUntestedSample } from '../../utils/sampleStatus';
import { checkLicenseExpiry, getDisplayCountry } from '../../utils/vendorUtils';
import { MaterialGroup } from './MaterialGroup';
import type { SourceSelectionRecord } from './MaterialsComparisonSection';
import { FormModal } from '../../components/FormModal';
import { authFetch, isLocalMode } from '../../services/authFetch';
import { can } from '../../utils/permissions';
import { cn } from '../../lib/utils';
import { Textarea } from '../ui/textarea';

// extracted from App.tsx

export function CategoryView({ 
  db, 
  isLoading = false,
  categoryId, 
  onSelectVendor, 
  currentUser,
  expandedMaterial,
  onToggleMaterial,
  materials,
  onAddMaterial,
  partners = []
}: { 
  db: Vendor[], 
  isLoading?: boolean,
  categoryId: Category, 
  onSelectVendor: any, 
  currentUser: User,
  expandedMaterial: string | null,
  onToggleMaterial: (mat: string | null) => void,
  materials: Material[],
  onAddMaterial: (m: Material) => void,
  partners?: BusinessPartner[]
}) {
  const excel = useExcelExport();
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  /** Groups per page. Same control and same sizes as every other paged module. */
  const [perPage, setPerPage] = useState(20);
  const [sortBy, setSortBy] = useState<'material' | 'count' | 'grade' | 'expiry' | 'sampleStatus' | 'rejectedAt' | 'route' | 'lowestScore' | 'newest' | 'waiting' | 'origin'>('material');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  /**
   * Which category a blacklisted source came from.
   *
   * The blacklist is the one register that mixes them: every other page holds a
   * single category by definition, but this one gathers whatever was
   * disqualified, from «دامی» to «خرید خارجی». Its own dropdown rather than one
   * of the chips beside it, because the chips are one exclusive control over a
   * different question — how the source got here — and «رد صریح در دستهٔ دامی»
   * has to be askable.
   */
  const [originFilter, setOriginFilter] = useState<string>('');

  // ---- recorded source selections -----------------------------------------
  // Which source is actually bought for each material. The comparison panel
  // only ever recommended; this is the decision someone made and signed for.
  // The decision has its own permission: editing a source keeps a record
  // accurate, choosing one says what the company buys. See permissions.ts.
  const canChoose = can(currentUser, 'vendor.select');
  const [selections, setSelections] = useState<SourceSelectionRecord[]>([]);
  const [selectDialog, setSelectDialog] = useState<{ materialKey: string; materialFa: string; vendors: Vendor[]; vendorId: string } | null>(null);
  const [selectReason, setSelectReason] = useState('');
  const [selectError, setSelectError] = useState<string | null>(null);
  const [selectSaving, setSelectSaving] = useState(false);

  const loadSelections = React.useCallback(() => {
    if (isLocalMode()) return;
    authFetch('/api/source-selections')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (Array.isArray(data)) setSelections(data); })
      .catch(() => { /* the panel simply shows no recorded choice */ });
  }, []);
  useEffect(() => { loadSelections(); }, [loadSelections]);

  const openSelectionDialog = (group: { fa: string; en: string; vendors: Vendor[] }, vendorId: string) => {
    const existing = selections.find(x => x.materialKey === group.en && x.category === categoryId);
    setSelectDialog({ materialKey: group.en, materialFa: group.fa, vendors: group.vendors, vendorId });
    setSelectReason(existing?.reason || '');
    setSelectError(null);
  };

  const submitSelection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectDialog) return;
    const reason = selectReason.trim();
    if (reason.length < 10) {
      setSelectError('ثبت دلیل انتخاب الزامی است و باید حداقل ۱۰ کاراکتر باشد.');
      return;
    }
    setSelectSaving(true);
    setSelectError(null);
    // The decision on record when this dialog was opened. The server refuses
    // with 409 if somebody else has recorded a different one since, so two
    // people cannot each believe theirs is the choice on file.
    const held = selections.find(x => x.materialKey === selectDialog.materialKey && x.category === categoryId);
    authFetch('/api/source-selections', {
      method: 'PUT',
      body: JSON.stringify({
        materialKey: selectDialog.materialKey,
        category: categoryId,
        vendorId: selectDialog.vendorId,
        reason,
        expectedUpdatedAt: held?.updatedAt ?? null,
      }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // A refusal because the record moved is not a failed save to retry
          // blindly: re-read, so the reason box shows what is actually on file.
          if (res.status === 409) loadSelections();
          throw new Error(data.error || 'ثبت انتخاب ناموفق بود.');
        }
        setSelectDialog(null);
        loadSelections();
      })
      .catch(err => setSelectError(err.message))
      .finally(() => setSelectSaving(false));
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [query, sortBy, activeFilter, originFilter, perPage]);

  /*
   * A sort that this category does not offer falls back to the name.
   *
   * The options differ between the sample list and the others, so arriving here
   * with «بهترین گرید» still selected would leave the control showing nothing
   * while the list stayed ordered by a rule the reader cannot see.
   */
  // `null` so the first render counts as an arrival too — otherwise a link
  // opened straight into the blacklist would keep the alphabetical default.
  const lastCategoryRef = useRef<Category | null>(null);
  useEffect(() => {
    const allowed = categoryId === 'sample'
      ? ['material', 'count', 'sampleStatus', 'newest', 'waiting']
      : categoryId === 'blacklist'
        // «Best grade» and «soonest licence expiry» are not questions this list
        // answers: every row here is disqualified, so the grade ranking gives
        // them all the same score and the sort visibly does nothing, and the
        // licence of a source nobody may buy from is not what a reviewer looks
        // at — the chip for it is already hidden here, and the sort option was
        // simply left behind.
        ? ['material', 'count', 'rejectedAt', 'route', 'lowestScore', 'origin']
        : ['material', 'count', 'grade', 'expiry'];
    // The blacklist opens on what happened most recently, not on the alphabet:
    // this register is read to see what has just left the supply chain. Applied
    // on arrival only — once the reader picks an order it is theirs to keep.
    const arrived = lastCategoryRef.current !== categoryId;
    lastCategoryRef.current = categoryId;
    const fallback = categoryId === 'blacklist' ? 'rejectedAt' : 'material';
    if (!allowed.includes(sortBy) || arrived) setSortBy(fallback as typeof sortBy);
    // The origin filter only means anything on the blacklist, and a value left
    // behind on arrival would silently hide rows on a page with no control to
    // clear it.
    if (arrived) setOriginFilter('');
  }, [categoryId, sortBy]);

  const meta = categoryLabels[categoryId];
  
  const categoryVendors = useMemo(
    () => db.filter(v => isInCategoryRegister(v, categoryId)),
    [db, categoryId],
  );
  
  /** The four sample verdicts, counted once and from the one helper. */
  const sampleCounts = useMemo(() => {
    const c = { approved: 0, conditional: 0, rejected: 0, untested: 0 };
    if (categoryId !== 'sample') return c;
    for (const v of categoryVendors) {
      const d = describeSampleStatus(v);
      if (!d.decided) c.untested++;
      else if (d.label === 'Approved') c.approved++;
      else if (d.label === 'Conditional') c.conditional++;
      else c.rejected++;
    }
    return c;
  }, [categoryVendors, categoryId]);

  const filteredVendors = useMemo(() => {
    const qt = query.toLowerCase();
    return categoryVendors.filter(v => 
      v.name.toLowerCase().includes(qt) || 
      v.nameEn.toLowerCase().includes(qt) || 
      v.material.toLowerCase().includes(qt) || 
      v.materialEn.toLowerCase().includes(qt) ||
      v.cas.toLowerCase().includes(qt) ||
      (v.irc && v.irc.toLowerCase().includes(qt)) ||
      (v.country && getDisplayCountry(v).toLowerCase().includes(qt)) ||
      /*
       * The recorded reasons are searchable too. On the blacklist that is the
       * one column a reader actually wants to look through — «چرا این سورس رد
       * شد» — and it was the only text on the row that the search could not
       * reach.
       */
      (Array.isArray(v.rejectionReasons) && v.rejectionReasons.some(
        (r: any) => typeof r === 'string' && r.toLowerCase().includes(qt)))
    );
  }, [categoryVendors, query]);

  // Apply the quick status/grade filter (toggled from the stat chips) before grouping.
  const matchesFilter = (v: Vendor): boolean => {
    if (!activeFilter) return true;
    switch (activeFilter) {
      // Through the shared helper, so the chip and the badge agree about one
      // record: `isVendorRejected` wins over a stale `status` of «approved».
      case 'approved': return describeSampleStatus(v).label === 'Approved';
      case 'conditional': return describeSampleStatus(v).label === 'Conditional';
      // «آزمایش نشده» is a real population now, not an empty edge case: a sample
      // enters the category with no verdict and waits for one.
      case 'untested': return isUntestedSample(v);
      case 'rejected': return isVendorRejected(v);
      // How a source reached the blacklist: a person's decision, with the
      // reason they typed, or its own score. The two ask for different things —
      // one is reviewable by talking to whoever signed it, the other by
      // re-scoring — so the list has to be able to separate them.
      case 'manual': return !!adminRejectionReason(v);
      case 'derived': return !adminRejectionReason(v);
      case 'qc': return hasQcReject(v);
      case 'A': return v.grade === 'A';
      case 'B': return v.grade === 'B';
      case 'C': return v.grade === 'C';
      case 'expiring': {
        if (!v.ircExpiryDate) return false;
        const c = checkLicenseExpiry(v.ircExpiryDate);
        return c.status === 'expired' || c.status === 'expiring_soon';
      }
      default: return true;
    }
  };

  /**
   * The categories actually represented on this blacklist, with their counts.
   *
   * Built from the register rather than from `categoryLabels`, so the dropdown
   * never offers «اقلام بسته‌بندی» on a list that holds none — an option that
   * can only produce an empty page is a dead end, and the count beside each one
   * says how many rows to expect before the reader commits to the click.
   * `categoryLabels` still decides the order and the wording.
   */
  const originOptions = useMemo(() => {
    if (categoryId !== 'blacklist') return [];
    const counts = new Map<string, number>();
    for (const v of categoryVendors) {
      const key = (v.category || '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return (Object.keys(categoryLabels) as Category[])
      .filter(id => counts.has(id))
      .map(id => ({ id, label: categoryLabels[id].fa, count: counts.get(id) as number }));
  }, [categoryVendors, categoryId]);

  const displayVendors = useMemo(
    () => filteredVendors
      .filter(matchesFilter)
      // A second, independent dimension: the chips say why a source is here,
      // this says where it came from, and the two combine rather than replace
      // each other.
      .filter(v => !originFilter || v.category === originFilter),
    [filteredVendors, activeFilter, originFilter]
  );

  // Group by material
  const grouped = useMemo(() => {
    const groups: Record<string, { fa: string, en: string, cas: string, vendors: Vendor[] }> = {};
    displayVendors.forEach(v => {
      const key = v.materialEn;
      if (!groups[key]) {
        groups[key] = { fa: v.material, en: v.materialEn, cas: v.cas, vendors: [] };
      }
      groups[key].vendors.push(v);
    });
    return groups;
  }, [displayVendors]);

  // Sort the material groups by the selected criterion.
  const gradeRank = (v: Vendor): number => {
    if (v.grade === 'A') return 4;
    if (v.grade === 'B') return 3;
    if (v.grade === 'C') return 2;
    if (v.status === 'approved') return 2;
    return 1;
  };
  const soonestExpiry = (vendors: Vendor[]): number => {
    let min = Infinity;
    vendors.forEach(v => {
      if (v.ircExpiryDate) {
        const c = checkLicenseExpiry(v.ircExpiryDate);
        if (typeof c.daysLeft === 'number') min = Math.min(min, c.daysLeft);
      }
    });
    return min;
  };
  const groupsList = useMemo(() => {
    const list = Object.values(grouped) as { fa: string, en: string, cas: string, vendors: Vendor[] }[];
    const sorted = [...list];
    if (sortBy === 'material') {
      sorted.sort((a, b) => a.fa.localeCompare(b.fa, 'fa'));
    } else if (sortBy === 'count') {
      sorted.sort((a, b) => b.vendors.length - a.vendors.length);
    } else if (sortBy === 'grade') {
      sorted.sort((a, b) => Math.max(...b.vendors.map(gradeRank)) - Math.max(...a.vendors.map(gradeRank)));
    } else if (sortBy === 'sampleStatus') {
      // Undecided first: those are the samples somebody still has to rule on.
      const rank = (v: Vendor) => (isUntestedSample(v) ? 0 : isVendorRejected(v) ? 1 : v.status === 'conditional' ? 2 : 3);
      sorted.sort((a, b) => Math.min(...a.vendors.map(rank)) - Math.min(...b.vendors.map(rank)));
    } else if (sortBy === 'expiry') {
      sorted.sort((a, b) => soonestExpiry(a.vendors) - soonestExpiry(b.vendors));
    } else if (sortBy === 'newest') {
      // A sample list is a queue; «what arrived last» is a question it is asked.
      const changedAt = (v: Vendor) => (v.updatedAt ? new Date(v.updatedAt).getTime() : 0);
      sorted.sort((a, b) => Math.max(...b.vendors.map(changedAt)) - Math.max(...a.vendors.map(changedAt)));
    } else if (sortBy === 'waiting') {
      /*
       * The sample that has waited longest for a verdict, first.
       *
       * Only undecided samples have waited for anything, so a group with none
       * sorts to the end rather than competing on a date that means something
       * else. Among those waiting, the oldest record leads.
       */
      const waitingSince = (vs: Vendor[]) => {
        const undecided = vs.filter(isUntestedSample)
          .map(v => (v.updatedAt ? new Date(v.updatedAt).getTime() : 0));
        return undecided.length ? Math.min(...undecided) : Infinity;
      };
      sorted.sort((a, b) => waitingSince(a.vendors) - waitingSince(b.vendors));
    } else if (sortBy === 'rejectedAt') {
      /*
       * Newest first, keyed on the record's own timestamp rather than the date
       * written into the rejection log: that log line carries a Persian string
       * in one record and an ISO one in the next, so comparing them would order
       * by which convention happened to be used. For a blacklisted source the
       * last change *is* the rejection in all but the rarest case.
       */
      const changedAt = (v: Vendor) => (v.updatedAt ? new Date(v.updatedAt).getTime() : 0);
      const newest = (vs: Vendor[]) => Math.max(...vs.map(changedAt));
      sorted.sort((a, b) => newest(b.vendors) - newest(a.vendors));
    } else if (sortBy === 'route') {
      // A person's decision first, then the ones the score disqualified: the
      // two are reviewed by different people in different ways.
      const manualFirst = (vs: Vendor[]) => (vs.some(v => !!adminRejectionReason(v)) ? 0 : 1);
      sorted.sort((a, b) => manualFirst(a.vendors) - manualFirst(b.vendors));
    } else if (sortBy === 'origin') {
      /*
       * By the category the sources came from, so the blacklist can be read one
       * supply route at a time.
       *
       * The rows are grouped by material and a material can be bought through
       * more than one route, so a group is placed by the first category it
       * holds in the order the sidebar lists them — the same order the dropdown
       * offers. A mixed group therefore appears once, under its earliest
       * category, rather than being split or sorted by a value half its rows do
       * not have. Material name breaks the tie so the order inside one category
       * is still alphabetical and does not shuffle between renders.
       */
      const groupRank = (vs: Vendor[]) => Math.min(...vs.map(v => categoryRank(v.category)));
      sorted.sort((a, b) =>
        groupRank(a.vendors) - groupRank(b.vendors) || a.fa.localeCompare(b.fa, 'fa'));
    } else if (sortBy === 'lowestScore') {
      // Worst first. A source with no score at all is not a zero — it goes to
      // the end rather than pretending to be the worst of them.
      const worst = (vs: Vendor[]) => {
        const scores = vs.map(v => describeVendorRank(v).score).filter((n): n is number => n !== null);
        return scores.length ? Math.min(...scores) : Infinity;
      };
      sorted.sort((a, b) => worst(a.vendors) - worst(b.vendors));
    }
    return sorted;
  }, [grouped, sortBy]);

  const ITEMS_PER_PAGE = perPage;
  const totalItems = groupsList.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedGroups = useMemo(() => {
    return groupsList.slice(startIndex, endIndex);
  }, [groupsList, startIndex, endIndex]);

  // Guard against landing on an out-of-range page after the result set shrinks
  // (e.g. a filter reduces the number of groups below the current page).
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  return (
    <div className="space-y-6 fade-in">
      {/* Sticky Category Top Header & Toolbar */}
      {/* The title and the toolbar were two stacked sticky rows, so a fifth of a
          short viewport was permanently spent on controls set once. One row on
          desktop; the filter chips keep their own line because they wrap. */}
      <div className="sticky top-0 z-20 bg-muted/95 backdrop-blur-md -mt-4 sm:-mt-8 -mx-4 sm:-mx-8 px-4 sm:px-8 pt-3 sm:pt-4 pb-3 border-b border-border shadow-xs space-y-3">
        {/* `flex-wrap`, because the blacklist carries one control more than the
            other registers: with four items pinned to a single row the sort
            select was squeezed past the edge of the page and showed a chevron
            over an empty box. They wrap to a second line instead. */}
        <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-3 lg:gap-4">
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2 shrink-0">
            <meta.icon className="w-6 h-6 text-primary" />
            {meta.fa}
          </h2>

          <div className="flex items-center gap-2 lg:mr-auto shrink-0 order-last lg:order-none">
            {/* Taking the category out as a file is `data.export`; reading it
                on screen is `vendor.read`. */}
            {can(currentUser, 'data.export') && (
            <Button 
              type="button" 
              onClick={() => excel.run(
                xl => xl.exportCategoryToExcel(db, categoryId, meta.fa, partners, materials, selections),
                { label: `دستهٔ ${meta.fa}`, rows: db.length },
              )}
              disabled={excel.busy}
              className="flex items-center gap-2 text-xs font-bold shadow-xs cursor-pointer active:scale-95"
              title={`دانلود خروجی اکسل دسته‌بندی ${meta.fa}`}
            >
              <Download className="w-4 h-4" />
              <span>{excel.busy ? 'در حال آماده‌سازی…' : 'خروجی اکسل'}</span>
            </Button>
            )}
            {excel.error && (
              <p className="text-xs text-rose-600 dark:text-rose-400 max-w-xs">{excel.error}</p>
            )}
          </div>

          <div className="relative w-full lg:w-80 shrink-0">
            <Input 
              type="text" 
              placeholder={categoryId === 'blacklist'
                ? "جستجو در نام، ماده، CAS، کشور یا دلیل رد…"
                : "جستجو کلمه کلیدی، نام، ماده، CAS، کشور..."}
              className="pl-9 pr-9 text-sm bg-background"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
             
            />
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-accent cursor-pointer"
                title="پاک کردن جستجو"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Origin filter — the blacklist only, because it is the only page
              that holds more than one category. Its own control beside the sort
              rather than a chip: the chips are one exclusive choice about why a
              source was disqualified, and a reader wants both questions at once. */}
          {categoryId === 'blacklist' && originOptions.length > 1 && (
            <div className="flex items-center gap-2 w-full lg:w-auto shrink-0">
              <label htmlFor="blacklist-origin" className="text-2xs text-muted-foreground whitespace-nowrap">
                دستهٔ مبدأ
              </label>
              <select
                id="blacklist-origin"
                value={originFilter}
                onChange={(e) => setOriginFilter(e.target.value)}
                className={cn(inputBaseClass, 'w-full lg:w-44 cursor-pointer text-xs')}
                title="فیلتر بر اساس دسته‌بندی‌ای که سورس پیش از رد شدن در آن ثبت شده بود"
              >
                <option value="">همهٔ دسته‌بندی‌ها</option>
                {originOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.label} ({o.count})</option>
                ))}
              </select>
            </div>
          )}

          {/* Sort control */}
          <div className="flex items-center gap-2 w-full lg:w-auto shrink-0">
            <label htmlFor="category-sort" className="text-2xs text-muted-foreground whitespace-nowrap">
              مرتب‌سازی
            </label>
            <select
              id="category-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className={cn(inputBaseClass, 'w-full lg:w-52 cursor-pointer text-xs')}
              title={categoryId === 'blacklist'
                ? "مرتب‌سازی گروه‌های ماده — «تازه‌ترین رد» بر اساس آخرین تغییر رکورد است"
                : "مرتب‌سازی گروه‌های ماده"}
            >
              <option value="material">نام ماده (الفبا)</option>
              <option value="count">تعداد سورس (بیشترین)</option>
              {/* A sample has no grade and no licence of its own, so ordering by
                  either ran over a column of empty values. What a reader of this
                  page actually sorts by is which samples still need a verdict. */}
              {categoryId === 'sample' ? (
                <>
                  <option value="sampleStatus">وضعیت نمونه (آزمایش‌نشده اول)</option>
                  <option value="waiting">بیشترین انتظار برای نتیجه</option>
                  <option value="newest">تازه‌ترین نمونه</option>
                </>
              ) : categoryId === 'blacklist' ? (
                <>
                  <option value="rejectedAt">تازه‌ترین رد</option>
                  <option value="origin">دستهٔ مبدأ</option>
                  <option value="route">نحوهٔ ورود (رد صریح اول)</option>
                  <option value="lowestScore">کمترین امتیاز اول</option>
                </>
              ) : (
                <>
                  <option value="grade">بهترین گرید</option>
                  <option value="expiry">نزدیک‌ترین انقضای مجوز</option>
                </>
              )}
            </select>
          </div>

        </div>

        {/* Stats double as quick filters (click to toggle) */}
        {(() => {
            /**
             * A chip whose count is zero stays visible (the reader still wants to
             * know the answer is none) but stops looking clickable: as a live
             * filter it could only ever produce an empty list.
             */
            const chipCls = (key: string | null, count?: number) =>
              `px-2.5 py-1 text-xs select-none transition-shadow ${
                count === 0
                  ? 'opacity-45 cursor-default pointer-events-none'
                  : activeFilter === key
                    ? 'cursor-pointer ring-2 ring-primary ring-offset-1 ring-offset-background'
                    : 'cursor-pointer opacity-95 hover:opacity-100'
              }`;
            const toggle = (key: string) => setActiveFilter(activeFilter === key ? null : key);
            const expiringCount = categoryVendors.filter(v => {
              if (!v.ircExpiryDate) return false;
              const c = checkLicenseExpiry(v.ircExpiryDate);
              return c.status === 'expired' || c.status === 'expiring_soon';
            }).length;
            return (
              <div className="flex flex-wrap gap-2 w-full items-center">
                <Badge variant="outline" onClick={() => setActiveFilter(null)}
                  className={`px-3 py-1 text-xs cursor-pointer select-none ${activeFilter === null ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
                  title="نمایش همه">
                  کل سورس‌ها: <span className="font-bold font-mono mr-1 text-primary">{categoryVendors.length}</span>
                </Badge>
                {categoryId === 'sample' ? (
                  <>
                    {/* Counted through `describeSampleStatus`, the same helper
                        the badge on the row uses. They used to read `status`
                        directly, so a sample carrying a rejection reason while
                        its status still said approved was shown as «Reject» on
                        its row and counted under «تأیید شده» here — one record
                        in two places, and four chips that no longer added up to
                        the total. */}
                    <Badge variant="gradeA" onClick={() => toggle('approved')} className={chipCls('approved', sampleCounts.approved)}>
                      تأیید شده: <span className="font-bold font-mono mr-1">{sampleCounts.approved}</span>
                    </Badge>
                    <Badge variant="gradeC" onClick={() => toggle('conditional')} className={chipCls('conditional', sampleCounts.conditional)}>
                      تأیید مشروط: <span className="font-bold font-mono mr-1">{sampleCounts.conditional}</span>
                    </Badge>
                    <Badge variant="gradeReject" onClick={() => toggle('rejected')} className={chipCls('rejected', sampleCounts.rejected)}>
                      مردود: <span className="font-bold font-mono mr-1">{sampleCounts.rejected}</span>
                    </Badge>
                    {/* Without this chip the three above no longer add up to the
                        total, and the samples waiting on a decision — the ones
                        somebody actually has to act on — are the ones you cannot
                        filter for. */}
                    <Badge variant="outline" onClick={() => toggle('untested')} className={chipCls('untested', sampleCounts.untested)}>
                      آزمایش نشده: <span className="font-bold font-mono mr-1">{sampleCounts.untested}</span>
                    </Badge>
                  </>
                ) : categoryId === 'blacklist' ? (
                  <>
                    {/* The blacklist had no chips at all, so the only question a
                        reader could ask of it was «which one is this», never
                        «why is it here». */}
                    <Badge variant="gradeReject" onClick={() => toggle('manual')} className={chipCls('manual', categoryVendors.filter(v => !!adminRejectionReason(v)).length)}
                      title="سورس‌هایی که با تصمیم صریح کاربر و با ذکر دلیل به لیست سیاه رفته‌اند">
                      رد صریح کاربر: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => !!adminRejectionReason(v)).length}</span>
                    </Badge>
                    <Badge variant="warning" onClick={() => toggle('derived')} className={chipCls('derived', categoryVendors.filter(v => !adminRejectionReason(v)).length)}
                      title="سورس‌هایی که بدون تصمیم جداگانه و صرفاً از روی امتیاز ارزیابی به لیست سیاه رفته‌اند">
                      امتیاز پایین: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => !adminRejectionReason(v)).length}</span>
                    </Badge>
                    {/* Only when there is one: a QC rejection is a fact about
                        the laboratory record, not a route into the blacklist for
                        a source, so on most registers this is zero. */}
                    {categoryVendors.some(hasQcReject) && (
                      <Badge variant="outline" onClick={() => toggle('qc')} className={chipCls('qc', categoryVendors.filter(hasQcReject).length)}
                        title="سورس‌هایی که دست‌کم یک نتیجهٔ آزمایشگاهی مردود دارند">
                        مردود در آزمون QC: <span className="font-bold font-mono mr-1">{categoryVendors.filter(hasQcReject).length}</span>
                      </Badge>
                    )}
                  </>
                ) : (
                  <>
                    <Badge variant="gradeA" onClick={() => toggle('A')} className={chipCls('A', categoryVendors.filter(v => v.grade === 'A').length)}>
                      Grade A: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.grade === 'A').length}</span>
                    </Badge>
                    <Badge variant="gradeB" onClick={() => toggle('B')} className={chipCls('B', categoryVendors.filter(v => v.grade === 'B').length)}>
                      Grade B: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.grade === 'B').length}</span>
                    </Badge>
                    <Badge variant="gradeC" onClick={() => toggle('C')} className={chipCls('C', categoryVendors.filter(v => v.grade === 'C').length)}>
                      Grade C: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.grade === 'C').length}</span>
                    </Badge>
                    <Badge variant="gradeReject" onClick={() => toggle('rejected')} className={chipCls('rejected', categoryVendors.filter(isVendorRejected).length)}>
                      لیست سیاه: <span className="font-bold font-mono mr-1">{categoryVendors.filter(isVendorRejected).length}</span>
                    </Badge>
                  </>
                )}
                {/* A sample carries no licence of its own, which is why the
                    matching sort option was removed for this category; the chip
                    had simply been left behind. */}
                {categoryId !== 'blacklist' && categoryId !== 'sample' && expiringCount > 0 && (
                  <Badge variant="warning" onClick={() => toggle('expiring')} className={chipCls('expiring')} title="فیلتر سورس‌های با مجوز رو به انقضا یا منقضی">
                    <AlertTriangle className="w-3.5 h-3.5 ml-1 shrink-0" /> نزدیک انقضا: <span className="font-bold font-mono mr-1">{expiringCount}</span>
                  </Badge>
                )}
              </div>
            );
        })()}
      </div>

      <div className="space-y-6 mt-8">
        {/* Until the data arrives there is nothing to group, and the empty state
            below would tell the user there is nothing here at all. Skeletons
            shaped like the collapsed group card instead. */}
        {isLoading && (
          <div aria-busy="true" aria-label="در حال بارگذاری سورس‌ها" className="space-y-6">
            {[0, 1, 2].map(i => (
              <div key={i} className="bg-card border border-border rounded-2xl px-5 py-3.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 w-full">
                  <div className="w-5 h-5 rounded bg-muted animate-pulse shrink-0" />
                  <div className="h-4 rounded bg-muted animate-pulse" style={{ width: `${38 - i * 6}%` }} />
                  <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                </div>
                <div className="h-4 w-20 rounded bg-muted animate-pulse shrink-0" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && paginatedGroups.map(group => (
          <MaterialGroup 
            key={group.en} 
            group={group} 
            onSelectVendor={onSelectVendor} 
            currentUser={currentUser} 
            categoryId={categoryId} 
            expandedMaterial={expandedMaterial}
            onToggleMaterial={onToggleMaterial}
            partners={partners}
            selection={selections.find(x => x.materialKey === group.en && x.category === categoryId) || null}
            onSelectSource={canChoose ? (vendorId) => openSelectionDialog(group, vendorId) : undefined}
          />
        ))}
        {!isLoading && groupsList.length === 0 && (
          <div className="text-center py-16 px-4 bg-card rounded-2xl border border-border">
            <Archive className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="text-foreground font-semibold text-lg">نتیجه‌ای یافت نشد</h4>
            {(query || activeFilter || originFilter) && (
              <div className="mt-3">
                <p className="text-sm text-muted-foreground">با فیلتر یا جست‌وجوی فعلی موردی پیدا نشد.</p>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => { setQuery(''); setActiveFilter(null); setOriginFilter(''); }}
                  className="mt-3"
                >
                  پاک کردن فیلترها
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <PerPageSelect value={perPage} onChange={n => setPerPage(n)} />
          <div className="flex-1 min-w-0">
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

      {/* Record which source is bought for a material. Rendered unconditionally
          so the exit animation is seen; children guarded because they are
          evaluated while closed. */}
      <FormModal open={!!selectDialog} onClose={() => setSelectDialog(null)} size="md" labelledBy="select-source-title">
        {selectDialog && (
          <form onSubmit={submitSelection}>
            <div className="px-6 py-4 border-b border-border bg-muted/50">
              <h3 id="select-source-title" className="text-sm font-black text-foreground">
                ثبت سورس منتخب برای «{selectDialog.materialFa}»
              </h3>
              <p className="text-2xs text-muted-foreground mt-0.5">
                این تصمیم با نام شما و دلیل آن در ردیابی تغییرات (Audit) ثبت می‌شود.
              </p>
            </div>

            <div className="p-6 space-y-4">
              {selectError && (
                <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl px-3.5 py-2.5 text-xs font-semibold">
                  <X className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{selectError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="select-vendor" className="block text-xs font-bold text-foreground">تأمین‌کنندهٔ منتخب</label>
                <select
                  id="select-vendor"
                  value={selectDialog.vendorId}
                  onChange={e => setSelectDialog({ ...selectDialog, vendorId: e.target.value })}
                  className={cn(inputBaseClass, 'w-full')}
                >
                  {selectDialog.vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}{v.grade ? ` — Grade ${v.grade}` : ''}</option>
                  ))}
                </select>
                <p className="text-2xs text-muted-foreground pt-1">
                  انتخاب شما می‌تواند با پیشنهاد موتور متفاوت باشد؛ در آن صورت دلیل اهمیت بیشتری دارد.
                </p>
              </div>

              <div className="space-y-1">
                <label htmlFor="select-reason" className="block text-xs font-bold text-foreground">
                  دلیل انتخاب <span className="text-rose-600">*</span>
                </label>
                <Textarea
                  id="select-reason"
                  value={selectReason}
                  onChange={e => setSelectReason(e.target.value)}
                  rows={4}
                  className="resize-none"
                  placeholder="مثلاً: بالاترین امتیاز کیفی، سابقهٔ آزمایشگاهی بدون انحراف، و تأمین پایدار در دو سال گذشته."
                />
                <p className="text-2xs text-muted-foreground">حداقل ۱۰ کاراکتر.</p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border bg-muted/50 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSelectDialog(null)}>
                انصراف
              </Button>
              <Button type="submit" disabled={selectSaving}>
                ثبت انتخاب
              </Button>
            </div>
          </form>
        )}
      </FormModal>
    </div>
  );
}
