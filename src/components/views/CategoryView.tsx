import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, Download, Search, X } from 'lucide-react';
import { Pagination } from '../../components/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { categoryLabels } from '../../constants/categories';
import { BusinessPartner, Category, Material, User, Vendor } from '../../types';
import { useExcelExport } from '../../hooks/useExcelExport';
import { isInBlacklistCategory, isVendorRejected } from '../../utils/vendorState';
import { checkLicenseExpiry, getDisplayCountry } from '../../utils/vendorUtils';
import { MaterialGroup } from './MaterialGroup';
import type { SourceSelectionRecord } from './MaterialsComparisonSection';
import { FormModal } from '../../components/FormModal';
import { authFetch, isLocalMode } from '../../services/authFetch';
import { can } from '../../utils/permissions';

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
  const [sortBy, setSortBy] = useState<'material' | 'count' | 'grade' | 'expiry'>('material');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // ---- recorded source selections -----------------------------------------
  // Which source is actually bought for each material. The comparison panel
  // only ever recommended; this is the decision someone made and signed for.
  const canChoose = can(currentUser, 'vendor.edit');
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
    authFetch('/api/source-selections', {
      method: 'PUT',
      body: JSON.stringify({
        materialKey: selectDialog.materialKey,
        category: categoryId,
        vendorId: selectDialog.vendorId,
        reason,
      }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'ثبت انتخاب ناموفق بود.');
        setSelectDialog(null);
        loadSelections();
      })
      .catch(err => setSelectError(err.message))
      .finally(() => setSelectSaving(false));
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [query, sortBy, activeFilter]);

  const meta = categoryLabels[categoryId];
  
  const categoryVendors = useMemo(() => {
    if (categoryId === 'sample') {
      return db.filter(v => v.isSample || v.category === 'sample');
    }
    if (categoryId === 'blacklist') {
      return db.filter(isInBlacklistCategory);
    }
    return db.filter(v => v.category === categoryId && v.status !== 'rejected' && v.grade !== 'rejected');
  }, [db, categoryId]);
  
  const filteredVendors = useMemo(() => {
    const qt = query.toLowerCase();
    return categoryVendors.filter(v => 
      v.name.toLowerCase().includes(qt) || 
      v.nameEn.toLowerCase().includes(qt) || 
      v.material.toLowerCase().includes(qt) || 
      v.materialEn.toLowerCase().includes(qt) ||
      v.cas.toLowerCase().includes(qt) ||
      (v.irc && v.irc.toLowerCase().includes(qt)) ||
      (v.country && getDisplayCountry(v).toLowerCase().includes(qt))
    );
  }, [categoryVendors, query]);

  // Apply the quick status/grade filter (toggled from the stat chips) before grouping.
  const matchesFilter = (v: Vendor): boolean => {
    if (!activeFilter) return true;
    switch (activeFilter) {
      case 'approved': return v.status === 'approved';
      case 'conditional': return v.status === 'conditional';
      case 'rejected': return isVendorRejected(v);
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

  const displayVendors = useMemo(
    () => filteredVendors.filter(matchesFilter),
    [filteredVendors, activeFilter]
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
    } else if (sortBy === 'expiry') {
      sorted.sort((a, b) => soonestExpiry(a.vendors) - soonestExpiry(b.vendors));
    }
    return sorted;
  }, [grouped, sortBy]);

  const ITEMS_PER_PAGE = 20;
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
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2 shrink-0">
            <meta.icon className="w-6 h-6 text-primary" />
            {meta.fa}
          </h2>

          <div className="flex items-center gap-2 lg:mr-auto shrink-0 order-last lg:order-none">
            <Button 
              type="button" 
              onClick={() => excel.run(xl => xl.exportCategoryToExcel(db, categoryId, meta.fa, partners, materials, selections))}
              disabled={excel.busy}
              className="flex items-center gap-2 text-xs font-bold shadow-xs cursor-pointer active:scale-95"
              title={`دانلود خروجی اکسل دسته‌بندی ${meta.fa}`}
            >
              <Download className="w-4 h-4" />
              <span>{excel.busy ? 'در حال آماده‌سازی…' : 'خروجی اکسل'}</span>
            </Button>
            {excel.error && (
              <p className="text-xs text-rose-600 dark:text-rose-400 max-w-xs">{excel.error}</p>
            )}
          </div>

          <div className="relative w-full lg:w-80 shrink-0">
            <Input 
              type="text" 
              placeholder="جستجو کلمه کلیدی، نام، ماده، CAS، کشور..."
              className="pl-9 pr-9 text-sm bg-background"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              dir="rtl"
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

          {/* Sort control */}
          <div className="flex items-center gap-2 w-full lg:w-auto shrink-0">
            <label htmlFor="category-sort" className="text-2xs text-muted-foreground whitespace-nowrap">
              مرتب‌سازی
            </label>
            <select
              id="category-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              dir="rtl"
              className="text-xs bg-background border border-border rounded-lg px-2.5 py-2 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
              title="مرتب‌سازی گروه‌های ماده"
            >
              <option value="material">نام ماده (الفبا)</option>
              <option value="count">تعداد سورس (بیشترین)</option>
              <option value="grade">بهترین گرید</option>
              <option value="expiry">نزدیک‌ترین انقضای مجوز</option>
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
                    <Badge variant="gradeA" onClick={() => toggle('approved')} className={chipCls('approved', categoryVendors.filter(v => v.status === 'approved').length)}>
                      تأیید شده: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.status === 'approved').length}</span>
                    </Badge>
                    <Badge variant="gradeC" onClick={() => toggle('conditional')} className={chipCls('conditional', categoryVendors.filter(v => v.status === 'conditional').length)}>
                      تأیید مشروط: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.status === 'conditional').length}</span>
                    </Badge>
                    <Badge variant="gradeReject" onClick={() => toggle('rejected')} className={chipCls('rejected', categoryVendors.filter(isVendorRejected).length)}>
                      مردود: <span className="font-bold font-mono mr-1">{categoryVendors.filter(isVendorRejected).length}</span>
                    </Badge>
                  </>
                ) : categoryId === 'blacklist' ? null : (
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
                {categoryId !== 'blacklist' && expiringCount > 0 && (
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
            {(query || activeFilter) && (
              <div className="mt-3">
                <p className="text-sm text-muted-foreground">با فیلتر یا جست‌وجوی فعلی موردی پیدا نشد.</p>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => { setQuery(''); setActiveFilter(null); }}
                  className="mt-3"
                >
                  پاک کردن فیلترها
                </Button>
              </div>
            )}
          </div>
        )}

        <Pagination 
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          startIndex={startIndex}
          endIndex={endIndex}
          onPageChange={setCurrentPage}
        />
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
                  className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
                <textarea
                  id="select-reason"
                  value={selectReason}
                  onChange={e => setSelectReason(e.target.value)}
                  rows={4}
                  className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
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
