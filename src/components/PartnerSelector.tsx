import React, { useState, useRef, useEffect } from 'react';
import { Search, Plus, Check, ChevronDown, Factory, Handshake, X, Globe } from 'lucide-react';
import { Button } from './ui/button';
import { BusinessPartner, BusinessPartnerType } from '../types';
import { canSupplySources } from '../utils/sopEvaluation';
import { EntityName } from './EntityName';
import { Input } from './ui/input';

interface PartnerSelectorProps {
  type: BusinessPartnerType;
  anyType?: boolean;
  value?: string;
  selectedId?: string;
  onChange?: (id: string, partner?: BusinessPartner) => void;
  onSelect?: (id: string, partner?: BusinessPartner) => void;
  partners: BusinessPartner[];
  onOpenCreateModal?: () => void;
  onAddNew?: () => void;
  disabled?: boolean;
  existingVendorSupplierId?: string;
}

export const PartnerSelector: React.FC<PartnerSelectorProps> = ({
  type,
  anyType = false,
  value,
  selectedId,
  onChange,
  onSelect,
  partners,
  onOpenCreateModal,
  onAddNew,
  disabled = false,
  existingVendorSupplierId
}) => {
  const currentValue = value ?? selectedId ?? '';
  const triggerChange = (id: string, partner?: BusinessPartner) => {
    if (onChange) onChange(id, partner);
    if (onSelect) onSelect(id, partner);
  };
  const triggerOpenCreate = () => {
    if (onOpenCreateModal) onOpenCreateModal();
    if (onAddNew) onAddNew();
  };
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    let focusTimer: number | undefined;
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      focusTimer = window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      // Without this, closing the dropdown inside the delay still fired the
      // focus and pulled the caret into a now-hidden search box.
      if (focusTimer !== undefined) window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  // Current selected partner object
  const selectedPartner = partners.find(p => (anyType || p.type === type) && p.id === currentValue);

  const getSOPGradeBadgeClass = (grade?: string) => {
    switch (grade) {
      case 'A': return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'B': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'C': return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'Pending Review': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'Blacklist': return 'bg-rose-100 text-rose-800 border-rose-300';
      case 'Not Evaluated': return 'bg-muted text-muted-foreground border-border';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  // Filter partners. In anyType mode, every partner (manufacturer or supplier)
  // is selectable — they are independent now.
  const availablePartners = partners.filter(p => {
    // A blacklisted partner is hidden outright, unless it is the one already
    // attached to the record being edited.
    if (p.status === 'Blacklisted' && p.id !== currentValue) return false;
    if (anyType) return true;
    return p.type === type;
  });

  /**
   * The SOP admits only grade A suppliers. Blocked ones are listed but not
   * selectable rather than hidden: a supplier missing from the list reads as
   * "not registered yet" and the user goes off and creates a duplicate.
   *
   * The partner already attached to an existing source stays selectable, so a
   * record saved before this rule can still be edited instead of silently
   * losing its supplier on the next save.
   */
  const eligibility = (p: BusinessPartner) =>
    p.id === currentValue ? { allowed: true, reason: '' } : canSupplySources(p);

  const blockedCount = availablePartners.filter(p => !eligibility(p).allowed).length;

  // Filter based on search term
  const filteredPartners = availablePartners.filter(p => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase().trim();
    return (
      (p.name && p.name.toLowerCase().includes(term)) ||
      (p.nameEn && p.nameEn.toLowerCase().includes(term)) ||
      (p.country && p.country.toLowerCase().includes(term)) ||
      (p.city && p.city.toLowerCase().includes(term)) ||
      (p.contactPerson && p.contactPerson.toLowerCase().includes(term))
    );
  });

  const isManufacturer = anyType ? (selectedPartner?.type === 'Manufacturer') : type === 'Manufacturer';
  const labelTitle = anyType
    ? 'تأمین‌کننده (تولیدکننده یا فروشنده)'
    : isManufacturer
    ? 'تولیدکننده'
    : 'فروشنده';

  return (
    <div className="space-y-1 relative font-sans" ref={dropdownRef}>
      {/* Label and Quick Add Button */}
      <div className="flex items-center justify-between">
        <label className="text-foreground font-semibold text-xs flex items-center gap-1.5">
          {isManufacturer ? (
            <Factory className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          ) : (
            <Handshake className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          )}
          <span>{labelTitle}</span>
          <span className="text-rose-500 font-bold">*</span>
        </label>

        <button
          type="button"
          disabled={disabled}
          onClick={triggerOpenCreate}
          className={`font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer ${
            disabled
              ? 'text-muted-foreground cursor-not-allowed opacity-50'
              : 'text-primary hover:text-primary-hover'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{anyType ? 'ثبت تأمین‌کننده جدید' : isManufacturer ? 'ثبت تولیدکننده جدید' : 'ثبت فروشنده جدید'}</span>
        </button>
      </div>

      {/* Main Trigger Field */}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              setIsOpen(!isOpen);
              setSearchTerm('');
            }
          }}
          className={`flex items-center justify-between w-full bg-card border rounded-xl px-3.5 py-2.5 cursor-pointer transition-all text-right text-sm ${
            disabled
              ? 'bg-muted border-border text-muted-foreground cursor-not-allowed opacity-60'
              : isOpen
              ? 'border-ring ring-2 ring-ring/20 shadow-xs'
              : 'border-border hover:border-muted-foreground'
          }`}
        >
          <div className="flex items-center gap-2.5 overflow-hidden w-full">
            {isManufacturer ? (
              <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <Factory className="w-4 h-4" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                <Handshake className="w-4 h-4" />
              </div>
            )}

            {selectedPartner ? (
              <div className="flex items-center justify-between flex-1 min-w-0 pr-1">
                <div className="min-w-0">
                  <EntityName
                    as="div"
                    name={selectedPartner.name}
                    lines={2}
                    className="font-bold text-foreground text-xs sm:text-sm"
                  />
                  <div className="text-2xs text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                    {selectedPartner.nameEn && (
                      <span className="font-mono text-2xs text-muted-foreground" dir="ltr">
                        {selectedPartner.nameEn}
                      </span>
                    )}
                    {selectedPartner.country && (
                      <>
                        <span className="text-muted-foreground/50">•</span>
                        <span className="flex items-center gap-0.5">
                          <Globe className="w-2.5 h-2.5 text-muted-foreground" />
                          <span>{selectedPartner.country}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {!isManufacturer && (
                  selectedPartner.evaluation?.grade && selectedPartner.evaluation.grade !== 'Not Evaluated' ? (
                    <span className={`mr-2 px-2 py-0.5 rounded-md text-2xs font-bold border shrink-0 ${getSOPGradeBadgeClass(selectedPartner.evaluation.grade)}`}>
                      {selectedPartner.evaluation.grade === 'Pending Review' ? '🟡 Pending' :
                       selectedPartner.evaluation.grade === 'Blacklist' ? '🔴 Blacklist' :
                       `Grade ${selectedPartner.evaluation.grade}`}
                    </span>
                  ) : (
                    <span className="mr-2 px-2 py-0.5 rounded-md text-2xs font-bold bg-muted text-muted-foreground border border-border shrink-0">
                      ارزیابی نشده
                    </span>
                  )
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between flex-1 min-w-0 pr-1">
                <span className="text-muted-foreground text-xs">
                  {anyType
                    ? 'جستجو و انتخاب تولیدکننده یا فروشنده'
                    : isManufacturer
                    ? 'جستجو و انتخاب تولیدکننده'
                    : 'جستجو و انتخاب فروشنده'}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 text-muted-foreground mr-2 shrink-0">
            {selectedPartner && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  triggerChange('', undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    triggerChange('', undefined);
                  }
                }}
                title="حذف انتخاب"
                className="p-1 hover:bg-accent hover:text-foreground rounded-md transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-primary' : ''}`} />
          </div>
        </button>

        {/* Dropdown Popover */}
        {isOpen && !disabled && (
          <div className="absolute top-full right-0 left-0 mt-1.5 bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden fade-in">
            {/* Search Header */}
            <div className="p-2.5 border-b border-border bg-muted/80">
              <div className="relative">
                <Search className="w-4 h-4 text-muted-foreground absolute right-3 top-2.5" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="جستجو بر اساس نام، کشور یا شهر..." 
                  className="w-full pr-9 pl-8"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute left-2.5 top-2 text-muted-foreground hover:text-muted-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* List Body */}
            <div className="max-h-60 overflow-y-auto divide-y divide-border p-1.5">
              {/* Partner Items */}
              {filteredPartners.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-xs">
                  <div>شریکی با این مشخصات یافت نشد.</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsOpen(false);
                      triggerOpenCreate();
                    }}
                    className="mt-3 text-primary bg-blue-50 dark:bg-blue-950/40 hover:text-primary font-bold"
                  >
                    <Plus />
                    <span>ثبت شریک تجاری جدید</span>
                  </Button>
                </div>
              ) : (
                filteredPartners.map(p => {
                  const isSelected = p.id === currentValue;
                  const { allowed, reason } = eligibility(p);
                  return (
                    <div
                      key={p.id}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={!allowed}
                      title={allowed ? undefined : reason}
                      onClick={() => {
                        if (!allowed) return;
                        triggerChange(p.id, p);
                        setIsOpen(false);
                      }}
                      className={`p-2.5 rounded-xl transition-all flex items-center justify-between ${
                        !allowed
                          ? 'opacity-55 cursor-not-allowed'
                          : isSelected
                          ? 'bg-blue-50 border border-blue-200 text-blue-950 font-bold cursor-pointer'
                          : 'hover:bg-accent text-foreground cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {p.type === 'Manufacturer' ? (
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-indigo-600 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            <Factory className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            <Handshake className="w-3.5 h-3.5" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          {/* The clip was on this flex row, not on the name, so
                              the blacklist badge cut the name off with no
                              ellipsis to show anything was missing. */}
                          <div className="text-xs font-bold flex items-center gap-2 min-w-0">
                            <EntityName name={p.name} lines={1} />
                            {p.status === 'Blacklisted' && (
                              <span className="px-1.5 py-0.2 rounded text-2xs bg-rose-100 text-rose-800 font-bold shrink-0">
                                بلک‌لیست
                              </span>
                            )}
                          </div>
                          <div className="text-2xs text-muted-foreground truncate flex items-center gap-2 mt-0.5">
                            {p.nameEn && (
                              <span className="font-mono text-muted-foreground" dir="ltr">
                                {p.nameEn}
                              </span>
                            )}
                            {p.country && (
                              <>
                                <span className="text-muted-foreground/50">•</span>
                                <span>{p.country}</span>
                              </>
                            )}
                            {p.city && <span>({p.city})</span>}
                            {p.contactPerson && (
                              <>
                                <span className="text-muted-foreground/50">•</span>
                                <span>رابط: {p.contactPerson}</span>
                              </>
                            )}
                          </div>
                          {!allowed && (
                            <div className="text-2xs font-bold text-amber-700 dark:text-amber-400 mt-1 leading-snug">
                              {reason}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 mr-2">
                        {p.type === 'Supplier' && (
                          p.evaluation?.grade && p.evaluation.grade !== 'Not Evaluated' ? (
                            <span className={`px-2 py-0.5 rounded text-2xs font-bold border ${getSOPGradeBadgeClass(p.evaluation.grade)}`}>
                              {p.evaluation.grade === 'Pending Review' ? '🟡 Pending' :
                               p.evaluation.grade === 'Blacklist' ? '🔴 Blacklist' :
                               `Grade ${p.evaluation.grade}`}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-2xs font-bold bg-muted text-muted-foreground border border-border">
                              ارزیابی نشده
                            </span>
                          )
                        )}
                        {isSelected && <Check className="w-4 h-4 text-primary" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick Add Footer inside Dropdown */}
            <div className="p-2 border-t border-border bg-muted/50 flex items-center justify-between text-xs">
              <span className="text-2xs text-muted-foreground">
                {filteredPartners.length} مورد یافت شد
                {blockedCount > 0 && (
                  <span className="text-amber-700 dark:text-amber-400 font-bold">
                    {' '}· {blockedCount} مورد طبق SOP قابل انتخاب نیست
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  triggerOpenCreate();
                }}
                className="text-primary hover:text-primary-hover font-bold text-xs flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ ثبت {anyType ? 'تأمین‌کننده جدید' : isManufacturer ? 'تولیدکننده جدید' : 'فروشنده جدید'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
