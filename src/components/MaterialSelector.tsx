import { Button } from './ui/button';
import { FormModal } from './FormModal';
import React, { useState } from 'react';
import { Search, Plus, Check, ChevronDown, Package, X, Upload, FileText } from 'lucide-react';
import { Material, MaterialRole, Pharmacopoeia } from '../types';
import { MATERIAL_ROLES, getMaterialRole, roleOptionLabel } from '../constants/materialRoles';

interface Props {
  value?: string;
  onChange: (id: string, material?: Material) => void;
  materials: Material[];
  onAddMaterial?: (mat: Material) => void;
  oldMaterialName?: string;
}

const pharmacopoeiaOptions: Pharmacopoeia[] = ['USP', 'BP', 'EP', 'JP', 'IP', 'Ph. Eur.', 'ChP', 'In-house', 'Other'];

export const MaterialSelector: React.FC<Props> = ({ value, onChange, materials, onAddMaterial, oldMaterialName }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Comprehensive Material Form State (Matching MaterialRepositoryView)
  const [formData, setFormData] = useState<Partial<Material>>({
    nameFa: '',
    nameEn: '',
    cas: '',
    role: 'API',
    pharmacopoeia: 'USP',
    finalProduct: '',
    finalProductEn: '',
    specificationFile: ''
  });

  const selectedMaterial = materials.find(m => m.id === value);

  const generateStandardNameFa = (data: Partial<Material>) => {
    const roleInfo = getMaterialRole(data.role);
    const nameFaStr = data.nameFa?.trim() || '---';
    const finalProductStr = data.finalProduct?.trim() || '---';
    return `${roleInfo.labelFa} - ${nameFaStr} (برای ${finalProductStr})`;
  };

  const generateStandardNameEn = (data: Partial<Material>) => {
    const roleInfo = getMaterialRole(data.role);
    const nameEnStr = data.nameEn?.trim() || '---';
    const finalProductEnStr = data.finalProductEn?.trim() || data.finalProduct?.trim() || '---';
    return `${roleInfo.code}-${nameEnStr} (For ${finalProductEnStr})`;
  };

  const filteredMaterials = materials.filter(m => {
    const term = searchTerm.toLowerCase();
    return (
      (m.nameFa && m.nameFa.toLowerCase().includes(term)) ||
      (m.nameEn && m.nameEn.toLowerCase().includes(term)) ||
      (m.standardNameFa && m.standardNameFa.toLowerCase().includes(term)) ||
      (m.cas && m.cas.toLowerCase().includes(term))
    );
  });

  const handleCreateNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nameFa?.trim() || !formData.finalProduct?.trim()) return;

    const nameFaTrimmed = formData.nameFa.trim();
    const nameEnTrimmed = formData.nameEn?.trim() || nameFaTrimmed;

    const newMat: Material = {
      id: 'mat_' + Math.random().toString(36).substring(2, 9),
      nameFa: nameFaTrimmed,
      nameEn: nameEnTrimmed,
      standardNameFa: generateStandardNameFa(formData),
      standardNameEn: generateStandardNameEn(formData),
      cas: formData.cas?.trim() || 'N/A',
      role: formData.role || 'API',
      pharmacopoeia: formData.pharmacopoeia || 'USP',
      finalProduct: formData.finalProduct?.trim() || '-',
      finalProductEn: formData.finalProductEn?.trim() || '-',
      specificationFile: formData.specificationFile || undefined,
      createdAt: new Date().toISOString()
    };

    if (onAddMaterial) {
      onAddMaterial(newMat);
    }
    onChange(newMat.id, newMat);

    // Reset Form
    setFormData({
      nameFa: '',
      nameEn: '',
      cas: '',
      role: 'API',
      pharmacopoeia: 'USP',
      finalProduct: '',
      finalProductEn: '',
      specificationFile: ''
    });
    setShowCreateModal(false);
    setIsOpen(false);
  };

  return (
    <div className="space-y-1 relative" style={{ direction: 'rtl' }}>
      <label className="text-foreground font-semibold text-xs flex items-center justify-between">
        <span>ماده اولیه (انتخاب از مخزن مرجع) <span className="text-rose-500">*</span></span>
        {selectedMaterial && (
          <span className="text-2xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded font-mono">
            ID: {selectedMaterial.id}
          </span>
        )}
      </label>

      {/* Main Trigger Button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center justify-between w-full bg-card border rounded-lg px-3 py-2 cursor-pointer transition-colors text-right text-sm ${
            isOpen ? 'border-ring ring-1 ring-ring' : 'border-border hover:border-[var(--border-hover-color)]'
          } ${!selectedMaterial && !isOpen && !oldMaterialName ? 'text-muted-foreground' : 'text-foreground'}`}
        >
          <div className="flex-1 truncate pr-1">
            {selectedMaterial ? (
              <span className="font-bold text-foreground">
                {selectedMaterial.nameFa} <span className="text-muted-foreground font-mono text-xs dir-ltr">({selectedMaterial.nameEn})</span>
              </span>
            ) : oldMaterialName ? (
              <span className="text-amber-600 font-medium">نیاز به انتخاب از مخزن (ماده قبلی: {oldMaterialName})</span>
            ) : (
              'جستجو و انتخاب ماده اولیه...'
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {selectedMaterial && (
              <span className="text-2xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium">
                {selectedMaterial.role}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {/* Dropdown Options */}
        {isOpen && (
          <div className="absolute z-30 right-0 left-0 mt-1 bg-card rounded-xl shadow-xl border border-border overflow-hidden text-right">
            <div className="p-2 border-b border-border bg-muted/50">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="جستجوی ماده، CAS یا نام انگلیسی..."
                  className="w-full bg-card border border-border rounded-lg pr-8 pl-3 py-1.5 text-xs focus:outline-none focus:border-cyan-600"
                />
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto divide-y divide-border">
              {filteredMaterials.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-xs">
                  ماده‌ای با این مشخصات یافت نشد.
                </div>
              ) : (
                filteredMaterials.map((mat) => {
                  const isSelected = value === mat.id;
                  return (
                    <button
                      key={mat.id}
                      type="button"
                      onClick={() => {
                        onChange(mat.id, mat);
                        setIsOpen(false);
                      }}
                      className={`w-full p-2.5 flex items-center justify-between hover:bg-accent transition-colors text-right ${
                        isSelected ? 'bg-cyan-50/50' : ''
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-foreground text-xs flex items-center gap-1.5">
                          {mat.nameFa}
                          {mat.standardNameFa && mat.standardNameFa !== mat.nameFa && (
                            <span className="text-2xs text-muted-foreground font-normal">({mat.standardNameFa})</span>
                          )}
                        </span>
                        <div className="flex items-center gap-2 text-2xs text-muted-foreground font-mono mt-0.5" dir="ltr">
                          <span>{mat.nameEn}</span>
                          {mat.cas && mat.cas !== 'N/A' && (
                            <>
                              <span>•</span>
                              <span>CAS: {mat.cas}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-2xs bg-muted text-muted-foreground px-2 py-0.5 rounded font-medium">
                          {mat.role}
                        </span>
                        {isSelected && <Check className="w-4 h-4 text-cyan-600" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {onAddMaterial && (
              <div className="p-2 border-t border-border bg-muted">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setShowCreateModal(true)}
                  className="w-full bg-fuchsia-600 text-white hover:bg-fuchsia-700 hover:shadow-fuchsia-600/20 font-bold"
                >
                  <Plus />
                  تعریف ماده اولیه جدید در مخزن (فرم کامل)
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Comprehensive Material Creation Modal (Matching MaterialRepositoryView) */}
      <FormModal open={showCreateModal} onClose={() => setShowCreateModal(false)} size="md" ariaLabel="ثبت ماده اولیه جدید">
            {/* Modal Header */}
            <div className="p-5 border-b border-border flex items-center justify-between bg-muted/80 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-fuchsia-100 text-fuchsia-700 rounded-xl">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-base">ثبت ماده اولیه جدید در مخزن</h3>
                  <p className="text-2xs text-muted-foreground">تکمیل کامل اطلاعات فنی و ثبتی ماده اولیه مطابق استاندارد VLSE</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowCreateModal(false)}
                className="text-muted-foreground"
              >
                <X />
              </Button>
            </div>

            {/* Modal Form Content */}
            <form onSubmit={handleCreateNew} className="p-6 overflow-y-auto flex-1 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Persian Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">
                    نام فارسی ماده <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nameFa || ''}
                    onChange={(e) => setFormData({ ...formData, nameFa: e.target.value })}
                    placeholder="مثلاً: استامینوفن"
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:bg-card transition-all"
                  />
                </div>

                {/* English Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">
                    نام لاتین / ژنریک <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nameEn || ''}
                    onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                    placeholder="e.g. Paracetamol"
                    dir="ltr"
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-left font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:bg-card transition-all"
                  />
                </div>

                {/* CAS Code */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">
                    کد CAS
                  </label>
                  <input
                    type="text"
                    value={formData.cas || ''}
                    onChange={(e) => setFormData({ ...formData, cas: e.target.value })}
                    placeholder="103-90-2"
                    dir="ltr"
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-left font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:bg-card transition-all"
                  />
                </div>

                {/* Role */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">
                    نقش ماده (Role) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.role || 'API'}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as MaterialRole })}
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:bg-card transition-all"
                  >
                    {MATERIAL_ROLES.map(opt => <option key={opt.value} value={opt.value}>{roleOptionLabel(opt)}</option>)}
                  </select>
                </div>

                {/* Pharmacopoeia */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">
                    فارماکوپه (Pharmacopoeia) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.pharmacopoeia || 'USP'}
                    onChange={(e) => setFormData({ ...formData, pharmacopoeia: e.target.value as Pharmacopoeia })}
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:bg-card transition-all"
                  >
                    {pharmacopoeiaOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>

                {/* Final Product Fa */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">
                    محصول نهایی (فارسی) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.finalProduct || ''}
                    onChange={(e) => setFormData({ ...formData, finalProduct: e.target.value })}
                    placeholder="مثلاً: قرص استامینوفن ۵۰۰"
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:bg-card transition-all"
                  />
                </div>

                {/* Final Product En */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">
                    محصول نهایی (لاتین)
                  </label>
                  <input
                    type="text"
                    value={formData.finalProductEn || ''}
                    onChange={(e) => setFormData({ ...formData, finalProductEn: e.target.value })}
                    placeholder="Paracetamol 500mg Tablet"
                    dir="ltr"
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-left font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:bg-card transition-all"
                  />
                </div>

                {/* Specification File Upload */}
                <div className="md:col-span-2 space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">Specification File (اختیاری)</label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center justify-center gap-2 px-4 py-2 bg-muted border border-border border-dashed rounded-xl text-xs cursor-pointer hover:bg-accent transition-colors text-muted-foreground font-medium">
                      <Upload className="w-4 h-4 text-muted-foreground" />
                      <span>انتخاب فایل مشخصات فنی</span>
                      <input 
                        type="file" 
                        className="hidden" 
                        onChange={e => {
                          if (e.target.files && e.target.files[0]) {
                            setFormData({ ...formData, specificationFile: e.target.files[0].name });
                          }
                        }}
                      />
                    </label>
                    {formData.specificationFile && (
                      <div className="flex items-center gap-2 bg-fuchsia-50 text-fuchsia-700 px-3 py-1.5 rounded-lg border border-fuchsia-100">
                        <FileText className="w-4 h-4" />
                        <span className="text-2xs font-mono font-bold truncate max-w-[200px]" dir="ltr">
                          {formData.specificationFile}
                        </span>
                        <button type="button" onClick={() => setFormData({...formData, specificationFile: undefined})} className="text-rose-500 hover:text-rose-700 p-1">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Standard Names Auto-generation Box */}
              <div className="bg-muted p-4 rounded-xl border border-border space-y-3">
                <div className="space-y-1">
                  <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider block">نام استاندارد فارسی (تولید خودکار)</label>
                  <div className="w-full px-3 py-2 bg-card border border-border rounded-lg text-xs text-foreground font-bold select-all">
                    {generateStandardNameFa(formData)}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider block">Standard English Name (Auto-generated)</label>
                  <div className="w-full px-3 py-2 bg-card border border-border rounded-lg text-xs text-foreground font-mono font-bold select-all" dir="ltr">
                    {generateStandardNameEn(formData)}
                  </div>
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateModal(false)}
                  className="text-xs font-bold text-muted-foreground"
                >
                  انصراف
                </Button>
                <Button
                  type="submit"
                  className="px-6 bg-fuchsia-600 text-white hover:bg-fuchsia-700 hover:shadow-fuchsia-600/20 text-xs font-bold"
                >
                  ذخیره ماده اولیه در مخزن
                </Button>
              </div>
            </form>
      </FormModal>
    </div>
  );
};
