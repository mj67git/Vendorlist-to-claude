import React, { useState, useMemo, useEffect } from 'react';
import { Button } from './ui/button';
import { FormModal } from './FormModal';
import {
  Search, Plus, Edit2, Trash2, Eye, X, Upload, Download, FileText, Database, Layers, Pill, FlaskConical, Droplet, Beaker,
  Archive, CheckCircle, AlertCircle, Sparkles, Package, Tag, Factory
} from 'lucide-react';
import { Material, MaterialRole, Pharmacopoeia, User, Vendor } from '../types';
import { Pagination } from './Pagination';
import { EntityName } from './EntityName';
import { findDuplicateMaterial } from '../utils/materialDuplicates';
import { useDirtySnapshot } from '../utils/useDirtySnapshot';
import { authFetch, isLocalMode } from '../services/authFetch';
import { openDocumentPreview } from '../utils/documentPreview';
import { can } from '../utils/permissions';
import { categoryLabels } from '../constants/categories';
import { MATERIAL_ROLES, getMaterialRole, roleOptionLabel } from '../constants/materialRoles';
import { Input, inputBaseClass } from './ui/input';
import { cn } from '../lib/utils';
import { SortHeader } from './ui/sort-header';
import { TableEmptyRow } from './ui/table-empty-row';
import { PageTitle } from './ui/page-title';

interface Props {
  materials: Material[];
  onAddMaterial: (material: Material) => void;
  onEditMaterial: (material: Material, customAction?: string) => void;
  onDeleteMaterial: (id: string) => void;
  currentUser: User | null;
  db?: Vendor[];
  /** True while the first fetch is still in flight — the table shows skeletons
      instead of claiming the repository is empty. */
  isLoading?: boolean;
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

/** Mirrors MAX_SPECIFICATION_BYTES on the server (express.json caps at 10mb and
 *  a data URL is ~33% larger than the file). */
const MAX_SPEC_BYTES = 7 * 1024 * 1024;

const formatFileSize = (bytes?: number) => {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
};


export const MaterialRepositoryView: React.FC<Props> = ({
  materials,
  onAddMaterial,
  onEditMaterial,
  onDeleteMaterial,
  currentUser,
  db = [],
  isLoading = false
}) => {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<MaterialRole | 'All'>('All');
  const [pharmFilter, setPharmFilter] = useState<Pharmacopoeia | 'All'>('All');
  const [sortField, setSortField] = useState<SortField>('nameFa');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  /** What this sitting has produced, for the "save and add next" flow. */
  const [savedCount, setSavedCount] = useState(0);
  const [recentlySaved, setRecentlySaved] = useState<string[]>([]);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);

  // Custom Deletion States (prevents iframe blocking from window.confirm)
  const [materialToDelete, setMaterialToDelete] = useState<Material | null>(null);
  const [specToDelete, setSpecToDelete] = useState<boolean>(false);
  const [specBusy, setSpecBusy] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  /** A file chosen while creating a material, uploaded once the record exists. */
  const [pendingSpecFile, setPendingSpecFile] = useState<File | null>(null);

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

  // A picked Specification file lives outside `formData`, so it is reported
  // separately — losing an attachment silently is the costlier half of losing
  // this form.
  const materialFormDirty = useDirtySnapshot(isModalOpen, formData, () => !!pendingSpecFile);

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
    setPendingSpecFile(null);
    setFormError(null);
    setEditingMaterial(null);
    setSavedCount(0);
    setRecentlySaved([]);
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
    setPendingSpecFile(null);
    setFormError(null);
    setEditingMaterial(material);
    setIsModalOpen(true);
  };

  const handleOpenView = (material: Material) => {
    setSpecError(null);
    setSelectedMaterial(material);
    setIsViewModalOpen(true);
  };

  const handleSave = (keepGoing = false) => {
    setFormError(null);

    if (!formData.nameFa?.trim() || !formData.nameEn?.trim() || !formData.cas?.trim() || !formData.role || !formData.finalProduct?.trim() || !formData.finalProductEn?.trim() || !formData.pharmacopoeia) {
      setFormError("لطفاً کلیه فیلدهای الزامی ستاره‌دار (نام فارسی، نام لاتین، CAS، نقش ماده، فارماکوپه و محصول نهایی) را تکمیل فرمایید.");
      return;
    }

    // The same rule the server enforces (409), so the form cannot promise
    // something the endpoint will refuse — or refuse what it would allow.
    const duplicate = findDuplicateMaterial(
      { id: editingMaterial?.id, nameFa: formData.nameFa, nameEn: formData.nameEn, cas: formData.cas, role: formData.role, finalProductEn: formData.finalProductEn },
      materials,
      editingMaterial,
    );
    if (duplicate) {
      setFormError(duplicate.reason);
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

    // The record has to exist before its file can be attached to it, so a file
    // picked in the form is uploaded here rather than in the create payload.
    if (pendingSpecFile && !isLocalMode()) {
      uploadSpecFile(newMaterial, pendingSpecFile);
    }
    setPendingSpecFile(null);

    // "Save and add the next one": the record is stored and the form empties in
    // place, so a repository being filled from an old list is entered without
    // reopening the dialog once per row. The role and pharmacopoeia are kept —
    // a batch of materials transcribed together is usually of one kind.
    if (keepGoing && !editingMaterial) {
      setSavedCount(n => n + 1);
      setRecentlySaved(prev => [newMaterial.nameFa || newMaterial.nameEn, ...prev].slice(0, 5));
      setFormData(prev => ({
        nameFa: '', nameEn: '', iupac: '', cas: '',
        role: prev.role, finalProduct: '', finalProductEn: '',
        pharmacopoeia: prev.pharmacopoeia, specificationFile: undefined,
      }));
      setFormError(null);
      return;
    }

    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setIsModalOpen(false);
    }, 900);
  };

  /** Attach a file to a material that already exists on the server. */
  const uploadSpecFile = async (material: Material, file: File) => {
    try {
      const fileDataUrl = await readAsDataUrl(file);
      const res = await authFetch(`/api/materials/${material.id}/specification`, {
        method: 'PUT',
        body: JSON.stringify({ fileName: file.name, fileSize: file.size, fileDataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'بارگذاری فایل ناموفق بود.');
      onEditMaterial({ ...material, ...data.material }, 'Upload Specification');
    } catch (err: any) {
      // The material itself saved; only the attachment failed, and saying so is
      // the whole point — a name with no file behind it is what we just fixed.
      setSpecError(err.message || 'ماده ذخیره شد ولی بارگذاری فایل ناموفق بود.');
    }
  };

  const handleDeleteSpec = () => {
    if (selectedMaterial) {
      setSpecToDelete(true);
    }
  };

  /**
   * The Specification attachment.
   *
   * Until now the form recorded the file *name* and nothing else — the document
   * itself was never stored, so a record could claim an attachment that did not
   * exist. These handlers talk to the dedicated endpoints, which keep the blob
   * out of the list payload and audit each change server-side.
   */
  const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('خواندن فایل ناموفق بود.'));
      reader.readAsDataURL(file);
    });

  const handleReplaceSpec = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again still fires onChange
    if (!selectedMaterial || !file) return;

    if (file.size > MAX_SPEC_BYTES) {
      setSpecError(`حجم فایل (${formatFileSize(file.size)}) بیش از حد مجاز ${formatFileSize(MAX_SPEC_BYTES)} است.`);
      return;
    }

    setSpecError(null);
    setSpecBusy(true);
    try {
      const fileDataUrl = await readAsDataUrl(file);
      if (isLocalMode()) {
        // No backend in demo mode: keep the name so the UI is coherent, and say
        // plainly that the file itself is not kept.
        const updated = { ...selectedMaterial, specificationFile: file.name, specificationFileSize: file.size, hasSpecificationFile: false };
        onEditMaterial(updated, 'Upload Specification');
        setSelectedMaterial(updated);
        setSpecError('در حالت آزمایشی، فایل ذخیره نمی‌شود و فقط نام آن ثبت می‌گردد.');
        return;
      }
      const res = await authFetch(`/api/materials/${selectedMaterial.id}/specification`, {
        method: 'PUT',
        body: JSON.stringify({ fileName: file.name, fileSize: file.size, fileDataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'بارگذاری فایل ناموفق بود.');
      const updated: Material = { ...selectedMaterial, ...data.material };
      setSelectedMaterial(updated);
      onEditMaterial(updated, 'Upload Specification');
    } catch (err: any) {
      setSpecError(err.message || 'بارگذاری فایل ناموفق بود.');
    } finally {
      setSpecBusy(false);
    }
  };

  /** The blob is not in the list payload; fetch it when it is actually needed. */
  const fetchSpecFile = async (): Promise<{ fileName?: string; fileDataUrl?: string } | null> => {
    if (!selectedMaterial) return null;
    try {
      const res = await authFetch(`/api/materials/${selectedMaterial.id}/specification/file`);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  };

  const handleDownloadSpec = async () => {
    setSpecError(null);
    const file = await fetchSpecFile();
    if (!file?.fileDataUrl) { setSpecError('فایل این ماده روی سرور یافت نشد.'); return; }
    const a = document.createElement('a');
    a.href = file.fileDataUrl;
    a.download = file.fileName || selectedMaterial?.specificationFile || 'specification';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleViewSpec = async () => {
    setSpecError(null);
    const file = await fetchSpecFile();
    if (!file?.fileDataUrl) { setSpecError('فایل این ماده روی سرور یافت نشد.'); return; }
    openDocumentPreview({ fileName: file.fileName, fileDataUrl: file.fileDataUrl }, handleDownloadSpec);
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

  const totalPages = Math.max(1, Math.ceil(filteredMaterials.length / itemsPerPage));
  // Deleting the last row of the last page used to leave the user on an empty
  // page with no way back except paging manually.
  const page = Math.min(currentPage, totalPages);
  useEffect(() => { if (currentPage !== page) setCurrentPage(page); }, [currentPage, page]);
  const currentData = filteredMaterials.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const hasFilters = !!search.trim() || roleFilter !== 'All' || pharmFilter !== 'All';
  const clearFilters = () => { setSearch(''); setRoleFilter('All'); setPharmFilter('All'); setCurrentPage(1); };

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

  const handleConfirmDeleteSpec = async () => {
    if (!selectedMaterial) return;
    setSpecBusy(true);
    setSpecError(null);
    try {
      if (!isLocalMode()) {
        const res = await authFetch(`/api/materials/${selectedMaterial.id}/specification`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'حذف فایل ناموفق بود.');
        }
      }
      const updated: Material = {
        ...selectedMaterial,
        specificationFile: undefined,
        specificationFileSize: undefined,
        hasSpecificationFile: false,
        specificationUploadedAt: undefined,
      };
      onEditMaterial(updated, 'Delete Specification');
      setSelectedMaterial(updated);
      setSpecToDelete(false);
    } catch (err: any) {
      setSpecError(err.message || 'حذف فایل ناموفق بود.');
      setSpecToDelete(false);
    } finally {
      setSpecBusy(false);
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
            <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">مجموع مواد</div>
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
                <div className="text-2xs font-bold text-muted-foreground tracking-wider truncate">
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
        <PageTitle
          eyebrow="Material Master Registry"
          eyebrowIcon={Database}
          title="مخزن مرجع مواد اولیه"
          subtitle="مدیریت مشخصات شیمیایی، نقش دارویی و استانداردهای فارماکوپه‌ای اقلام"
        />
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              type="text"
              placeholder="جستجو (نام فارسی، لاتین، CAS، محصول)..."
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              className="w-full pr-9 pl-3"
            />
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <select 
              value={roleFilter} 
              onChange={e => { setRoleFilter(e.target.value as any); setCurrentPage(1); }}
              className={cn(inputBaseClass, 'w-full sm:w-40')}
            >
              <option value="All">همه نقش‌ها</option>
              {MATERIAL_ROLES.map(opt => <option key={opt.value} value={opt.value}>{roleOptionLabel(opt)}</option>)}
            </select>
            
            <select 
              value={pharmFilter} 
              onChange={e => { setPharmFilter(e.target.value as any); setCurrentPage(1); }}
              className={cn(inputBaseClass, 'font-mono w-full sm:w-36')}
            >
              <option value="All">همه فارماکوپه‌ها</option>
              {pharmacopoeiaOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>

          {can(currentUser, 'material.create') && (
            <Button
              onClick={handleOpenAdd}
              className="w-full sm:w-auto text-xs font-bold shrink-0"
            >
              <Plus />
              <span>ثبت ماده جدید</span>
            </Button>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-card rounded-2xl border border-border shadow-xs overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs" aria-busy={isLoading}>
            <caption className="sr-only">فهرست مواد اولیهٔ ثبت‌شده در مخزن مرجع</caption>
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
                    <td className="py-3 px-4 font-bold text-foreground max-w-[16rem] xl:max-w-[24rem]">
                      <EntityName name={material.nameFa} lines={2} className="whitespace-normal" />
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-muted-foreground max-w-[16rem] xl:max-w-[22rem]" dir="ltr">
                      <EntityName name={material.nameEn} lines={2} className="whitespace-normal" />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-block px-2.5 py-0.5 rounded-md text-2xs font-bold border ${role.tone}`}>
                        {role.labelEn} <span className="font-normal">· {role.labelFa}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-foreground max-w-[14rem] xl:max-w-[20rem]">
                      <EntityName name={material.finalProduct} lines={2} className="whitespace-normal" />
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-xs text-muted-foreground" dir="ltr">{material.cas}</td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-xs text-foreground">{material.pharmacopoeia}</td>
                    <td className="py-3 px-4 text-center">
                      {/* The number that decides whether this row can be deleted. */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-2xs font-bold border ${
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
                        <Button
                          variant="outline"
                          size="icon-xs"
                          onClick={() => handleOpenView(material)}
                          className="text-blue-600 bg-blue-50 hover:bg-blue-100 hover:text-blue-600 border-blue-100 dark:text-blue-300 dark:bg-blue-950/50 dark:hover:bg-blue-900/60 dark:border-blue-900"
                          title="مشاهده شناسنامه"
                        >
                          <Eye />
                        </Button>
                        {can(currentUser, 'material.edit') && (
                          <Button
                            variant="outline"
                            size="icon-xs"
                            onClick={() => handleOpenEdit(material)}
                            className="text-amber-600 bg-amber-50 hover:bg-amber-100 hover:text-amber-600 border-amber-100 dark:text-amber-300 dark:bg-amber-950/50 dark:hover:bg-amber-900/60 dark:border-amber-900"
                            title="ویرایش"
                          >
                            <Edit2 />
                          </Button>
                        )}
                        {can(currentUser, 'material.delete') && (
                          <Button
                            variant="outline"
                            size="icon-xs"
                            onClick={() => handleDelete(material)}
                            className="text-rose-600 bg-rose-50 hover:bg-rose-100 hover:text-rose-600 border-rose-100 dark:text-rose-300 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 dark:border-rose-900"
                            title="حذف"
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              ) : isLoading ? (
                /* Until the first fetch lands there is nothing to show, and the
                   empty state below would claim the repository is empty. */
                [0, 1, 2, 3, 4].map(i => (
                  <tr key={`skeleton-${i}`} aria-hidden="true">
                    {Array.from({ length: 8 }).map((_, c) => (
                      <td key={c} className="py-3.5 px-4">
                        <div className="h-3.5 rounded bg-muted animate-pulse" style={{ width: c === 0 ? '80%' : c > 5 ? '2.5rem' : '60%' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                hasFilters ? (
                  <TableEmptyRow
                    colSpan={8}
                    icon={Archive}
                    message="هیچ ماده‌ای با این جستجو یا فیلترها پیدا نشد."
                    action={
                      <Button type="button" variant="secondary" onClick={clearFilters} className="text-xs font-bold">
                        <X />
                        پاک‌کردن جستجو و فیلترها
                      </Button>
                    }
                  />
                ) : (
                  <TableEmptyRow
                    colSpan={8}
                    icon={Archive}
                    message="مخزن مرجع هنوز خالی است."
                    action={can(currentUser, 'material.create') ? (
                      <Button type="button" onClick={handleOpenAdd} className="text-xs font-bold">
                        <Plus />
                        ثبت اولین ماده
                      </Button>
                    ) : undefined}
                    note={can(currentUser, 'material.create') ? undefined : 'ثبت ماده در دسترس نقش شما نیست.'}
                  />
                )
              )}
            </tbody>
          </table>
        </div>
        
        {/* PAGINATION */}
        <div className="px-6 py-3 border-t border-border bg-muted/50 flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex items-center gap-2 text-2xs font-bold text-muted-foreground shrink-0">
            <span>تعداد در هر صفحه</span>
            <select
              value={itemsPerPage}
              onChange={e => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
              className="bg-card border border-border rounded-lg px-2 py-1 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex-1 min-w-0">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={filteredMaterials.length}
              startIndex={(page - 1) * itemsPerPage}
              endIndex={page * itemsPerPage}
              onPageChange={setCurrentPage}
            />
          </div>
        </div>
      </div>

      {/* CREATE/EDIT MODAL - High Quality Responsive Enterprise Modal with Portal */}
      <FormModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        size="lg"
        ariaLabel="فرم ماده اولیه"
        unsavedChanges={materialFormDirty}
        unsavedLabel={editingMaterial ? 'تغییرات این ماده' : 'اطلاعات مادهٔ جدید'}
      >
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
                      <p className="text-2xs text-muted-foreground">تکمیل مشخصات شیمیایی، نقش دارویی و استانداردهای فارماکوپه‌ای</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setIsModalOpen(false)}
                    className="text-muted-foreground"
                    title="بستن"
                  >
                    <X />
                  </Button>
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
                        <Input 
                          type="text" 
                          required
                          value={formData.nameFa || ''} 
                          onChange={e => setFormData({ ...formData, nameFa: e.target.value })} 
                          className="w-full"
                          placeholder="مثال: استامینوفن"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          نام لاتین / ژنریک <span className="text-rose-500 dark:text-rose-400">*</span>
                        </label>
                        <Input 
                          type="text" 
                          required
                          value={formData.nameEn || ''} 
                          onChange={e => setFormData({ ...formData, nameEn: e.target.value })} 
                          className="w-full text-left font-mono"
                          placeholder="e.g. Paracetamol"
                          dir="ltr"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          شماره CAS <span className="text-rose-500 dark:text-rose-400">*</span>
                        </label>
                        <Input 
                          type="text" 
                          required
                          value={formData.cas || ''} 
                          onChange={e => setFormData({ ...formData, cas: e.target.value })} 
                          className="w-full text-left font-mono"
                          placeholder="103-90-2"
                          dir="ltr"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          نام IUPAC (اختیاری)
                        </label>
                        <Input 
                          type="text" 
                          value={formData.iupac || ''} 
                          onChange={e => setFormData({ ...formData, iupac: e.target.value })} 
                          className="w-full text-left font-mono"
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
                          className={cn(inputBaseClass, 'w-full')}
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
                          className={cn(inputBaseClass, 'w-full font-mono')}
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
                        <Input 
                          type="text" 
                          required
                          value={formData.finalProduct || ''} 
                          onChange={e => setFormData({ ...formData, finalProduct: e.target.value })} 
                          className="w-full"
                          placeholder="مثلاً: قرص استامینوفن ۵۰۰"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-foreground block">
                          محصول نهایی (لاتین) <span className="text-rose-500 dark:text-rose-400">*</span>
                        </label>
                        <Input 
                          type="text" 
                          required
                          value={formData.finalProductEn || ''} 
                          onChange={e => setFormData({ ...formData, finalProductEn: e.target.value })} 
                          className="w-full text-left font-mono"
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
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (!file) return;
                                if (file.size > MAX_SPEC_BYTES) {
                                  setFormError(`حجم فایل (${formatFileSize(file.size)}) بیش از حد مجاز ${formatFileSize(MAX_SPEC_BYTES)} است.`);
                                  return;
                                }
                                setFormError(null);
                                // Held until the record is saved: a file cannot be
                                // attached to a material that does not exist yet.
                                setPendingSpecFile(file);
                                setFormData({ ...formData, specificationFile: file.name });
                              }}
                            />
                          </label>
                          {formData.specificationFile && (
                            <div className="flex items-center gap-2 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-900 px-3 py-1.5 rounded-xl border">
                              <FileText className="w-4 h-4" />
                              <span className="text-2xs font-mono font-bold truncate max-w-[240px]" dir="ltr">
                                {formData.specificationFile}
                              </span>
                              <button
                                type="button"
                                onClick={() => { setPendingSpecFile(null); setFormData({ ...formData, specificationFile: undefined }); }}
                                className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 p-0.5"
                                title="حذف فایل"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                        <p className="text-2xs text-muted-foreground">
                          {pendingSpecFile
                            ? `فایل «${pendingSpecFile.name}» (${formatFileSize(pendingSpecFile.size)}) پس از ذخیرهٔ ماده بارگذاری می‌شود.`
                            : `فایل روی سرور ذخیره و در شناسنامهٔ ماده قابل دانلود است. حداکثر ${formatFileSize(MAX_SPEC_BYTES)}.`}
                        </p>
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
                        <label className="text-2xs font-bold text-background/70 uppercase tracking-wider block">نام استاندارد فارسی</label>
                        <div className="w-full px-3 py-2 bg-background/10 border border-background/20 rounded-lg text-xs font-bold select-all">
                          {generateStandardNameFa(formData)}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-2xs font-bold text-background/70 uppercase tracking-wider block">Standard English Name</label>
                        <div className="w-full px-3 py-2 bg-background/10 border border-background/20 rounded-lg text-xs font-mono font-bold select-all" dir="ltr">
                          {generateStandardNameEn(formData)}
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
                
                {/* Sticky Bottom Footer */}
                <div className="sticky bottom-0 z-30 px-6 py-4 border-t border-border bg-muted/95 backdrop-blur-md flex items-center justify-end gap-3 shrink-0 shadow-xs">
                  {savedCount > 0 && (
                    <span className="mr-auto text-2xs font-bold text-emerald-700 dark:text-emerald-300 truncate max-w-[22rem]"
                      title={recentlySaved.join('، ')}>
                      {savedCount.toLocaleString('fa-IR')} ماده در این نشست ثبت شد
                      {recentlySaved[0] ? ` — آخرین: ${recentlySaved[0]}` : ''}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsModalOpen(false)}
                    className="text-xs font-bold text-muted-foreground"
                  >
                    {savedCount > 0 ? 'پایان' : 'انصراف'}
                  </Button>
                  {!editingMaterial && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleSave(true)}
                      title="ذخیره می‌کند، فرم را خالی می‌کند و همین‌جا می‌مانید"
                      className="text-xs font-bold"
                    >
                      ذخیره و ثبت بعدی
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={() => handleSave()}
                    className="px-6 text-xs font-bold"
                  >
                    {editingMaterial ? 'ذخیره تغییرات ماده' : 'ثبت اطلاعات در مخزن'}
                  </Button>
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
                  <p className="text-2xs text-muted-foreground font-mono" dir="ltr">{selectedMaterial.id}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsViewModalOpen(false)}
                className="text-muted-foreground"
                title="بستن"
              >
                <X />
              </Button>
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
                    <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-1">نام فارسی</div>
                    <div className="text-sm font-bold text-foreground">{selectedMaterial.nameFa}</div>
                  </div>
                  <div>
                    <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-1">نام لاتین / ژنریک</div>
                    <div className="text-sm font-bold font-mono text-foreground" dir="ltr">{selectedMaterial.nameEn}</div>
                  </div>
                  <div>
                    <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-1">نام IUPAC</div>
                    <div className="text-xs font-mono text-foreground" dir="ltr">{selectedMaterial.iupac || '-'}</div>
                  </div>
                  <div>
                    <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-1">CAS Number</div>
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
                    <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-1">نقش ماده (Role)</div>
                    <span className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-bold border ${getMaterialRole(selectedMaterial.role).tone}`}>
                      {getMaterialRole(selectedMaterial.role).labelEn} <span className="font-normal">· {getMaterialRole(selectedMaterial.role).labelFa}</span>
                    </span>
                  </div>
                  <div>
                    <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-1">فارماکوپه مرجع (Pharmacopoeia)</div>
                    <div className="text-sm font-bold font-mono text-foreground">{selectedMaterial.pharmacopoeia}</div>
                  </div>
                  <div>
                    <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-1">محصول نهایی (فارسی)</div>
                    <div className="text-sm font-bold text-foreground">{selectedMaterial.finalProduct}</div>
                  </div>
                  <div>
                    <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-1">محصول نهایی (لاتین)</div>
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
                      <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-1">نام استاندارد فارسی</div>
                      <div className="text-xs font-bold text-foreground">{selectedMaterial.standardNameFa}</div>
                    </div>
                    <div>
                      <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Standard English Name</div>
                      <div className="text-xs font-bold font-mono text-foreground" dir="ltr">{selectedMaterial.standardNameEn}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-2xs font-bold text-muted-foreground uppercase tracking-wider mb-2">فایل پیوست Specification</div>

                    {specError && (
                      <div role="alert" className="mb-2 p-2.5 bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/50 dark:border-rose-900 dark:text-rose-200 border rounded-xl text-2xs leading-relaxed fade-in">
                        {specError}
                      </div>
                    )}

                    {selectedMaterial.specificationFile ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border p-3 rounded-xl shadow-xs">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900 flex items-center justify-center border shrink-0">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-mono text-xs font-bold text-foreground truncate max-w-[220px] sm:max-w-[320px]" dir="ltr">
                              {selectedMaterial.specificationFile}
                            </div>
                            {/* A name with no file behind it is exactly what this
                                module used to record, so the record says which
                                one this is. */}
                            <div className="text-2xs text-muted-foreground mt-0.5">
                              {selectedMaterial.hasSpecificationFile
                                ? [formatFileSize(selectedMaterial.specificationFileSize), 'ذخیره‌شده روی سرور'].filter(Boolean).join(' · ')
                                : 'فقط نام فایل ثبت شده است — فایلی روی سرور نیست.'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {selectedMaterial.hasSpecificationFile && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={handleViewSpec}
                                className="text-blue-600 dark:text-blue-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                                title="مشاهده"
                              >
                                <Eye />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={handleDownloadSpec}
                                className="text-emerald-600 dark:text-emerald-300 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                                title="دانلود"
                              >
                                <Download />
                              </Button>
                            </>
                          )}
                          {can(currentUser, 'material.edit') && (
                            <>
                              <label className={`p-2 text-amber-600 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 rounded-lg transition-colors cursor-pointer ${specBusy ? 'opacity-50 pointer-events-none' : ''}`} title="جایگزینی">
                                <Upload className="w-4 h-4" />
                                <input type="file" className="hidden" onChange={handleReplaceSpec} disabled={specBusy} />
                              </label>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={handleDeleteSpec}
                                disabled={specBusy}
                                className="text-rose-600 dark:text-rose-300 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                                title="حذف"
                              >
                                <Trash2 />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 bg-card border border-border border-dashed rounded-xl gap-2">
                        <div className="text-xs font-bold text-muted-foreground">فایل مشخصات فنی بارگذاری نشده است</div>
                        {can(currentUser, 'material.edit') ? (
                          <>
                            <label className={`flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-lg text-xs font-bold text-foreground cursor-pointer hover:bg-accent transition-colors shadow-xs ${specBusy ? 'opacity-50 pointer-events-none' : ''}`}>
                              <Upload className="w-4 h-4" />
                              <span>{specBusy ? 'در حال بارگذاری…' : 'بارگذاری فایل'}</span>
                              <input type="file" className="hidden" onChange={handleReplaceSpec} disabled={specBusy} />
                            </label>
                            <span className="text-2xs text-muted-foreground">حداکثر {formatFileSize(MAX_SPEC_BYTES)}</span>
                          </>
                        ) : (
                          <span className="text-2xs text-muted-foreground">بارگذاری فایل در دسترس نقش شما نیست.</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            <div className="sticky bottom-0 z-30 px-6 py-4 border-t border-border bg-muted/95 backdrop-blur-md flex items-center justify-end shrink-0 shadow-xs">
              <Button
                variant="secondary"
                onClick={() => setIsViewModalOpen(false)}
                className="px-5 font-bold text-xs"
              >
                بستن
              </Button>
            </div>
</>)}
      </FormModal>

      {/* CUSTOM MATERIAL DELETE MODAL with Portal */}
      <FormModal open={!!materialToDelete} onClose={() => setMaterialToDelete(null)} size="sm"
        role="alertdialog" closeOnBackdrop={false} className="p-6" ariaLabel="تأیید حذف ماده اولیه">
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
                        <span className="font-mono bg-background border border-border px-2 py-0.5 rounded text-2xs text-foreground">
                          {categoryLabels[vendor.category as keyof typeof categoryLabels]?.fa || vendor.category}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button
                      variant="secondary"
                      onClick={() => setMaterialToDelete(null)}
                      className="w-full sm:w-auto text-xs font-bold"
                    >
                      متوجه شدم
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    آیا از حذف ماده اولیه <span className="font-bold text-foreground">«{materialToDelete.nameFa}» ({materialToDelete.nameEn})</span> اطمینان دارید؟ 
                    این عمل غیرقابل بازگشت بوده و تمامی اطلاعات مربوط به این ماده از سیستم حذف خواهد شد.
                  </p>
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button
                      variant="secondary"
                      onClick={() => setMaterialToDelete(null)}
                      className="text-xs font-bold"
                    >
                      انصراف
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        onDeleteMaterial(materialToDelete.id);
                        setMaterialToDelete(null);
                      }}
                      className="text-xs font-bold"
                    >
                      تایید و حذف نهایی
                    </Button>
                  </div>
                </>
              )}
            </div>
</>)}
      </FormModal>

      {/* CUSTOM SPEC FILE DELETE MODAL with Portal */}
      <FormModal open={!!specToDelete} onClose={() => setSpecToDelete(false)} size="sm"
        role="alertdialog" closeOnBackdrop={false} className="p-6" ariaLabel="تأیید حذف فایل Specification">
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
                <Button
                  variant="secondary"
                  onClick={() => setSpecToDelete(false)}
                  className="text-xs font-bold"
                >
                  انصراف
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmDeleteSpec}
                  className="text-xs font-bold"
                >
                  تایید حذف فایل
                </Button>
              </div>
            </div>
      </FormModal>
    </div>
  );
};
