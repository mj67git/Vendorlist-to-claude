import React, { useState, useRef, useEffect } from 'react';
import { Search, Plus, Check, ChevronDown, Factory, Handshake, X, Globe, ShieldCheck, Sparkles } from 'lucide-react';
import { BusinessPartner, BusinessPartnerType } from '../types';

interface PartnerSelectorProps {
  type: BusinessPartnerType;
  anyType?: boolean;
  value?: string;
  selectedId?: string;
  onChange?: (id: string, partner?: BusinessPartner) => void;
  onSelect?: (id: string, partner?: BusinessPartner) => void;
  partners: BusinessPartner[];
  selectedManufacturerId?: string;
  manufacturerId?: string;
  onOpenCreateModal?: () => void;
  onAddNew?: () => void;
  optional?: boolean;
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
  selectedManufacturerId,
  manufacturerId,
  onOpenCreateModal,
  onAddNew,
  optional = false,
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
  const effectiveMfgId = selectedManufacturerId ?? manufacturerId;

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
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
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
      case 'Not Evaluated': return 'bg-slate-100 text-slate-600 border-slate-300';
      default: return 'bg-slate-100 text-slate-600 border-slate-300';
    }
  };

  // Filter partners. In anyType mode, every partner (manufacturer or supplier)
  // is selectable — they are independent now.
  const availablePartners = partners.filter(p => {
    if (anyType) return true;
    return p.type === type;
  });

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
    ? 'کارخانه تولیدی مرجع (Manufacturer)'
    : 'فروشنده / بازرگانی واسطه (Supplier)';

  return (
    <div className="space-y-1 relative font-sans" dir="rtl" ref={dropdownRef}>
      {/* Label and Quick Add Button */}
      <div className="flex items-center justify-between">
        <label className="text-[#1D1D1F] font-semibold text-xs flex items-center gap-1.5">
          {isManufacturer ? (
            <Factory className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          ) : (
            <Handshake className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          )}
          <span>{labelTitle}</span>
          {!optional ? (
            <span className="text-rose-500 font-bold">*</span>
          ) : (
            <span className="text-[10px] font-normal text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded mr-1">
              اختیاری (در صورت خرید مستقیم خالی بگذارید)
            </span>
          )}
        </label>

        <button
          type="button"
          disabled={disabled}
          onClick={triggerOpenCreate}
          className={`font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer ${
            disabled
              ? 'text-slate-400 cursor-not-allowed opacity-50'
              : 'text-[#0071E3] hover:text-[#0025D2]'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{isManufacturer ? 'ثبت تولیدکننده جدید' : 'ثبت فروشنده جدید'}</span>
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
          className={`flex items-center justify-between w-full bg-white border rounded-xl px-3.5 py-2.5 cursor-pointer transition-all text-right text-sm ${
            disabled
              ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-60'
              : isOpen
              ? 'border-[#0071E3] ring-2 ring-[#0071E3]/20 shadow-xs'
              : 'border-slate-300 hover:border-slate-400'
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
                  <div className="font-bold text-slate-900 truncate text-xs sm:text-sm">
                    {selectedPartner.name}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5 mt-0.5">
                    {selectedPartner.nameEn && (
                      <span className="font-mono text-[10px] text-slate-400" dir="ltr">
                        {selectedPartner.nameEn}
                      </span>
                    )}
                    {selectedPartner.country && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="flex items-center gap-0.5">
                          <Globe className="w-2.5 h-2.5 text-slate-400" />
                          <span>{selectedPartner.country}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {!isManufacturer && (
                  selectedPartner.evaluation?.grade && selectedPartner.evaluation.grade !== 'Not Evaluated' ? (
                    <span className={`mr-2 px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${getSOPGradeBadgeClass(selectedPartner.evaluation.grade)}`}>
                      {selectedPartner.evaluation.grade === 'Pending Review' ? '🟡 Pending' :
                       selectedPartner.evaluation.grade === 'Blacklist' ? '🔴 Blacklist' :
                       `Grade ${selectedPartner.evaluation.grade}`}
                    </span>
                  ) : (
                    <span className="mr-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                      ارزیابی نشده
                    </span>
                  )
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between flex-1 min-w-0 pr-1">
                {optional && !isManufacturer ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-xs font-bold shadow-2xs">
                      <Sparkles className="w-3 h-3 text-emerald-600" />
                      خرید بی‌واسطه از تولیدکننده (مستقیم)
                    </span>
                    <span className="text-[11px] text-slate-400 hidden sm:inline">
                      — کلیک جهت انتخاب فروشنده واسطه
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-400 text-xs">
                    {disabled && !isManufacturer
                      ? 'ابتدا تولیدکننده مرجع را انتخاب کنید'
                      : isManufacturer
                      ? '-- جستجو و انتخاب تولیدکننده مرجع --'
                      : '-- جستجو و انتخاب فروشنده واسطه --'}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 text-slate-400 mr-2 shrink-0">
            {selectedPartner && optional && (
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
                title="حذف و تغییر به خرید بی‌واسطه"
                className="p-1 hover:bg-slate-100 hover:text-slate-700 rounded-md transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[#0071E3]' : ''}`} />
          </div>
        </button>

        {/* Dropdown Popover */}
        {isOpen && !disabled && (
          <div className="absolute top-full right-0 left-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden animate-fadeIn">
            {/* Search Header */}
            <div className="p-2.5 border-b border-slate-100 bg-slate-50/80">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={`جستجو بر اساس نام فارسی، انگلیسی یا کشور ${isManufacturer ? 'تولیدکننده' : 'فروشنده'}...`}
                  className="w-full bg-white border border-slate-200 rounded-xl pr-9 pl-8 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#0071E3] focus:ring-1 focus:ring-[#0071E3]"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute left-2.5 top-2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* List Body */}
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 p-1.5">
              {/* Special Option for Supplier: Direct Purchase (خرید بی‌واسطه) */}
              {!isManufacturer && optional && (
                <div
                  onClick={() => {
                    triggerChange('', undefined);
                    setIsOpen(false);
                  }}
                  className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between mb-1 ${
                    !currentValue
                      ? 'bg-emerald-50/80 border border-emerald-200 text-emerald-950 font-bold'
                      : 'hover:bg-emerald-50/40 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <span>خرید بی‌واسطه از تولیدکننده (Direct Purchase)</span>
                        <span className="text-[10px] font-normal text-emerald-700 bg-emerald-100/70 px-1.5 py-0.2 rounded">
                          بدون واسطه
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        خرید به صورت مستقیم از کارخانه سازنده صورت گرفته و فروشنده واسطه‌ای وجود ندارد.
                      </div>
                    </div>
                  </div>
                  {!currentValue && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                </div>
              )}

              {/* Partner Items */}
              {filteredPartners.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-xs">
                  <div>هیچ {isManufacturer ? 'تولیدکننده‌ای' : 'فروشنده‌ای'} با این مشخصات یافت نشد.</div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      triggerOpenCreate();
                    }}
                    className="mt-3 inline-flex items-center gap-1 text-[#0071E3] hover:underline font-bold text-xs bg-blue-50 px-3 py-1.5 rounded-xl"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ ثبت شریک تجاری جدید در مخزن</span>
                  </button>
                </div>
              ) : (
                filteredPartners.map(p => {
                  const isSelected = p.id === currentValue;
                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        triggerChange(p.id, p);
                        setIsOpen(false);
                      }}
                      className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between ${
                        isSelected
                          ? 'bg-blue-50 border border-blue-200 text-blue-950 font-bold'
                          : 'hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {p.type === 'Manufacturer' ? (
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                          }`}>
                            <Factory className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                          }`}>
                            <Handshake className="w-3.5 h-3.5" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold truncate flex items-center gap-2">
                            <span>{p.name}</span>
                            {p.status === 'Blacklisted' && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-rose-100 text-rose-800 font-bold">
                                بلک‌لیست
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate flex items-center gap-2 mt-0.5">
                            {p.nameEn && (
                              <span className="font-mono text-slate-400" dir="ltr">
                                {p.nameEn}
                              </span>
                            )}
                            {p.country && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span>{p.country}</span>
                              </>
                            )}
                            {p.city && <span>({p.city})</span>}
                            {p.contactPerson && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span>رابط: {p.contactPerson}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 mr-2">
                        {p.type === 'Supplier' && (
                          p.evaluation?.grade && p.evaluation.grade !== 'Not Evaluated' ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSOPGradeBadgeClass(p.evaluation.grade)}`}>
                              {p.evaluation.grade === 'Pending Review' ? '🟡 Pending' :
                               p.evaluation.grade === 'Blacklist' ? '🔴 Blacklist' :
                               `Grade ${p.evaluation.grade}`}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                              ارزیابی نشده
                            </span>
                          )
                        )}
                        {isSelected && <Check className="w-4 h-4 text-[#0071E3]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick Add Footer inside Dropdown */}
            <div className="p-2 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs">
              <span className="text-[11px] text-slate-400">
                {filteredPartners.length} مورد یافت شد
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  triggerOpenCreate();
                }}
                className="text-[#0071E3] hover:text-[#0025D2] font-bold text-xs flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ ثبت {isManufacturer ? 'تولیدکننده جدید' : 'فروشنده جدید'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
