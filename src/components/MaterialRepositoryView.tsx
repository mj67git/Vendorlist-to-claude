import React, { useState, useMemo } from 'react';
import { FormModal } from './FormModal';
import {
  Search, Plus, Edit2, Trash2, Eye, X, Upload, ArrowUpDown, ArrowUp, ArrowDown,
  FileText, Database, Layers, Pill, FlaskConical, Droplet, Beaker,
  Archive, CheckCircle, AlertCircle, Sparkles, Package, Tag, Factory
} from 'lucide-react';
import { Material, MaterialRole, Pharmacopoeia, User, Vendor } from '../types';
import { Pagination } from './Pagination';
import { can } from '../utils/permissions';
import { categoryLabels } from '../constants/categories';
import { MATERIAL_ROLES, getMaterialRole, roleOptionLabel } from '../constants/materialRoles';

interface Props {
  materials: Material[];
  onAddMaterial: (material: Material) => void;
  onEditMaterial: (material: Material, customAction?: string) => void;
  onDeleteMaterial: (id: string) => void;
  currentUser: User | null;
  db?: Vendor[];
}

const pharmacopoeiaOptions: Pharmacopoeia[] = ['USP', 'EP', 'BP', 'JP', 'IP', 'Ph. Eur.', 'ChP', 'In-house', 'Other'];

type SortField = 'nameFa' | 'nameEn' | 'role' | 'finalProduct' | 'cas' | 'pharmacopoeia' | 'sources';
type SortOrder = 'asc' | 'desc';

/** Icon per role, in the order of the role table. */
const ROLE_ICONS: Record<MaterialRole, React.ComponentType<{ className?: string }>> = {
  'API': Pill,
  'Intermediate': FlaskConical,
  'Solvent': Droplet,
  'Reagent / Reactant': Beaker,
  'Excipient': Layers,
  'Packaging Item': Package,
  'Other': Tag,
};

/**
 * Persian sorts by its own alphabet, not by code point: a plain `<` puts «آ»
 * after «ی». `Intl` knows the order; the numeric option also keeps CAS numbers
 * in human order.
 */
const collator = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });

/**
 * A sortable column header that says which column is sorted and in which
 * direction — the old headers showed the same neutral glyph on all six, so the
 * table could be sorted without the user being able to tell by what.
 */
const SortHeader: React.FC<{
  field: SortField;
  label: string;
  center?: boolean;
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (f: SortField) => void;
}> = ({ field, label, center, sortField, sortOrder, onSort }) => {
  const active = sortField === field;
  const Icon = !active ? ArrowUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={`py-3.5 px-4 font-bold cursor-pointer hover:bg-accent transition-colors ${active ? 'text-foreground' : ''}`}
      aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort(field)}
    >
      <div className={`flex items-center gap-1.5 ${center ? 'justify-center' : ''}`}>
        <span>{label}</span>
        <Icon className={`w-3 h-3 shrink-0 ${active ? 'text-foreground' : 'text-muted-foreground'}`} />
      </div>
    </th>
  );
};

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

  /**
   * Sources per material id.
   *
   * The server blocks a delete on `vendorMaterial` rows (server.ts, DELETE
   * /api/materials/:id) and is the authority. This mirrors that count from the
   * data the client already holds so the number can be shown in the table and
   * the confirmation can be honest — a source with no `materialId` of its own
   * is matched on its substance, the same way `resolveMaterialNames` does,
   * because those are exactly the legacy rows whose link the client cannot see.
   */
  const vendorsByMaterial = useMemo(() => {
    const eq = (a?: string | null, b?: string | null) =>
      !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
    const isRealCas = (c?: string | null) => !!c && !['n/a', 'na', '-', ''].includes(c.trim().toLowerCase());

    const map = new Map<string, Vendor[]>();
    for (const v of db) {
      const material = v.materialId
        ? materials.find(m => m.id === v.materialId)
        : materials.find(m =>
            eq(m.nameFa, v.material) || eq(m.nameEn, v.materialEn) || (eq(m.cas, v.cas) && isRealCas(m.cas)));
      if (!material) continue;
      map.set(material.id, [...(map.get(material.id) || []), v]);
    }
    return map;
  }, [db, materials]);

  const connectedVendors = materialToDelete ? vendorsByMaterial.get(materialToDelete.id) || [] : [];

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
      // The standard names are what the rest of the app shows, so searching for
      // «حلال - استون …» has to find the row it names.
      const haystack = (m: Material) =>
        [m.nameFa, m.nameEn, m.cas, m.finalProduct, m.finalProductEn, m.standardNameFa, m.standardNameEn, m.iupac]
          .filter(Boolean).join(' ').toLowerCase();
      result = result.filter(m => haystack(m).includes(lowerSearch));
    }

    if (roleFilter !== 'All') {
      result = result.filter(m => m.role === roleFilter);
    }

    if (pharmFilter !== 'All') {
      result = result.filter(m => m.pharmacopoeia === pharmFilter);
    }

    const dir = sortOrder === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      if (sortField === 'sources') {
        return dir * ((vendorsByMaterial.get(a.id)?.length || 0) - (vendorsByMaterial.get(b.id)?.length || 0));
      }
      // The role sorts by its label, which is what the column actually shows.
      const value = (m: Material) =>
        sortField === 'role' ? getMaterialRole(m.role).labelEn : String(m[sortField] ?? '');
      return dir * collator.compare(value(a), value(b));
    });

    return result;
  }, [materials, search, roleFilter, pharmFilter, sortField, sortOrder, vendorsByMaterial]);

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

  /**
   * One card per role, counted through `getMaterialRole` so a legacy spelling
   * lands in its own bucket. Every material falls into exactly one card, so the
   * seven add up to the total — the old five-card row silently dropped
   * `Packaging Item` and `Other`, and labelled the Reagent card "Reagent /
   * Other" while counting only Reagent.
   */
  const roleCounts = useMemo(() => {
    const counts = new Map<MaterialRole, number>(MATERIAL_ROLES.map(r => [r.value, 0]));
    for (const m of materials) {
      const role = getMaterialRole(m.role).value;
      counts.set(role, (counts.get(role) || 0) + 1);
    }
    return counts;
  }, [materials]);

  return (
    <div className="w-full flex flex-col gap-6 fade-in pb-10" dir="rtl">
      {/* STATS CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div className="bg-card p-3 sm:p-4 rounded-xl border border-border shadow-xs flex items-center gap-3 transition-all hover:shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-muted text-foreground flex items-center justify-center shrink-0 border border-border">
            <Archive className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">مجموع مواد</div>
            <div className="text-xl font-black text-foreground font-mono mt-0.5">{materials.length}</div>
          </div>
        </div>
        {MATERIAL_ROLES.map(role => {
          const Icon = ROLE_ICONS[role.value];
          return (
            <div key={role.value} className="bg-card p-3 sm:p-4 rounded-xl border border-border shadow-xs flex items-center gap-3 transition-all hover:shadow-sm">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${role.tone}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-muted-foreground tracking-wider truncate">
                  {role.labelEn} <span className="font-normal">({role.labelFa})</span>
                </div>
                <div className="text-xl font-black text-foreground font-mono mt-0.5">{roleCounts.get(role.value) || 0}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* HEADER & FILTER BAR */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-card p-5 sm:p-6 rounded-2xl border border-border shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-mono text-xs uppercase tracking-wider">
            <Database className="w-4 h-4" />
            <span>Material Master Registry</span>
          </div>
          <h1 className="text-xl font-black text-foreground tracking-tight">مخزن مرجع مواد اولیه</h1>
          <p className="text-xs text-muted-foreground">مدیریت مشخصات شیمیایی، نقش دارویی و استانداردهای فارماکوپه‌ای اقلام</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="جستجو (نام فارسی، لاتین، CAS، محصول)..."
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              className="w-full bg-muted border border-border rounded-xl pr-9 pl-3 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500 focus:bg-card transition-colors"
            />
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <select 
              value={roleFilter} 
              onChange={e => { setRoleFilter(e.target.value as any); setCurrentPage(1); }}
              className="px-3 py-2 bg-muted border border-border rounded-xl text-xs text-foreground focus:outline-none focus:border-blue-500 focus:bg-card w-full sm:w-32 transition-colors"
            >
              <option value="All">همه نقش‌ها</option>
              {MATERIAL_ROLES.map(opt => <option key={opt.value} value={opt.value}>{roleOptionLabel(opt)}</option>)}
            </select>
            
            <select 
              value={pharmFilter} 
              onChange={e => { setPharmFilter(e.target.value as any); setCurrentPage(1); }}
              className="px-3 py-2 bg-muted border border-border rounded-xl text-xs font-mono text-foreground focus:outline-none focus:border-blue-500 focus:bg-card w-full sm:w-36 transition-colors"
            >
              <option value="All">همه فارماکوپه‌ها</option>
              {pharmacopoeiaOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>

          {can(currentUser, 'material.create') && (
            <button
              onClick={handleOpenAdd}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/20 shrink-0 border border-blue-400/30"
            >
              <Plus className="w-4 h-4" />
              <span>ثبت ماده جدید</span>
            </button>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-card rounded-2xl border border-border shadow-xs overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-muted text-muted-foreground border-b border-border">
                <SortHeader field="nameFa" label="نام فارسی ماده" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="nameEn" label="نام لاتین / ژنریک" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="role" label="نقش ماده" center sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="finalProduct" label="محصول نهایی" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="cas" label="CAS Number" center sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="pharmacopoeia" label="Pharmacopoeia" center sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="sources" label="سورس‌های مرتبط" center sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <th className="py-3.5 px-4 font-bold text-center w-28">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {currentData.length > 0 ? (
                currentData.map(material => {
                  const role = getMaterialRole(material.role);
                  const sourceCount = vendorsByMaterial.get(material.id)?.length || 0;
                  return (
                  <tr key={material.id} className="hover:bg-accent/70 transition-colors">
                    <td className="py-3 px-4 font-bold text-foreground">{material.nameFa}</td>
                    <td className="py-3 px-4 font-mono text-xs text-muted-foreground" dir="ltr">{material.nameEn}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold border ${role.tone}`}>
                        {role.labelEn} <span className="font-normal">· {role.labelFa}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-foreground">{material.finalProduct}</td>
                    <td className="py-3 px-4 text-center font-mono text-xs text-muted-foreground" dir="ltr">{material.cas}</td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-xs text-foreground">{material.pharmacopoeia}</td>
                    <td className="py-3 px-4 text-center">
                      {/* The number that decides whether this row can be deleted. */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                          sourceCount > 0
                            ? 'bg-muted text-foreground border-border'
                            : 'text-muted-foreground border-transparent'
                        }`}
                        title={sourceCount > 0 ? 'تا وقتی سورسی به این ماده وصل است، حذف ممکن نیست.' : 'هیچ سورسی به این ماده وصل نیست.'}
                      >
                        <Factory className="w-3 h-3 shrink-0" />
                        <span className="font-mono">{sourceCount}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button 
                          onClick={() => handleOpenView(material)} 
                          className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 border-blue-100 dark:text-blue-300 dark:bg-blue-950/50 dark:hover:bg-blue-900/60 dark:border-blue-900 rounded-lg transition-colors border" 
                          title="مشاهده شناسنامه"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {can(currentUser, 'material.edit') && (
                          <button
                            onClick={() => handleOpenEdit(material)}
                            className="p-1.5 text-amber-600 bg-amber-50 hover:bg-amber-100 border-amber-100 dark:text-amber-300 dark:bg-amber-950/50 dark:hover:bg-amber-900/60 dark:border-amber-900 rounded-lg transition-colors border"
                            title="ویرایش"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {can(currentUser, 'material.delete') && (
                          <button 
                            onClick={() => handleDelete(material)} 
                            className="p-1.5 text-rose-600 bg-rose-50 hover:bg-rose-100 border-rose-100 dark:text-rose-300 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 dark:border-rose-900 rounded-lg transition-colors border" 
                            title="حذف"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    <Archive className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                    <span>هیچ ماده‌ای با مشخصات مورد نظر در مخزن یافت نشد.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* PAGINATION */}
        <div className="px-6 py-3 border-t border-border bg-muted/50">
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
      <FormModal open={isModalOpen} onClose={() => setIsModalOpen(false)} size="lg" ariaLabel="فرم ماده اولیه">
            {isSuccess ? (
              <div className="p-16 text-center flex flex-col items-center justify-center fade-in">
                <div className="bg-emerald-500/10 p-4 rounded-full border border-emerald-500/20 mb-6">
                  <CheckCircle className="w-16 h-16 text-emerald-500 bounce-in" />
                </div>
                <h3 className="text-2xl font-bold text-foreground mb-2">
                  {editingMaterial ? 'تغییرات ماده با موفقیت ذخیره شد' : 'ماده اولیه جدید با موفقیت ثبت شد'}
                </h3>
                <p className="text-muted-foreground text-xs font-medium">اطلاعات با موفقیت در انبار مرجع مواد ثبت گردید.</p>
              </div>
            ) : (
              <>
                {/* Sticky Top Header */}
                <div className="sticky top-0 z-30 px-6 py-4 border-b border-border bg-card/95 backdrop-blur-md flex items-center justify-between shrink-0 shadow-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900 border flex items-center justify-center font-bold">
                      <Database className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-black text-foreground">
                        {editingMaterial ? 'ویرایش ماده اولیه در مخزن مرجع' : 'ثبت ماده اولیه جدید در مخزن مرجع'}
                      </h2>
                      <p className="text-[11px] text-muted-foreground">تکمیل مشخصات شیمیایی، نقش دارویی و استانداردهای فارماکوپه‌ای</p>
                    </div>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)} 
                    className="p-2 text-muted-foreground hover:text-muted-foreground hover:bg-accent rounded-xl transition-colors cursor-pointer"
                    title="بستن"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                {/* Scrollable Form Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6 focus:outline-none">
                  {formError && (
                    <div className="p-3.5 bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/50 dark:border-rose-900 dark:text-rose-200 border rounded-xl flex items-start gap-2.5 text-xs leading-relaxed fade-in">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-300" />
                      <div className="flex-1 font-medium">{formError}</div>
                      <button 
                        type="button" 
                        onClick={() => setFormError(null)} 
                        className="text-rose-400 hover:text-rose-600 dark:hover:text-rose-200"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* بخش اول: نام‌گذاری و مشخصات شیمیایی */}
                  <div className="bg-muted/60 border border-border/80 rounded-xl p-4 sm:p-5 space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400"></span>
                      <h3 className="text-xs font-black text-foreground uppercase tracking-wide">بخش اول: نام‌گذاری و هویت شیمیایی</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          نام فارسی ماده <span className="text-rose-500 dark:text-rose-400">*</span>
                        </label>
                        <input 
                          type="text" 
                          required
                          value={formData.nameFa || ''} 
                          onChange={e => setFormData({ ...formData, nameFa: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="مثال: استامینوفن"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          نام لاتین / ژنریک <span className="text-rose-500 dark:text-rose-400">*</span>
                        </label>
                        <input 
                          type="text" 
                          required
                          value={formData.nameEn || ''} 
                          onChange={e => setFormData({ ...formData, nameEn: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-xs text-left font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="e.g. Paracetamol"
                          dir="ltr"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          شماره CAS <span className="text-rose-500 dark:text-rose-400">*</span>
                        </label>
                        <input 
                          type="text" 
                          required
                          value={formData.cas || ''} 
                          onChange={e => setFormData({ ...formData, cas: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-xs text-left font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="103-90-2"
                          dir="ltr"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          نام IUPAC (اختیاری)
                        </label>
                        <input 
                          type="text" 
                          value={formData.iupac || ''} 
                          onChange={e => setFormData({ ...formData, iupac: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-xs text-left font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="N-(4-hydroxyphenyl)ethanamide"
                          dir="ltr"
                        />
                      </div>
                    </div>
                  </div>

                  {/* بخش دوم: طبقه‌بندی و استانداردهای فارماکوپه‌ای */}
                  <div className="bg-muted/60 border border-border/80 rounded-xl p-4 sm:p-5 space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400"></span>
                      <h3 className="text-xs font-black text-foreground uppercase tracking-wide">بخش دوم: طبقه‌بندی دارویی و فارماکوپه</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          نقش ماده (Material Role) <span className="text-rose-500 dark:text-rose-400">*</span>
                        </label>
                        <select 
                          value={formData.role || 'API'} 
                          onChange={e => setFormData({ ...formData, role: e.target.value as MaterialRole })} 
                          className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                          {MATERIAL_ROLES.map(opt => <option key={opt.value} value={opt.value}>{roleOptionLabel(opt)}</option>)}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          فارماکوپه مرجع (Pharmacopoeia) <span className="text-rose-500 dark:text-rose-400">*</span>
                        </label>
                        <select 
                          value={formData.pharmacopoeia || 'USP'} 
                          onChange={e => setFormData({ ...formData, pharmacopoeia: e.target.value as Pharmacopoeia })} 
                          className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                          {pharmacopoeiaOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* بخش سوم: محصول نهایی، اسناد فنی و نام‌های استاندارد */}
                  <div className="bg-muted/60 border border-border/80 rounded-xl p-4 sm:p-5 space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400"></span>
                      <h3 className="text-xs font-black text-foreground uppercase tracking-wide">بخش سوم: محصول نهایی دارویی و فایل مشخصات فنی</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          محصول نهایی (فارسی) <span className="text-rose-500 dark:text-rose-400">*</span>
                        </label>
                        <input 
                          type="text" 
                          required
                          value={formData.finalProduct || ''} 
                          onChange={e => setFormData({ ...formData, finalProduct: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="مثلاً: قرص استامینوفن ۵۰۰"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          محصول نهایی (لاتین) <span className="text-rose-500 dark:text-rose-400">*</span>
                        </label>
                        <input 
                          type="text" 
                          required
                          value={formData.finalProductEn || ''} 
                          onChange={e => setFormData({ ...formData, finalProductEn: e.target.value })} 
                          className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-xs text-left font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          placeholder="Paracetamol 500mg Tablet"
                          dir="ltr"
                        />
                      </div>
                      
                      <div className="sm:col-span-2 space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">فایل پیوست Specification (اختیاری)</label>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center justify-center gap-2 px-4 py-2 bg-card border border-border border-dashed rounded-xl text-xs cursor-pointer hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-300 transition-colors text-muted-foreground font-medium">
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
                            <div className="flex items-center gap-2 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-900 px-3 py-1.5 rounded-xl border">
                              <FileText className="w-4 h-4" />
                              <span className="text-[11px] font-mono font-bold truncate max-w-[240px]" dir="ltr">
                                {formData.specificationFile}
                              </span>
                              <button 
                                type="button" 
                                onClick={() => setFormData({...formData, specificationFile: undefined})} 
                                className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 p-0.5"
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
                  {/* Inverted on purpose: this is system output, not an input, and it has to
                      read that way in both themes. `foreground`/`background` swap
                      together, unlike the fixed slate gradient that used to be
                      here — which vanished into a dark page. */}
                  <div className="bg-foreground text-background p-4 sm:p-5 rounded-2xl border border-border shadow-md space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-background/20">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      <span className="text-xs font-bold">پیش‌نمایش نام‌های استاندارد تولیدشده در سیستم</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-background/70 uppercase tracking-wider block">نام استاندارد فارسی</label>
                        <div className="w-full px-3 py-2 bg-background/10 border border-background/20 rounded-lg text-xs font-bold select-all">
                          {generateStandardNameFa(formData)}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-background/70 uppercase tracking-wider block">Standard English Name</label>
                        <div className="w-full px-3 py-2 bg-background/10 border border-background/20 rounded-lg text-xs font-mono font-bold select-all" dir="ltr">
                          {generateStandardNameEn(formData)}
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
                
                {/* Sticky Bottom Footer */}
                <div className="sticky bottom-0 z-30 px-6 py-4 border-t border-border bg-muted/95 backdrop-blur-md flex items-center justify-end gap-3 shrink-0 shadow-xs">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-accent rounded-xl transition-colors border border-border cursor-pointer"
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
      </FormModal>

      {/* VIEW MODAL - Clean Enterprise Detail Viewer with Portal */}
      <FormModal open={!!(isViewModalOpen && selectedMaterial)} onClose={() => setIsViewModalOpen(false)} size="lg" ariaLabel="جزئیات ماده اولیه">
        {selectedMaterial && (<>
            <div className="sticky top-0 z-30 px-6 py-4 border-b border-border bg-card/95 backdrop-blur-md flex items-center justify-between shrink-0 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900 border flex items-center justify-center font-bold">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-black text-foreground">جزئیات شناسنامه ماده اولیه</h2>
                  <p className="text-[11px] text-muted-foreground font-mono" dir="ltr">{selectedMaterial.id}</p>
                </div>
              </div>
              <button 
                onClick={() => setIsViewModalOpen(false)} 
                className="p-2 text-muted-foreground hover:text-muted-foreground hover:bg-accent rounded-xl transition-colors cursor-pointer"
                title="بستن"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6 focus:outline-none">
              
              {/* بخش اول – اطلاعات پایه */}
              <div className="bg-muted/60 border border-border/80 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400"></span>
                  <h3 className="text-xs font-black text-foreground uppercase tracking-wide">بخش اول: اطلاعات هویت و نام‌گذاری</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3.5 gap-x-6">
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">نام فارسی</div>
                    <div className="text-sm font-bold text-foreground">{selectedMaterial.nameFa}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">نام لاتین / ژنریک</div>
                    <div className="text-sm font-bold font-mono text-foreground" dir="ltr">{selectedMaterial.nameEn}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">نام IUPAC</div>
                    <div className="text-xs font-mono text-foreground" dir="ltr">{selectedMaterial.iupac || '-'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">CAS Number</div>
                    <div className="text-sm font-bold font-mono text-foreground" dir="ltr">{selectedMaterial.cas}</div>
                  </div>
                </div>
              </div>

              {/* بخش دوم – اطلاعات طبقه‌بندی و محصول نهایی */}
              <div className="bg-muted/60 border border-border/80 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400"></span>
                  <h3 className="text-xs font-black text-foreground uppercase tracking-wide">بخش دوم: طبقه‌بندی دارویی و محصول نهایی</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3.5 gap-x-6">
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">نقش ماده (Role)</div>
                    <span className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-bold border ${getMaterialRole(selectedMaterial.role).tone}`}>
                      {getMaterialRole(selectedMaterial.role).labelEn} <span className="font-normal">· {getMaterialRole(selectedMaterial.role).labelFa}</span>
                    </span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">فارماکوپه مرجع (Pharmacopoeia)</div>
                    <div className="text-sm font-bold font-mono text-foreground">{selectedMaterial.pharmacopoeia}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">محصول نهایی (فارسی)</div>
                    <div className="text-sm font-bold text-foreground">{selectedMaterial.finalProduct}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">محصول نهایی (لاتین)</div>
                    <div className="text-sm font-bold font-mono text-foreground" dir="ltr">{selectedMaterial.finalProductEn}</div>
                  </div>
                </div>
              </div>

              {/* بخش سوم – اطلاعات استاندارد و اسناد فنی */}
              <div className="bg-muted/60 border border-border/80 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400"></span>
                  <h3 className="text-xs font-black text-foreground uppercase tracking-wide">بخش سوم: نام‌های استاندارد و اسناد فنی</h3>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-card border border-border rounded-xl space-y-3">
                    <div>
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">نام استاندارد فارسی</div>
                      <div className="text-xs font-bold text-foreground">{selectedMaterial.standardNameFa}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Standard English Name</div>
                      <div className="text-xs font-bold font-mono text-foreground" dir="ltr">{selectedMaterial.standardNameEn}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">فایل پیوست Specification</div>
                    {selectedMaterial.specificationFile ? (
                      <div className="flex items-center justify-between bg-card border border-border p-3 rounded-xl shadow-xs">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900 flex items-center justify-center border">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="font-mono text-xs font-bold text-foreground truncate max-w-[220px] sm:max-w-[320px]" dir="ltr">
                            {selectedMaterial.specificationFile}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="p-2 text-amber-600 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 rounded-lg transition-colors cursor-pointer" title="جایگزینی">
                            <Upload className="w-4 h-4" />
                            <input type="file" className="hidden" onChange={handleReplaceSpec} />
                          </label>
                          <button onClick={handleDeleteSpec} className="p-2 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors" title="حذف">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 bg-card border border-border border-dashed rounded-xl">
                        <div className="text-xs font-bold text-muted-foreground font-mono mb-2">No Specification Uploaded</div>
                        <label className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-lg text-xs font-bold text-muted-foreground cursor-pointer hover:bg-accent transition-colors shadow-xs">
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

            <div className="sticky bottom-0 z-30 px-6 py-4 border-t border-border bg-muted/95 backdrop-blur-md flex items-center justify-end shrink-0 shadow-xs">
              <button
                onClick={() => setIsViewModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-muted hover:bg-accent border border-border text-foreground font-bold text-xs transition-colors cursor-pointer"
              >
                بستن
              </button>
            </div>
</>)}
      </FormModal>

      {/* CUSTOM MATERIAL DELETE MODAL with Portal */}
      <FormModal open={!!materialToDelete} onClose={() => setMaterialToDelete(null)} size="sm" className="p-6" ariaLabel="تأیید حذف ماده اولیه">
        {materialToDelete && (<>
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-300 mb-4">
              <div className="w-10 h-10 rounded-full bg-rose-50 border-rose-100 dark:bg-rose-950/50 dark:border-rose-900 flex items-center justify-center shrink-0 border">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-black text-foreground">حذف ماده اولیه</h3>
            </div>

            <div className="space-y-4">
              {connectedVendors.length > 0 ? (
                <>
                  <div className="p-3 bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-900 dark:text-amber-200 border rounded-xl text-xs leading-relaxed">
                    <strong>خطای یکپارچگی داده‌ها (ALCOA+):</strong> امکان حذف این ماده به علت وجود وابستگی در سورس‌های فعال وجود ندارد. ابتدا باید وابستگی سورس‌های زیر را برطرف نمایید:
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-border border border-border rounded-xl p-2 bg-muted">
                    {connectedVendors.map(vendor => (
                      <div key={vendor.id} className="py-2 px-2 text-xs text-foreground flex justify-between items-center">
                        <span className="font-bold">{vendor.name}</span>
                        <span className="font-mono bg-background border border-border px-2 py-0.5 rounded text-[10px] text-foreground">
                          {categoryLabels[vendor.category as keyof typeof categoryLabels]?.fa || vendor.category}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end pt-2">
                    <button 
                      onClick={() => setMaterialToDelete(null)} 
                      className="w-full sm:w-auto px-4 py-2 bg-muted hover:bg-accent border border-border text-foreground rounded-xl text-xs font-bold transition-all"
                    >
                      متوجه شدم
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    آیا از حذف ماده اولیه <span className="font-bold text-foreground">«{materialToDelete.nameFa}» ({materialToDelete.nameEn})</span> اطمینان دارید؟ 
                    این عمل غیرقابل بازگشت بوده و تمامی اطلاعات مربوط به این ماده از سیستم حذف خواهد شد.
                  </p>
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button 
                      onClick={() => setMaterialToDelete(null)} 
                      className="px-4 py-2 bg-muted hover:bg-accent text-foreground rounded-xl text-xs font-bold transition-all border border-border"
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
</>)}
      </FormModal>

      {/* CUSTOM SPEC FILE DELETE MODAL with Portal */}
      <FormModal open={!!specToDelete} onClose={() => setSpecToDelete(false)} size="sm" className="p-6" ariaLabel="تأیید حذف فایل Specification">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-300 mb-4">
              <div className="w-10 h-10 rounded-full bg-rose-50 border-rose-100 dark:bg-rose-950/50 dark:border-rose-900 flex items-center justify-center shrink-0 border">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="text-base font-black text-foreground">حذف فایل پیوست Specification</h3>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                آیا از حذف فایل پیوست مشخصات فنی (Specification) این ماده اطمینان دارید؟
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button 
                  onClick={() => setSpecToDelete(false)} 
                  className="px-4 py-2 bg-muted hover:bg-accent text-foreground rounded-xl text-xs font-bold transition-all border border-border"
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
      </FormModal>
    </div>
  );
};
