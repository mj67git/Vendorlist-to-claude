import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, Download, Search, X } from 'lucide-react';
import { Pagination } from '../../components/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { categoryLabels } from '../../constants/categories';
import { BusinessPartner, Category, Material, User, Vendor } from '../../types';
import { exportCategoryToExcel } from '../../utils/excelExport';
import { isInBlacklistCategory, isVendorRejected } from '../../utils/vendorState';
import { checkLicenseExpiry, getDisplayCountry } from '../../utils/vendorUtils';
import { MaterialGroup } from './MaterialGroup';

// extracted from App.tsx

export function CategoryView({ 
  db, 
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
  categoryId: Category, 
  onSelectVendor: any, 
  currentUser: User,
  expandedMaterial: string | null,
  onToggleMaterial: (mat: string | null) => void,
  materials: Material[],
  onAddMaterial: (m: Material) => void,
  partners?: BusinessPartner[]
}) {
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState<'material' | 'count' | 'grade' | 'expiry'>('material');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

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
      <div className="sticky top-0 z-20 bg-muted/95 backdrop-blur-md -mt-4 sm:-mt-8 -mx-4 sm:-mx-8 px-4 sm:px-8 pt-4 sm:pt-6 pb-4 border-b border-border shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2">
              <meta.icon className="w-6 h-6 text-primary" />
              {meta.fa}
            </h2>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{meta.en}</p>
          </div>

          <div className="flex items-center gap-2">
            <Button 
              type="button" 
              onClick={() => exportCategoryToExcel(db, categoryId, meta.fa, partners, materials)}
              className="flex items-center gap-2 text-xs font-bold shadow-xs cursor-pointer active:scale-95"
              title={`دانلود خروجی اکسل دسته‌بندی ${meta.fa}`}
            >
              <Download className="w-4 h-4" />
              <span>خروجی اکسل {meta.fa} (XLSX)</span>
            </Button>
          </div>
        </div>

        {/* Category Toolbar (Search & Stats) */}
        <Card className="p-3.5 sm:p-4 flex flex-col md:flex-row gap-3 sm:gap-4 items-center justify-between bg-card border-border shadow-xs">
          <div className="relative w-full md:w-80">
            <Input 
              type="text" 
              placeholder="جستجو کلمه کلیدی، نام، ماده، CAS، کشور..."
              className="pl-9 pr-4 text-sm bg-background"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              dir="rtl"
            />
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute left-8 top-2.5 text-muted-foreground hover:text-muted-foreground transition-colors p-0.5 rounded cursor-pointer"
                title="پاک کردن جستجو"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Sort control */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <label className="text-[11px] text-muted-foreground whitespace-nowrap flex items-center gap-1">
              <ChevronDown className="w-3.5 h-3.5" /> مرتب‌سازی
            </label>
            <select
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

          {/* Stats double as quick filters (click to toggle) */}
          {(() => {
            const chipCls = (key: string | null) =>
              `px-2.5 py-1 text-xs cursor-pointer select-none transition-shadow ${
                activeFilter === key ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'opacity-95 hover:opacity-100'
              }`;
            const toggle = (key: string) => setActiveFilter(activeFilter === key ? null : key);
            const expiringCount = categoryVendors.filter(v => {
              if (!v.ircExpiryDate) return false;
              const c = checkLicenseExpiry(v.ircExpiryDate);
              return c.status === 'expired' || c.status === 'expiring_soon';
            }).length;
            return (
              <div className="flex flex-wrap gap-2 w-full md:w-auto justify-start md:justify-end items-center">
                <Badge variant="outline" onClick={() => setActiveFilter(null)}
                  className={`px-3 py-1 text-xs cursor-pointer select-none ${activeFilter === null ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
                  title="نمایش همه">
                  کل سورس‌ها: <span className="font-bold font-mono mr-1 text-primary">{categoryVendors.length}</span>
                </Badge>
                {categoryId === 'sample' ? (
                  <>
                    <Badge variant="gradeA" onClick={() => toggle('approved')} className={chipCls('approved')}>
                      Approved: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.status === 'approved').length}</span>
                    </Badge>
                    <Badge variant="gradeC" onClick={() => toggle('conditional')} className={chipCls('conditional')}>
                      Approved conditional: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.status === 'conditional').length}</span>
                    </Badge>
                    <Badge variant="gradeReject" onClick={() => toggle('rejected')} className={chipCls('rejected')}>
                      Reject: <span className="font-bold font-mono mr-1">{categoryVendors.filter(isVendorRejected).length}</span>
                    </Badge>
                  </>
                ) : categoryId === 'blacklist' ? null : (
                  <>
                    <Badge variant="gradeA" onClick={() => toggle('A')} className={chipCls('A')}>
                      Grade A: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.grade === 'A').length}</span>
                    </Badge>
                    <Badge variant="gradeB" onClick={() => toggle('B')} className={chipCls('B')}>
                      Grade B: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.grade === 'B').length}</span>
                    </Badge>
                    <Badge variant="gradeC" onClick={() => toggle('C')} className={chipCls('C')}>
                      Grade C: <span className="font-bold font-mono mr-1">{categoryVendors.filter(v => v.grade === 'C').length}</span>
                    </Badge>
                    <Badge variant="gradeReject" onClick={() => toggle('rejected')} className={chipCls('rejected')}>
                      لیست سیاه: <span className="font-bold font-mono mr-1">{categoryVendors.filter(isVendorRejected).length}</span>
                    </Badge>
                  </>
                )}
                {categoryId !== 'blacklist' && expiringCount > 0 && (
                  <Badge variant="warning" onClick={() => toggle('expiring')} className={chipCls('expiring')} title="فیلتر سورس‌های با مجوز رو به انقضا یا منقضی">
                    ⚠ نزدیک انقضا: <span className="font-bold font-mono mr-1">{expiringCount}</span>
                  </Badge>
                )}
              </div>
            );
          })()}
        </Card>
      </div>

      <div className="space-y-6 mt-8">
        {paginatedGroups.map(group => (
          <MaterialGroup 
            key={group.en} 
            group={group} 
            onSelectVendor={onSelectVendor} 
            currentUser={currentUser} 
            categoryId={categoryId} 
            expandedMaterial={expandedMaterial}
            onToggleMaterial={onToggleMaterial}
            partners={partners}
          />
        ))}
        {groupsList.length === 0 && (
          <div className="text-center py-16 px-4 bg-card rounded-2xl border border-border">
            <Archive className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="text-foreground font-semibold text-lg">نتیجه‌ای یافت نشد</h4>
            {(query || activeFilter) && (
              <div className="mt-3">
                <p className="text-sm text-muted-foreground">با فیلتر یا جست‌وجوی فعلی موردی پیدا نشد.</p>
                <button
                  type="button"
                  onClick={() => { setQuery(''); setActiveFilter(null); }}
                  className="mt-3 text-xs font-semibold text-primary hover:underline cursor-pointer"
                >
                  پاک کردن فیلترها
                </button>
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
    </div>
  );
}
