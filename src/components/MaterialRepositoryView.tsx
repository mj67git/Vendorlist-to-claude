import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Search, Plus, Edit2, Trash2, Eye, X, Upload, Download, ArrowUpDown, 
  FileText, Database, Layers, Pill, FlaskConical, Droplet, Beaker, 
  Archive, CheckCircle, AlertCircle, Sparkles, Shield, Tag
} from 'lucide-react';
import { Material, MaterialRole, Pharmacopoeia, User, Vendor } from '../types';
import { Pagination } from './Pagination';

interface Props {
  materials: Material[];
  onAddMaterial: (material: Material) => void;
  onEditMaterial: (material: Material, customAction?: string) => void;
  onDeleteMaterial: (id: string) => void;
  currentUser: User | null;
  db?: Vendor[];
}

const roleOptions: { value: MaterialRole; label: string; code: string; fullLabel: string }[] = [
  { value: 'API', label: 'ماده موثره', code: 'API', fullLabel: 'ماده موثره دارویی (API)' },
  { value: 'Intermediate', label: 'حدواسط', code: 'INT', fullLabel: 'حدواسط (Intermediate)' },
  { value: 'Solvent', label: 'حلال', code: 'SOL', fullLabel: 'حلال (Solvent)' },
  { value: 'Reagent / Reactant', label: 'واکنشگر', code: 'REA', fullLabel: 'واکنش‌گر (Reagent)' },
  { value: 'Excipient', label: 'اکسپیانت', code: 'EXP', fullLabel: 'اکسپیانت (Excipient)' },
  { value: 'Packaging Item', label: 'ملزومات بسته‌بندی', code: 'PKG', fullLabel: 'ملزومات بسته‌بندی (Packaging)' },
  { value: 'Other', label: 'سایر موارد', code: 'OTH', fullLabel: 'سایر موارد (Other)' },
];

const pharmacopoeiaOptions: Pharmacopoeia[] = ['USP', 'EP', 'BP', 'JP', 'IP', 'Ph. Eur.', 'ChP', 'In-house', 'Other'];

type SortField = 'nameFa' | 'nameEn' | 'role' | 'finalProduct' | 'cas' | 'pharmacopoeia';
type SortOrder = 'asc' | 'desc';

export const MaterialRepositoryView: React.FC<Props> = ({
  materials,
  onAddMaterial,
  onEditMaterial,
  onDeleteMaterial,
  currentUser,
  db = []
}) => {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<MaterialRole | 'All'>('All');
  const [pharmFilter, setPharmFilter] = useState<Pharmacopoeia | 'All'>('All');
  const [sortField, setSortField] = useState<SortField>('nameFa');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);

  // Custom Deletion States (prevents iframe blocking from window.confirm)
  const [materialToDelete, setMaterialToDelete] = useState<Material | null>(null);
  const [specToDelete, setSpecToDelete] = useState<boolean>(false);

  // Computed connected vendors for data integrity validation
  const connectedVendors = useMemo(() => {
    if (!materialToDelete) return [];
    return db.filter(v => v.materialId === materialToDelete.id);
  }, [materialToDelete, db]);

  // Form State
  const [formData, setFormData] = useState<Partial<Material>>({
    nameFa: '',
    nameEn: '',
    iupac: '',
    cas: '',
    role: 'API',
    finalProduct: '',
    finalProductEn: '',
    pharmacopoeia: 'USP',
    specificationFile: undefined,
  });

  const getRoleInfo = (role?: MaterialRole) => {
    return roleOptions.find(r => r.value === role) || roleOptions[0];
  };

  const generateStandardNameFa = (data: Partial<Material>) => {
    const roleInfo = getRoleInfo(data.role as MaterialRole);
    const nameFaStr = data.nameFa?.trim() || '---';
    const finalProductStr = data.finalProduct?.trim() || '---';
    return `${roleInfo.label} - ${nameFaStr} (برای ${finalProductStr})`;
  };

  const generateStandardNameEn = (data: Partial<Material>) => {
    const roleInfo = getRoleInfo(data.role as MaterialRole);
    const nameEnStr = data.nameEn?.trim() || '---';
    const finalProductEnStr = data.finalProductEn?.trim() || data.finalProduct?.trim() || '---';
    return `${roleInfo.code}-${nameEnStr} (For ${finalProductEnStr})`;
  };

  const handleOpenAdd = () => {
    setFormData({
      nameFa: '',
      nameEn: '',
      iupac: '',
      cas: '',
      role: 'API',
      finalProduct: '',
      finalProductEn: '',
      pharmacopoeia: 'USP',
      specificationFile: undefined,
    });
    setFormError(null);
    setEditingMaterial(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (material: Material) => {
    setFormData({
      id: material.id,
      nameFa: material.nameFa || '',
      nameEn: material.nameEn || '',
      iupac: material.iupac || '',
      cas: material.cas || '',
      role: material.role || 'API',
      finalProduct: material.finalProduct || '',
      finalProductEn: material.finalProductEn || '',
      pharmacopoeia: material.pharmacopoeia || 'USP',
      specificationFile: material.specificationFile || undefined,
    });
    setFormError(null);
    setEditingMaterial(material);
    setIsModalOpen(true);
  };

  const handleOpenView = (material: Material) => {
    setSelectedMaterial(material);
    setIsViewModalOpen(true);
  };

  const handleSave = () => {
    setFormError(null);

    if (!formData.nameFa?.trim() || !formData.nameEn?.trim() || !formData.cas?.trim() || !formData.role || !formData.finalProduct?.trim() || !formData.finalProductEn?.trim() || !formData.pharmacopoeia) {
      setFormError("لطفاً کلیه فیلدهای الزامی ستاره‌دار (نام فارسی، نام لاتین، CAS، نقش ماده، فارماکوپه و محصول نهایی) را تکمیل فرمایید.");
      return;
    }

    const isCasDuplicate = materials.some(m => m.cas?.trim() === formData.cas?.trim() && m.id !== editingMaterial?.id);
    if (isCasDuplicate && formData.cas.trim() !== '' && formData.cas.trim().toLowerCase() !== 'n/a') {
      setFormError("این شماره CAS قبلاً برای ماده دیگری در مخزن ثبت شده است.");
      return;
    }

    const isComboDuplicate = materials.some(m => 
      m.role === formData.role && 
      m.nameEn.toLowerCase().trim() === formData.nameEn?.toLowerCase().trim() && 
      m.finalProductEn?.toLowerCase().trim() === formData.finalProductEn?.toLowerCase().trim() &&
      m.id !== editingMaterial?.id
    );
    if (isComboDuplicate) {
      setFormError("این ترکیب (Role + نام لاتین + محصول نهایی) قبلاً در سامانه ثبت شده است.");
      return;
    }

    const newMaterial: Material = {
      id: editingMaterial ? editingMaterial.id : `mat_${Date.now()}`,
      nameFa: formData.nameFa.trim(),
      nameEn: formData.nameEn.trim(),
      iupac: formData.iupac?.trim() || undefined,
      cas: formData.cas.trim(),
      role: formData.role as MaterialRole,
      finalProduct: formData.finalProduct.trim(),
      finalProductEn: formData.finalProductEn.trim(),
      pharmacopoeia: formData.pharmacopoeia as Pharmacopoeia,
      specificationFile: formData.specificationFile || undefined,
      standardNameFa: generateStandardNameFa(formData),
      standardNameEn: generateStandardNameEn(formData),
      createdAt: editingMaterial ? editingMaterial.createdAt : new Date().toISOString(),
    };

    if (editingMaterial) {
      onEditMaterial(newMaterial);
    } else {
      onAddMaterial(newMaterial);
    }
    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setIsModalOpen(false);
    }, 900);
  };

  const handleDeleteSpec = () => {
    if (selectedMaterial) {
      setSpecToDelete(true);
    }
  };

  const handleReplaceSpec = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedMaterial && e.target.files && e.target.files[0]) {
      const isReplacement = !!selectedMaterial.specificationFile;
      const updated = { ...selectedMaterial, specificationFile: e.target.files[0].name };
      onEditMaterial(updated, isReplacement ? 'Replace Specification' : 'Upload Specification');
      setSelectedMaterial(updated);
    }
  };

  const filteredMaterials = useMemo(() => {
    // Work on a copy so sorting never mutates the parent-owned state array.
    let result = [...materials];

    if (search.trim()) {
      const lowerSearch = search.toLowerCase();
      result = result.filter(m => 
        m.nameFa.toLowerCase().includes(lowerSearch) ||
        m.nameEn.toLowerCase().includes(lowerSearch) ||
        m.cas.toLowerCase().includes(lowerSearch) ||
        m.finalProduct.toLowerCase().includes(lowerSearch)
      );
    }

    if (roleFilter !== 'All') {
      result = result.filter(m => m.role === roleFilter);
    }

    if (pharmFilter !== 'All') {
      result = result.filter(m => m.pharmacopoeia === pharmFilter);
    }

    result.sort((a, b) => {
      let aVal = String(a[sortField]).toLowerCase();
      let bVal = String(b[sortField]).toLowerCase();
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [materials, search, roleFilter, pharmFilter, sortField, sortOrder]);

  const totalPages = Math.ceil(filteredMaterials.length / itemsPerPage);
  const currentData = filteredMaterials.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleDelete = (material: Material) => {
    setMaterialToDelete(material);
  };

  const handleConfirmDeleteSpec = () => {
    if (selectedMaterial) {
      const updated = { ...selectedMaterial, specificationFile: undefined };
      onEditMaterial(updated, 'Delete Specification');
      setSelectedMaterial(updated);
      setSpecToDelete(false);
    }
  };

  const statTotal = materials.length;
  const statAPI = materials.filter(m => m.role === 'API').length;
  const statInt = materials.filter(m => m.role === 'Intermediate').length;
  const statExc = materials.filter(m => m.role === 'Excipient').length;
  const statSol = materials.filter(m => m.role === 'Solvent').length;
  const statRea = materials.filter(m => m.role === 'Reagent / Reactant').length;

  return (
    <div className="w-full flex flex-col gap-6 fade-in pb-10" dir="rtl">
      {/* STATS CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3 transition-all hover:shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 border border-slate-200">
            <Archive className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Materials</div>
            <div className="text-xl font-black text-slate-800 font-mono mt-0.5">{statTotal}</div>
          </div>
        </div>
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3 transition-all hover:shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
            <Pill className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">API (ماده موثره)</div>
            <div className="text-xl font-black text-blue-600 font-mono mt-0.5">{statAPI}</div>
          </div>
        </div>
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3 transition-all hover:shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Intermediate</div>
            <div className="text-xl font-black text-amber-600 font-mono mt-0.5">{statInt}</div>
          </div>
        </div>
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3 transition-all hover:shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Excipient</div>
            <div className="text-xl font-black text-emerald-600 font-mono mt-0.5">{statExc}</div>
          </div>
        </div>
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3 transition-all hover:shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
            <Droplet className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Solvent</div>
            <div className="text-xl font-black text-indigo-600 font-mono mt-0.5">{statSol}</div>
          </div>
        </div>
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3 transition-all hover:shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
            <Beaker className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Reagent / Other</div>
            <div className="text-xl font-black text-rose-600 font-mono mt-0.5">{statRea}</div>
          </div>
        </div>
      </div>

      {/* HEADER & FILTER BAR */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-blue-600 font-mono text-xs uppercase tracking-wider">
            <Database className="w-4 h-4" />
            <span>Material Master Registry</span>
          </div>
          <h1 className="text-xl font-black text-slate-800 tracking-tight">مخزن مرجع مواد اولیه</h1>
          <p className="text-xs text-slate-500">مدیریت مشخصات شیمیایی، نقش دارویی و استانداردهای فارماکوپه‌ای اقلام</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="جستجو (نام فارسی، لاتین، CAS، محصول)..."
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
            />
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <select 
              value={roleFilter} 
              onChange={e => { setRoleFilter(e.target.value as any); setCurrentPage(1); }}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-blue-500 focus:bg-white w-full sm:w-32 transition-colors"
            >
              <option value="All">همه Roleها</option>
              {roleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.value}</option>)}
            </select>
            
            <select 
              value={pharmFilter} 
              onChange={e => { setPharmFilter(e.target.value as any); setCurrentPage(1); }}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 focus:outline-none focus:border-blue-500 focus:bg-white w-full sm:w-36 transition-colors"
            >
              <option value="All">همه فارماکوپه‌ها</option>
              {pharmacopoeiaOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>

          <button
            onClick={handleOpenAdd}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/20 shrink-0 border border-blue-400/30"
          >
            <Plus className="w-4 h-4" />
            <span>ثبت ماده جدید</span>
          </button>
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <th className="py-3.5 px-4 font-bold cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => handleSort('nameFa')}>
                  <div className="flex items-center gap-1.5">
                    <span>نام فارسی ماده</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
                  </div>
                </th>
                <th className="py-3.5 px-4 font-bold cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => handleSort('nameEn')}>
                  <div className="flex items-center gap-1.5">
                    <span>نام لاتین / ژنریک</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
                  </div>
                </th>
                <th className="py-3.5 px-4 font-bold text-center cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => handleSort('role')}>
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Role</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
                  </div>
                </th>
                <th className="py-3.5 px-4 font-bold cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => handleSort('finalProduct')}>
                  <div className="flex items-center gap-1.5">
                    <span>محصول نهایی</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
                  </div>
                </th>
                <th className="py-3.5 px-4 font-bold text-center cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => handleSort('cas')}>
                  <div className="flex items-center justify-center gap-1.5">
                    <span>CAS Number</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
                  </div>
                </th>
                <th className="py-3.5 px-4 font-bold text-center cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => handleSort('pharmacopoeia')}>
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Pharmacopoeia</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
                  </div>
                </th>
                <th className="py-3.5 px-4 font-bold text-center w-28">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentData.length > 0 ? (
                currentData.map(material => (
                  <tr key={material.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-800">{material.nameFa}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600" dir="ltr">{material.nameEn}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold border ${
                        material.role === 'API' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        material.role === 'Intermediate' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        material.role === 'Excipient' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        'bg-slate-100 text-slate-700 border-slate-200'
                      }`}>
                        {material.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{material.finalProduct}</td>
                    <td className="py-3 px-4 text-center font-mono text-xs text-slate-600" dir="ltr">{material.cas}</td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-xs text-slate-700">{material.pharmacopoeia}</td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button 
                          onClick={() => handleOpenView(material)} 
                          className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-100" 
                          title="مشاهده شناسنامه"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => handleOpenEdit(material)} 
                          className="p-1.5 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors border border-amber-100" 
                          title="ویرایش"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {currentUser?.role === 'admin' && (
                          <button 
                            onClick={() => handleDelete(material)} 
                            className="p-1.5 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors border border-rose-100" 
                            title="حذف"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Archive className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <span>هیچ ماده‌ای با مشخصات مورد نظر در مخزن یافت نشد.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* PAGINATION */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredMaterials.length}
            startIndex={(currentPage - 1) * itemsPerPage}
            endIndex={currentPage * itemsPerPage}
            onPageChange={setCurrentPage}
          />
        </div>
      </div>

      {/* CREATE/EDIT MODAL - High Quality Responsive Enterprise Modal with Portal */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 md:p-6 bg-slate-900/60 backdrop-blur-xs overflow-hidden animate-fadeIn">
          <div 
            onClick={() => setIsModalOpen(false)} 
            className="absolute inset-0" 
          />
          
          <div className="relative w-full max-w-4xl max-h-[92vh] h-full sm:h-auto bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-right z-10">
            {isSuccess ? (
              <div className="p-16 text-center flex flex-col items-center justify-center fade-in">
                <div className="bg-emerald-500/10 p-4 rounded-full border border-emerald-500/20 mb-6">
                  <CheckCircle className="w-16 h-16 text-emerald-500 bounce-in" />
                </div>
                <h3 className="text-2xl font-bold text-slate-800 mb-2">
                  {editingMaterial ? 'تغییرات ماده با موفقیت ذخیره شد' : 'ماده اولیه جدید با موفقیت ثبت شد'}
                </h3>
                <p className="text-slate-500 text-xs font-medium">اطلاعات با موفقیت در انبار مرجع مواد ثبت گردید.</p>
              </div>
            ) : (
              <>
                {/* Sticky Top Header */}
                <div className="sticky top-0 z-30 px-6 py-4 border-b border-slate-200 bg-white/95 backdrop-blur-md flex items-center justify-between shrink-0 shadow-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold">
                      <Database className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-black text-slate-800">
                        {editingMaterial ? 'ویرایش ماده اولیه در مخزن مرجع' : 'ثبت ماده اولیه جدید در مخزن مرجع'}
                      </h2>
                      <p className="text-[11px] text-slate-500">تکمیل مشخصات شیمیایی، نقش دارویی و استانداردهای فارماکوپه‌ای</p>
                    </div>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)} 
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                    title="بستن"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                {/* Scrollable Form Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6 focus:outline-none">
                  {formError && (
                    <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-rose-700 text-xs leading-relaxed animate-shake">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                      <div className="flex-1 font-medium">{formError}</div>
                      <button 
                        type="button" 
                        onClick={() => setFormError(null)} 
                        className="text-rose-400 hover:text-rose-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* بخش اول: نام‌گذاری و مشخصات شیمیایی */}
                  <div className="bg-slate-50/60 border border-slate-200/80 rounded-xl p-4 sm:p-5 space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
                      <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">بخش اول: نام‌گذاری و هویت شیمیایی</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 block">
                          نام فارسی ماده <span className="text-rose-500">*</span>
                        </label>
                        <input 
                          type="text" 
                          required
                          value={formData.nameFa || ''} 
                          onChange={e => setFormData({ ...formData, nameFa: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="مثال: استامینوفن"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 block">
                          نام لاتین / ژنریک <span className="text-rose-500">*</span>
                        </label>
                        <input 
                          type="text" 
                          required
                          value={formData.nameEn || ''} 
                          onChange={e => setFormData({ ...formData, nameEn: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs text-left font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="e.g. Paracetamol"
                          dir="ltr"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 block">
                          شماره CAS <span className="text-rose-500">*</span>
                        </label>
                        <input 
                          type="text" 
                          required
                          value={formData.cas || ''} 
                          onChange={e => setFormData({ ...formData, cas: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs text-left font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="103-90-2"
                          dir="ltr"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 block">
                          نام IUPAC (اختیاری)
                        </label>
                        <input 
                          type="text" 
                          value={formData.iupac || ''} 
                          onChange={e => setFormData({ ...formData, iupac: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs text-left font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="N-(4-hydroxyphenyl)ethanamide"
                          dir="ltr"
                        />
                      </div>
                    </div>
                  </div>

                  {/* بخش دوم: طبقه‌بندی و استانداردهای فارماکوپه‌ای */}
                  <div className="bg-slate-50/60 border border-slate-200/80 rounded-xl p-4 sm:p-5 space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
                      <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">بخش دوم: طبقه‌بندی دارویی و فارماکوپه</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 block">
                          نقش ماده (Material Role) <span className="text-rose-500">*</span>
                        </label>
                        <select 
                          value={formData.role || 'API'} 
                          onChange={e => setFormData({ ...formData, role: e.target.value as MaterialRole })} 
                          className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                          {roleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.value} - {opt.fullLabel}</option>)}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 block">
                          فارماکوپه مرجع (Pharmacopoeia) <span className="text-rose-500">*</span>
                        </label>
                        <select 
                          value={formData.pharmacopoeia || 'USP'} 
                          onChange={e => setFormData({ ...formData, pharmacopoeia: e.target.value as Pharmacopoeia })} 
                          className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                          {pharmacopoeiaOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* بخش سوم: محصول نهایی، اسناد فنی و نام‌های استاندارد */}
                  <div className="bg-slate-50/60 border border-slate-200/80 rounded-xl p-4 sm:p-5 space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
                      <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">بخش سوم: محصول نهایی دارویی و فایل مشخصات فنی</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 block">
                          محصول نهایی (فارسی) <span className="text-rose-500">*</span>
                        </label>
                        <input 
                          type="text" 
                          required
                          value={formData.finalProduct || ''} 
                          onChange={e => setFormData({ ...formData, finalProduct: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="مثلاً: قرص استامینوفن ۵۰۰"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 block">
                          محصول نهایی (لاتین) <span className="text-rose-500">*</span>
                        </label>
                        <input 
                          type="text" 
                          required
                          value={formData.finalProductEn || ''} 
                          onChange={e => setFormData({ ...formData, finalProductEn: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs text-left font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="Paracetamol 500mg Tablet"
                          dir="ltr"
                        />
                      </div>
                      
                      <div className="sm:col-span-2 space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 block">فایل پیوست Specification (اختیاری)</label>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 border-dashed rounded-xl text-xs cursor-pointer hover:border-blue-500 hover:text-blue-600 transition-colors text-slate-600 font-medium">
                            <Upload className="w-4 h-4 text-slate-500" />
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
                            <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl border border-blue-200">
                              <FileText className="w-4 h-4" />
                              <span className="text-[11px] font-mono font-bold truncate max-w-[240px]" dir="ltr">
                                {formData.specificationFile}
                              </span>
                              <button 
                                type="button" 
                                onClick={() => setFormData({...formData, specificationFile: undefined})} 
                                className="text-rose-500 hover:text-rose-700 p-0.5"
                                title="حذف فایل"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* پیش‌نمایش نام‌های استاندارد */}
                  <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 sm:p-5 rounded-2xl border border-slate-700 shadow-md space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-700">
                      <Sparkles className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-bold text-slate-200">پیش‌نمایش نام‌های استاندارد تولیدشده در سیستم</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">نام استاندارد فارسی</label>
                        <div className="w-full px-3 py-2 bg-slate-800/90 border border-slate-700 rounded-lg text-xs text-slate-100 font-bold select-all">
                          {generateStandardNameFa(formData)}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Standard English Name</label>
                        <div className="w-full px-3 py-2 bg-slate-800/90 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono font-bold select-all" dir="ltr">
                          {generateStandardNameEn(formData)}
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
                
                {/* Sticky Bottom Footer */}
                <div className="sticky bottom-0 z-30 px-6 py-4 border-t border-slate-200 bg-slate-50/95 backdrop-blur-md flex items-center justify-end gap-3 shrink-0 shadow-xs">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors border border-slate-200 cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button 
                    type="button"
                    onClick={handleSave}
                    className="px-6 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-md shadow-blue-600/20 transition-all active:scale-95 border border-blue-400/30 cursor-pointer"
                  >
                    {editingMaterial ? 'ذخیره تغییرات ماده' : 'ثبت اطلاعات در مخزن'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* VIEW MODAL - Clean Enterprise Detail Viewer with Portal */}
      {isViewModalOpen && selectedMaterial && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 md:p-6 bg-slate-900/60 backdrop-blur-xs overflow-hidden animate-fadeIn">
          <div 
            onClick={() => setIsViewModalOpen(false)} 
            className="absolute inset-0" 
          />
          
          <div className="relative w-full max-w-3xl max-h-[92vh] h-full sm:h-auto bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-right z-10">
            <div className="sticky top-0 z-30 px-6 py-4 border-b border-slate-200 bg-white/95 backdrop-blur-md flex items-center justify-between shrink-0 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-black text-slate-800">جزئیات شناسنامه ماده اولیه</h2>
                  <p className="text-[11px] text-slate-500 font-mono" dir="ltr">{selectedMaterial.id}</p>
                </div>
              </div>
              <button 
                onClick={() => setIsViewModalOpen(false)} 
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                title="بستن"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6 focus:outline-none">
              
              {/* بخش اول – اطلاعات پایه */}
              <div className="bg-slate-50/60 border border-slate-200/80 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">بخش اول: اطلاعات هویت و نام‌گذاری</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3.5 gap-x-6">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">نام فارسی</div>
                    <div className="text-sm font-bold text-slate-800">{selectedMaterial.nameFa}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">نام لاتین / ژنریک</div>
                    <div className="text-sm font-bold font-mono text-slate-800" dir="ltr">{selectedMaterial.nameEn}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">نام IUPAC</div>
                    <div className="text-xs font-mono text-slate-700" dir="ltr">{selectedMaterial.iupac || '-'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">CAS Number</div>
                    <div className="text-sm font-bold font-mono text-slate-800" dir="ltr">{selectedMaterial.cas}</div>
                  </div>
                </div>
              </div>

              {/* بخش دوم – اطلاعات طبقه‌بندی و محصول نهایی */}
              <div className="bg-slate-50/60 border border-slate-200/80 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
                  <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">بخش دوم: طبقه‌بندی دارویی و محصول نهایی</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3.5 gap-x-6">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">نقش ماده (Role)</div>
                    <span className="inline-block px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-xs font-mono font-bold">
                      {selectedMaterial.role}
                    </span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">فارماکوپه مرجع (Pharmacopoeia)</div>
                    <div className="text-sm font-bold font-mono text-slate-800">{selectedMaterial.pharmacopoeia}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">محصول نهایی (فارسی)</div>
                    <div className="text-sm font-bold text-slate-800">{selectedMaterial.finalProduct}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">محصول نهایی (لاتین)</div>
                    <div className="text-sm font-bold font-mono text-slate-800" dir="ltr">{selectedMaterial.finalProductEn}</div>
                  </div>
                </div>
              </div>

              {/* بخش سوم – اطلاعات استاندارد و اسناد فنی */}
              <div className="bg-slate-50/60 border border-slate-200/80 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">بخش سوم: نام‌های استاندارد و اسناد فنی</h3>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">نام استاندارد فارسی</div>
                      <div className="text-xs font-bold text-slate-800">{selectedMaterial.standardNameFa}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Standard English Name</div>
                      <div className="text-xs font-bold font-mono text-slate-800" dir="ltr">{selectedMaterial.standardNameEn}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">فایل پیوست Specification</div>
                    {selectedMaterial.specificationFile ? (
                      <div className="flex items-center justify-between bg-white border border-slate-200 p-3 rounded-xl shadow-xs">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="font-mono text-xs font-bold text-slate-700 truncate max-w-[220px] sm:max-w-[320px]" dir="ltr">
                            {selectedMaterial.specificationFile}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer" title="جایگزینی">
                            <Upload className="w-4 h-4" />
                            <input type="file" className="hidden" onChange={handleReplaceSpec} />
                          </label>
                          <button onClick={handleDeleteSpec} className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="حذف">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 bg-white border border-slate-200 border-dashed rounded-xl">
                        <div className="text-xs font-bold text-slate-400 font-mono mb-2">No Specification Uploaded</div>
                        <label className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors shadow-xs">
                          <Upload className="w-4 h-4" />
                          <span>آپلود فایل جدید</span>
                          <input type="file" className="hidden" onChange={handleReplaceSpec} />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            <div className="sticky bottom-0 z-30 px-6 py-4 border-t border-slate-200 bg-slate-50/95 backdrop-blur-md flex items-center justify-end shrink-0 shadow-xs">
              <button
                onClick={() => setIsViewModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs transition-colors cursor-pointer"
              >
                بستن
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* CUSTOM MATERIAL DELETE MODAL with Portal */}
      {materialToDelete && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div onClick={() => setMaterialToDelete(null)} className="absolute inset-0" />
          
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 border border-slate-200 z-10 text-right">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0 border border-rose-100">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-black text-slate-800">حذف ماده اولیه</h3>
            </div>

            <div className="space-y-4">
              {connectedVendors.length > 0 ? (
                <>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs leading-relaxed">
                    <strong>خطای یکپارچگی داده‌ها (ALCOA+):</strong> امکان حذف این ماده به علت وجود وابستگی در سورس‌های فعال وجود ندارد. ابتدا باید وابستگی سورس‌های زیر را برطرف نمایید:
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl p-2 bg-slate-50">
                    {connectedVendors.map(vendor => (
                      <div key={vendor.id} className="py-2 px-2 text-xs text-slate-700 flex justify-between items-center">
                        <span className="font-bold">{vendor.name}</span>
                        <span className="font-mono bg-slate-200/70 px-2 py-0.5 rounded text-[10px] text-slate-700">
                          {vendor.category === 'sample' ? 'نمونه' : vendor.category}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end pt-2">
                    <button 
                      onClick={() => setMaterialToDelete(null)} 
                      className="w-full sm:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                    >
                      متوجه شدم
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    آیا از حذف ماده اولیه <span className="font-bold text-slate-800">«{materialToDelete.nameFa}» ({materialToDelete.nameEn})</span> اطمینان دارید؟ 
                    این عمل غیرقابل بازگشت بوده و تمامی اطلاعات مربوط به این ماده از سیستم حذف خواهد شد.
                  </p>
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button 
                      onClick={() => setMaterialToDelete(null)} 
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all border border-slate-200"
                    >
                      انصراف
                    </button>
                    <button 
                      onClick={() => {
                        onDeleteMaterial(materialToDelete.id);
                        setMaterialToDelete(null);
                      }} 
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-600/20"
                    >
                      تایید و حذف نهایی
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* CUSTOM SPEC FILE DELETE MODAL with Portal */}
      {specToDelete && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div onClick={() => setSpecToDelete(false)} className="absolute inset-0" />
          
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 border border-slate-200 z-10 text-right">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0 border border-rose-100">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="text-base font-black text-slate-800">حذف فایل پیوست Specification</h3>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                آیا از حذف فایل پیوست مشخصات فنی (Specification) این ماده اطمینان دارید؟
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button 
                  onClick={() => setSpecToDelete(false)} 
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all border border-slate-200"
                >
                  انصراف
                </button>
                <button 
                  onClick={handleConfirmDeleteSpec} 
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-600/20"
                >
                  تایید حذف فایل
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
