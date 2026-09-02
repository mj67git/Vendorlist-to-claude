import React, { useState, useMemo, useEffect } from 'react';
import { FormModal } from './FormModal';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer } from 'recharts';
import { authFetch } from '../services/authFetch';
import { History } from 'lucide-react';
import { useExcelExport } from '../hooks/useExcelExport';
import { categoryLabels } from '../constants/categories';
import { GradeBadge } from './GradeBadge';
import { 
  Search, Plus, Edit2, Trash2, Eye, X, Building2, Factory, Handshake, 
  CheckCircle, CheckCircle2, XCircle, ArrowUpDown, ArrowUp, ArrowDown, Filter, Globe, Mail, Phone, User as UserIcon, ExternalLink,
  FileText, Upload, Download, FileCheck, Award, ShieldCheck, AlertCircle, Paperclip,
  RefreshCw, AlertTriangle, Package
} from 'lucide-react';
import { 
  BusinessPartner, 
  BusinessPartnerType, 
  User, 
  SOPDocumentKey, 
  SOPDocumentStatus, 
  SOPDocumentEval,
  SupplierEvaluation,
  SOPGrade,
  SOPSupplierStatus,
  Vendor
} from '../types';
import { 
  SOP_DOCUMENTS_DEF, 
  calculateDocScore, 
  getDefaultSupplierEvaluation, 
  computeSupplierEvaluation, 
  validateSupplierEvaluation,
  describeGrade,
  canSupplySources
} from '../utils/sopEvaluation';
import { Pagination } from './Pagination';
import { EntityName } from './EntityName';
import { openDocumentPreview } from '../utils/documentPreview';
import { can } from '../utils/permissions';
import { useDirtySnapshot } from '../utils/useDirtySnapshot';

interface Props {
  partners: BusinessPartner[];
  onAddPartner: (partner: BusinessPartner) => void;
  onEditPartner: (partner: BusinessPartner) => void;
  onDeletePartner: (id: string) => void;
  currentUser: User | null;
  db?: Vendor[];
  /** True while the first fetch is still in flight, so the table shows
      skeletons instead of claiming there are no partners. */
  isLoading?: boolean;
}

/**
 * Saving a partner sends the whole record, so all five SOP documents travel in
 * one body — and `express.json` on the server caps that at 10mb while a data
 * URL is ~33% larger than the file it encodes. Without a guard here, a couple
 * of large PDFs produced a 413 that the UI never showed.
 */
const MAX_DOC_BYTES = 3 * 1024 * 1024;
const MAX_DOCS_TOTAL_BYTES = 6 * 1024 * 1024;

const formatFileSize = (bytes?: number) => {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
};

type SortField = 'name' | 'type' | 'country' | 'city' | 'status' | 'createdAt' | 'updatedAt' | 'grade';

/** Persian has its own alphabet order; a plain `<` sorts by code point. */
const collator = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });

/**
 * A sortable column header that says which column is sorted and which way.
 *
 * These were clickable `<th>`s with the same neutral glyph on every column: not
 * reachable by keyboard, not announced as controls, and no way to tell what the
 * table was ordered by.
 */
const SortHeader: React.FC<{
  field: SortField;
  label: string;
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (f: SortField) => void;
}> = ({ field, label, sortField, sortOrder, onSort }) => {
  const active = sortField === field;
  const Icon = !active ? ArrowUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      className={`p-0 ${active ? 'text-foreground' : ''}`}
      aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        title={`مرتب‌سازی بر اساس ${label}`}
        className="w-full py-3 px-4 flex items-center gap-1 hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <span>{label}</span>
        <Icon className={`w-3 h-3 shrink-0 ${active ? 'text-foreground' : 'text-muted-foreground'}`} />
      </button>
    </th>
  );
};

/** Worst first when descending: the order a quality reviewer reads in. */
const GRADE_RANK: Record<string, number> = {
  'A': 5, 'B': 4, 'C': 3, 'Pending Review': 2, 'Blacklist': 1, 'Not Evaluated': 0,
};
type SortOrder = 'asc' | 'desc';

export const BusinessPartnerRepositoryView: React.FC<Props> = ({
  partners,
  onAddPartner,
  onEditPartner,
  onDeletePartner,
  currentUser,
  db = [],
  isLoading = false
}) => {
  // Search & Filters state
  const excel = useExcelExport();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<BusinessPartnerType | 'All'>('All');
  const [statusFilter, setStatusFilter] = useState<'Active' | 'Inactive' | 'Blacklisted' | 'All'>('All');
  const [gradeFilter, setGradeFilter] = useState<SOPGrade | 'All'>('All');
  const [sopStatusFilter, setSopStatusFilter] = useState<SOPSupplierStatus | 'All'>('All');
  const [countryFilter, setCountryFilter] = useState<string>('All');

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<BusinessPartner | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<BusinessPartner | null>(null);

  // SOP evaluation history (reconstructed from the audit trail) for the
  // currently-viewed supplier.
  const [evalHistory, setEvalHistory] = useState<any[]>([]);
  useEffect(() => {
    if (!isViewModalOpen || !selectedPartner || selectedPartner.type !== 'Supplier') {
      setEvalHistory([]);
      return;
    }
    let cancelled = false;
    authFetch(`/api/business-partners/${selectedPartner.id}/evaluation-history`)
      .then(res => (res.ok ? res.json() : []))
      .then((data: any[]) => { if (!cancelled && Array.isArray(data)) setEvalHistory(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isViewModalOpen, selectedPartner]);

  // Blacklist workflow: blacklisting requires a reason (captured in the audit
  // trail); restoring returns the partner to Active.
  const [blacklistTarget, setBlacklistTarget] = useState<BusinessPartner | null>(null);
  const [blacklistReason, setBlacklistReason] = useState('');

  const confirmBlacklist = () => {
    if (!blacklistTarget || !blacklistReason.trim()) return;
    onEditPartner({ ...blacklistTarget, status: 'Blacklisted', reasonForChange: `افزودن به لیست سیاه: ${blacklistReason.trim()}` } as any);
    setSelectedPartner(prev => (prev && prev.id === blacklistTarget.id ? { ...prev, status: 'Blacklisted' } : prev));
    setBlacklistTarget(null);
    setBlacklistReason('');
  };

  const handleRestoreFromBlacklist = (partner: BusinessPartner) => {
    onEditPartner({ ...partner, status: 'Active', reasonForChange: 'خروج از لیست سیاه و بازگرداندن به وضعیت فعال' } as any);
    setSelectedPartner(prev => (prev && prev.id === partner.id ? { ...prev, status: 'Active' } : prev));
  };

  // Sources (vendors) linked to a partner — via manufacturerId / supplierId, or
  // a vendor whose id equals the partner id (legacy name-based linkage).
  const getConnectedSources = (partner: BusinessPartner) =>
    (db || []).filter(v => v.manufacturerId === partner.id || v.supplierId === partner.id || v.id === partner.id);

  const renderConnectedSources = (partner: BusinessPartner) => {
    const sources = getConnectedSources(partner);
    const roleLabel = partner.type === 'Manufacturer' ? 'به‌عنوان تولیدکننده' : 'به‌عنوان فروشنده';
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5 border-b border-border pb-2">
          <Package className="w-4 h-4 text-primary" />
          <span>سورس‌های متصل به این شریک ({roleLabel})</span>
          <span className="mr-auto text-2xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-bold">{sources.length} سورس</span>
        </h3>
        {sources.length === 0 ? (
          <div className="text-center py-6 bg-muted/40 rounded-2xl border border-dashed border-border">
            <p className="text-xs text-muted-foreground">هیچ سورسی به این شریک تجاری متصل نیست.</p>
          </div>
        ) : (
          <div className="border border-border rounded-2xl overflow-hidden">
            <table className="w-full text-right text-xs">
              <thead className="bg-muted border-b border-border font-bold text-muted-foreground">
                <tr>
                  <th className="py-2.5 px-3">ماده / محصول</th>
                  <th className="py-2.5 px-3">نام سورس</th>
                  <th className="py-2.5 px-3">دسته</th>
                  <th className="py-2.5 px-3 text-center">گرید / وضعیت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {sources.map(v => (
                  <tr key={v.id} className="hover:bg-muted/40">
                    <td className="py-2 px-3">
                      <span className="font-bold text-foreground">{v.material}</span>
                      {v.materialEn && <span className="font-mono text-2xs text-muted-foreground block">{v.materialEn}</span>}
                    </td>
                    <td className="py-2 px-3 text-foreground">{v.name}</td>
                    {/* The stored key (`foreign`, `packaging`, …) is a database
                        value, not something to show a user — everywhere else in
                        the app it goes through the same label map. */}
                    <td className="py-2 px-3 text-muted-foreground">
                      {categoryLabels[v.category as keyof typeof categoryLabels]?.fa || v.category || '—'}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {/* Was a local copy of the grade badge that fell back to
                          the raw English status ('new', 'approved') when a
                          source had no grade yet. GradeBadge is the shared one
                          and always speaks Persian. */}
                      <GradeBadge grade={v.grade as any} status={v.status as any} scores={v.scores} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // Modal active tab when editing/creating a supplier: 'general' | 'evaluation'
  const [activeModalTab, setActiveModalTab] = useState<'general' | 'evaluation'>('general');

  // Form state
  const [formData, setFormData] = useState<{
    type: BusinessPartnerType;
    name: string;
    country: string;
    city: string;
    address: string;
    email: string;
    contactPerson: string;
    phone: string;
    website: string;
    status: 'Active' | 'Inactive' | 'Blacklisted';
  }>({
    type: 'Manufacturer',
    name: '',
    country: '',
    city: '',
    address: '',
    email: '',
    contactPerson: '',
    phone: '',
    website: '',
    status: 'Active'
  });

  // SOP evaluation documents state inside form
  const [evalDocs, setEvalDocs] = useState<Record<SOPDocumentKey, SOPDocumentEval>>(() => {
    return getDefaultSupplierEvaluation().documents;
  });

  const [formError, setFormError] = useState<string | null>(null);
  /** What this sitting has produced, for the "save and add next" flow. */
  const [savedCount, setSavedCount] = useState(0);
  const [recentlySaved, setRecentlySaved] = useState<string[]>([]);

  // Both halves of this form count: the profile fields and the SOP documents,
  // which can hold several megabytes of freshly attached files. A stray click
  // outside the panel used to throw the attachments away with no question and
  // no way to get them back short of picking every file again.
  const partnerFormDirty = useDirtySnapshot(isModalOpen, { formData, evalDocs });

  // Custom Deletion state
  const [partnerToDelete, setPartnerToDelete] = useState<BusinessPartner | null>(null);
  const [deleteConstraintError, setDeleteConstraintError] = useState<{
    name: string;
    type: 'Manufacturer' | 'Supplier';
    suppliers?: BusinessPartner[];
    sources?: Vendor[];
  } | null>(null);

  // Computed live evaluation result
  const computedEval = useMemo<SupplierEvaluation>(() => {
    return computeSupplierEvaluation(evalDocs);
  }, [evalDocs]);

  /** Bytes currently attached across all SOP documents — see MAX_DOCS_TOTAL_BYTES. */
  const docsTotalBytes = useMemo(
    () => Object.values(evalDocs).reduce((sum, doc) => sum + (doc.fileSize || 0), 0),
    [evalDocs],
  );

  // Unique countries list for country filter
  const availableCountries = useMemo(() => {
    const list = partners.map(p => p.country.trim()).filter(Boolean);
    return Array.from(new Set(list)).sort();
  }, [partners]);

  // Comprehensive KPI Statistics
  const stats = useMemo(() => {
    const total = partners.length;
    const manufacturers = partners.filter(p => p.type === 'Manufacturer').length;
    const suppliers = partners.filter(p => p.type === 'Supplier');
    const active = partners.filter(p => p.status === 'Active').length;
    const inactive = partners.filter(p => p.status === 'Inactive').length;

    // "Approved" used to mean grade A **or B**, but only grade A may be
    // attached to a source and the server rejects the rest with 422 — so the
    // card counted suppliers the system refuses. It now asks the same function
    // the gate asks, and the two cards partition the suppliers exactly.
    const eligibleSuppliers = suppliers.filter(s => canSupplySources(s).allowed).length;
    const blockedSuppliers = suppliers.length - eligibleSuppliers;

    return { 
      total, 
      manufacturers, 
      suppliers: suppliers.length, 
      active, 
      inactive,
      eligibleSuppliers,
      blockedSuppliers
    };
  }, [partners]);

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return (
      search.trim() !== '' ||
      typeFilter !== 'All' ||
      statusFilter !== 'All' ||
      gradeFilter !== 'All' ||
      sopStatusFilter !== 'All' ||
      countryFilter !== 'All'
    );
  }, [search, typeFilter, statusFilter, gradeFilter, sopStatusFilter, countryFilter]);

  const handleResetFilters = () => {
    setSearch('');
    setTypeFilter('All');
    setStatusFilter('All');
    setGradeFilter('All');
    setSopStatusFilter('All');
    setCountryFilter('All');
    setCurrentPage(1);
  };

  // Smart Filtering & Sorting
  const filteredPartners = useMemo(() => {
    return partners.filter(p => {
      // 1. Type filter
      if (typeFilter !== 'All' && p.type !== typeFilter) return false;

      // 2. System Status filter
      if (statusFilter !== 'All' && p.status !== statusFilter) return false;

      // 3. Grade filter (Supplier only)
      if (gradeFilter !== 'All') {
        if (p.type !== 'Supplier') return false;
        if (p.evaluation?.grade !== gradeFilter) return false;
      }

      // 4. SOP Status filter (Supplier only)
      if (sopStatusFilter !== 'All') {
        if (p.type !== 'Supplier') return false;
        if (p.evaluation?.status !== sopStatusFilter) return false;
      }

      // 5. Country filter
      if (countryFilter !== 'All' && p.country.trim().toLowerCase() !== countryFilter.trim().toLowerCase()) {
        return false;
      }

      // 6. Smart Search query
      if (search.trim()) {
        const query = search.toLowerCase().trim();

        const matchesName = p.name.toLowerCase().includes(query);
        const matchesCountry = p.country.toLowerCase().includes(query);
        const matchesCity = (p.city || '').toLowerCase().includes(query);
        const matchesContact = (p.contactPerson || '').toLowerCase().includes(query);
        const matchesEmail = (p.email || '').toLowerCase().includes(query);
        const matchesPhone = (p.phone || '').toLowerCase().includes(query);

        return (
          matchesName ||
          matchesCountry ||
          matchesCity ||
          matchesContact ||
          matchesEmail ||
          matchesPhone
        );
      }

      return true;
    }).sort((a, b) => {
      const dir = sortOrder === 'asc' ? 1 : -1;
      if (sortField === 'grade') {
        const rank = (p: BusinessPartner) =>
          p.type === 'Supplier' ? (GRADE_RANK[p.evaluation?.grade || 'Not Evaluated'] ?? 0) : -1;
        return dir * (rank(a) - rank(b));
      }
      // Dates are ISO strings, which the collator orders correctly as text.
      return dir * collator.compare(String(a[sortField] ?? ''), String(b[sortField] ?? ''));
    });
  }, [partners, search, typeFilter, statusFilter, gradeFilter, sopStatusFilter, countryFilter, sortField, sortOrder]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredPartners.length / itemsPerPage));
  // Deleting the last row of the last page used to strand the user on an empty
  // page with no way back but paging manually.
  const page = Math.min(currentPage, totalPages);
  useEffect(() => { if (currentPage !== page) setCurrentPage(page); }, [currentPage, page]);
  const paginatedPartners = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filteredPartners.slice(start, start + itemsPerPage);
  }, [filteredPartners, page, itemsPerPage]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleOpenAdd = () => {
    setFormData({
      type: 'Manufacturer',
      name: '',
      country: '',
      city: '',
      address: '',
      email: '',
      contactPerson: '',
      phone: '',
      website: '',
      status: 'Active'
    });
    setEvalDocs(getDefaultSupplierEvaluation().documents);
    setEditingPartner(null);
    setFormError(null);
    setActiveModalTab('general');
    setSavedCount(0);
    setRecentlySaved([]);
    setIsModalOpen(true);
  };


  const handleOpenEdit = (partner: BusinessPartner) => {
    setFormData({
      type: partner.type,
      name: partner.name,
      country: partner.country,
      city: partner.city || '',
      address: partner.address || '',
      email: partner.email || '',
      contactPerson: partner.contactPerson || '',
      phone: partner.phone || '',
      website: partner.website || '',
      status: partner.status
    });

    if (partner.type === 'Supplier' && partner.evaluation?.documents) {
      setEvalDocs(partner.evaluation.documents);
    } else {
      setEvalDocs(getDefaultSupplierEvaluation().documents);
    }

    setEditingPartner(partner);
    setFormError(null);
    setActiveModalTab('general');
    setIsViewModalOpen(false); // Close detail view if open
    setIsModalOpen(true);
  };

  const handleOpenView = (partner: BusinessPartner) => {
    setSelectedPartner(partner);
    setIsViewModalOpen(true);
  };

  // Deletion Constraints Check
  const handleDeletePartnerClick = (partner: BusinessPartner) => {
    if (partner.type === 'Manufacturer') {
      const connectedSources = db.filter(v => v.manufacturerId === partner.id);
      if (connectedSources.length > 0) {
        setDeleteConstraintError({
          name: partner.name,
          type: 'Manufacturer',
          sources: connectedSources
        });
        return;
      }
    } else if (partner.type === 'Supplier') {
      const connectedSources = db.filter(v => v.supplierId === partner.id || v.id === partner.id);
      if (connectedSources.length > 0) {
        setDeleteConstraintError({
          name: partner.name,
          type: 'Supplier',
          sources: connectedSources
        });
        return;
      }
    }

    setPartnerToDelete(partner);
  };

  const handleConfirmDelete = () => {
    if (partnerToDelete) {
      onDeletePartner(partnerToDelete.id);
      setPartnerToDelete(null);
      // Close detail view modal if the deleted partner was the one being viewed
      if (isViewModalOpen && selectedPartner?.id === partnerToDelete.id) {
        setIsViewModalOpen(false);
        setSelectedPartner(null);
      }
    }
  };

  const handleDocStatusChange = (key: SOPDocumentKey, status: SOPDocumentStatus) => {
    setEvalDocs(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        status,
        score: calculateDocScore(status)
      }
    }));
  };

  const handleDocFileUpload = (key: SOPDocumentKey, file: File) => {
    // Refuse here, with a reason, rather than letting the server reject the
    // whole evaluation later for a size the user was never told about.
    if (file.size > MAX_DOC_BYTES) {
      setFormError(`حجم فایل «${file.name}» (${formatFileSize(file.size)}) بیش از حد مجاز هر مدرک (${formatFileSize(MAX_DOC_BYTES)}) است.`);
      return;
    }
    const othersTotal = Object.entries(evalDocs)
      .filter(([k]) => k !== key)
      .reduce((sum, [, doc]) => sum + (doc.fileSize || 0), 0);
    if (othersTotal + file.size > MAX_DOCS_TOTAL_BYTES) {
      setFormError(`مجموع حجم مدارک پیوست از ${formatFileSize(MAX_DOCS_TOTAL_BYTES)} بیشتر می‌شود. ابتدا یکی از فایل‌های موجود را حذف کنید.`);
      return;
    }
    setFormError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setEvalDocs(prev => ({
        ...prev,
        [key]: {
          ...prev[key],
          fileName: file.name,
          fileSize: file.size,
          fileDataUrl: dataUrl,
          uploadedAt: new Date().toISOString()
        }
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleDocFileRemove = (key: SOPDocumentKey) => {
    setEvalDocs(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        fileName: undefined,
        fileSize: undefined,
        fileDataUrl: undefined,
        uploadedAt: undefined
      }
    }));
  };

  // The base64 blob is no longer shipped in the list payload; fetch it on
  // demand from the per-document file endpoint when a file already exists.
  const ensureDocDataUrl = async (doc: SOPDocumentEval, partnerId?: string): Promise<string | null> => {
    if (doc.fileDataUrl) return doc.fileDataUrl;
    if (!partnerId || !doc.fileName) return null;
    try {
      const res = await authFetch(`/api/business-partners/${partnerId}/documents/${doc.key}/file`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.fileDataUrl || null;
    } catch { return null; }
  };

  // Viewing and downloading both pull the same blob from the file endpoint, so
  // both follow `partner.files` — seeing that a partner is graded B is a
  // different thing from taking its business licence off the system.
  const canFiles = can(currentUser, 'partner.files');

  const handleDocFileView = async (doc: SOPDocumentEval, partnerId?: string) => {
    const url = await ensureDocDataUrl(doc, partnerId);
    if (!url) return;
    openDocumentPreview({ ...doc, fileDataUrl: url }, () => handleDocFileDownload(doc, partnerId));
  };

  const handleDocFileDownload = async (doc: SOPDocumentEval, partnerId?: string) => {
    const url = await ensureDocDataUrl(doc, partnerId);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName || `${doc.nameEn}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSubmitForm = (e: React.FormEvent, keepGoing = false) => {
    e.preventDefault();
    setFormError(null);

    // Validation 1: Required fields
    if (!formData.name.trim()) {
      setFormError('لطفاً نام شرکت را وارد کنید.');
      setActiveModalTab('general');
      return;
    }
    if (!formData.country.trim()) {
      setFormError('لطفاً نام کشور را وارد کنید.');
      setActiveModalTab('general');
      return;
    }

    // Validation 2: Unique Manufacturer Name Check
    if (formData.type === 'Manufacturer') {
      const duplicate = partners.find(p => 
        p.type === 'Manufacturer' && 
        p.name.trim().toLowerCase() === formData.name.trim().toLowerCase() &&
        p.id !== editingPartner?.id
      );
      if (duplicate) {
        setFormError('یک تولیدکننده (Manufacturer) با این نام قبلاً در سیستم ثبت شده است.');
        setActiveModalTab('general');
        return;
      }
    }

    // Validation 2.1: Unique Supplier Name Check
    if (formData.type === 'Supplier') {
      const duplicate = partners.find(p =>
        p.type === 'Supplier' &&
        p.name.trim().toLowerCase() === formData.name.trim().toLowerCase() &&
        p.id !== editingPartner?.id
      );
      if (duplicate) {
        setFormError(`یک فروشنده با نام "${formData.name.trim()}" قبلاً ثبت شده است.`);
        setActiveModalTab('general');
        return;
      }
    }

    // Validation 4: SOP Evaluation Validation when type === 'Supplier'
    let evaluationResult: SupplierEvaluation | undefined = undefined;
    if (formData.type === 'Supplier') {
      const hasAnyDocEvaluated = Object.values(evalDocs).some(d => d.status !== null);
      if (hasAnyDocEvaluated) {
        const { isValid, missingDocs } = validateSupplierEvaluation(evalDocs);
        if (!isValid) {
          setFormError(`ارزیابی کامل نیست! در صورت شروع ارزیابی، تعیین وضعیت برای تمام ۵ مدرک SOP الزامی است. مدارک بدون وضعیت: ${missingDocs.join('، ')}`);
          setActiveModalTab('evaluation');
          return;
        }
        evaluationResult = computedEval;
      } else {
        // Not evaluated yet
        evaluationResult = undefined;
      }
    }

    const nowIso = new Date().toISOString();

    if (editingPartner) {
      // Update
      const updated: BusinessPartner = {
        ...editingPartner,
        type: formData.type,
        name: formData.name.trim(),
        country: formData.country.trim(),
        city: formData.city.trim() || undefined,
        address: formData.address.trim() || undefined,
        email: formData.email.trim() || undefined,
        contactPerson: formData.contactPerson.trim() || undefined,
        phone: formData.phone.trim() || undefined,
        website: formData.website.trim() || undefined,
        status: formData.status,
        evaluation: formData.type === 'Supplier' ? evaluationResult : undefined,
        updatedAt: nowIso
      };
      onEditPartner(updated);
    } else {
      // Create
      const newPartner: BusinessPartner = {
        id: 'bp_' + Math.random().toString(36).substring(2, 9),
        type: formData.type,
        name: formData.name.trim(),
        country: formData.country.trim(),
        city: formData.city.trim() || undefined,
        address: formData.address.trim() || undefined,
        email: formData.email.trim() || undefined,
        contactPerson: formData.contactPerson.trim() || undefined,
        phone: formData.phone.trim() || undefined,
        website: formData.website.trim() || undefined,
        status: formData.status,
        evaluation: formData.type === 'Supplier' ? evaluationResult : undefined,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      onAddPartner(newPartner);

      // "Save and add the next one": stays on the form with everything cleared,
      // for the case this dialog is being filled from an existing list. The
      // partner type is kept, since a batch entered together is usually all
      // manufacturers or all suppliers, and the SOP documents are reset because
      // they belong to the record that was just saved.
      if (keepGoing) {
        setSavedCount(n => n + 1);
        setRecentlySaved(prev => [newPartner.name, ...prev].slice(0, 5));
        setFormData(prev => ({
          type: prev.type, name: '', country: '', city: '', address: '',
          email: '', contactPerson: '', phone: '', website: '', status: 'Active',
        }));
        setEvalDocs(getDefaultSupplierEvaluation().documents);
        setFormError(null);
        return;
      }
    }

    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setIsModalOpen(false);
    }, 1000);
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('fa-IR') + ' ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  /** Both grade colour tables lived here; they now come from the shared one. */
  const getGradeBadgeClass = (grade?: string) => describeGrade(grade).tone;

  const getDocStatusInfo = (status: SOPDocumentStatus | null) => {
    switch (status) {
      case 'Approved':
        return { label: 'Approved', desc: 'تایید شده (۱۰۰٪)', badge: 'bg-emerald-500/15 text-emerald-700 border-emerald-300 dark:text-emerald-300 dark:border-emerald-800' };
      case 'Permit Approval':
        return { label: 'Permit Approval', desc: 'تایید مشروط (۵۰٪)', badge: 'bg-amber-500/15 text-amber-700 border-amber-300 dark:text-amber-300 dark:border-amber-800' };
      case 'Expired':
        return { label: 'Expired', desc: 'منقضی شده (۲۵٪)', badge: 'bg-orange-500/15 text-orange-700 border-orange-300' };
      case 'Not Submitted':
        return { label: 'Not Submitted', desc: 'ارائه نشده (۰٪)', badge: 'bg-rose-500/15 text-rose-700 border-rose-300 dark:text-rose-300 dark:border-rose-800' };
      default:
        return { label: 'انتخاب نشده', desc: 'بدون وضعیت', badge: 'bg-muted text-muted-foreground border-border' };
    }
  };

  return (
    <div className="space-y-6 fade-in pb-12" style={{ direction: 'rtl' }}>
      {/* KPI cards — same shape as the materials repository so the two
          repositories read as one product: one card per fact, icon tile on the
          side, number in mono. The gradient hero that used to sit above them
          was a second visual language for the same page and went invisible in
          dark mode, so the title now lives in the toolbar card below, exactly
          as it does in the materials view. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'کل شرکای تجاری', en: 'Total Partners', value: stats.total, Icon: Building2,
            tone: 'bg-muted text-foreground border-border' },
          { label: 'تولیدکنندگان', en: 'Manufacturers', value: stats.manufacturers, Icon: Factory,
            tone: 'bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900' },
          { label: 'فروشندگان', en: 'Suppliers', value: stats.suppliers, Icon: Handshake,
            tone: 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900' },
          { label: 'مجاز برای اتصال به سورس', en: 'Grade A · Approved', value: stats.eligibleSuppliers, Icon: ShieldCheck,
            tone: 'bg-teal-50 text-teal-600 border-teal-100 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-900' },
          { label: 'غیرمجاز برای اتصال', en: 'Below Grade A', value: stats.blockedSuppliers, Icon: AlertTriangle,
            tone: 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900' },
        ].map(card => (
          <div key={card.en} className="bg-card p-3 sm:p-4 rounded-xl border border-border shadow-xs flex items-center gap-3 transition-all hover:shadow-sm">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${card.tone}`}>
              <card.Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              {/* Wraps rather than truncating: «مجاز برای اتصال به سورس» is the
                  whole point of the card and lost its ending at this width. */}
              <div className="text-2xs font-bold text-muted-foreground leading-tight">{card.label}</div>
              {/* The counts come from the same list the table shows, so they
                  cannot claim a number while that list is still loading. */}
              {isLoading
                ? <div className="h-6 w-10 rounded bg-muted animate-pulse mt-1" />
                : <div className="text-xl font-black text-foreground font-mono mt-0.5">{card.value}</div>}
              <div className="text-2xs text-muted-foreground font-mono truncate">{card.en}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Title + toolbar, in the materials-repository layout */}
      <div className="bg-card p-5 sm:p-6 rounded-2xl border border-border shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-mono text-xs uppercase tracking-wider">
              <Building2 className="w-4 h-4" />
              <span>Business Partner & Supplier Quality Evaluation</span>
            </div>
            <h1 className="text-xl font-black text-foreground tracking-tight">مخزن شرکای تجاری و ارزیابی فروشنده</h1>
            <p className="text-xs text-muted-foreground">ثبت تولیدکنندگان و فروشندگان، و ارزیابی کیفی فروشندگان مطابق SOP و موازین GMP</p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                placeholder="جستجو در نام، کشور، شهر، رابط، ایمیل، تلفن"
                className="w-full bg-muted border border-border rounded-xl pr-9 pl-3 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500 focus:bg-card transition-colors"
              />
            </div>

            <button
              disabled={excel.busy}
              onClick={() => excel.run(xl => xl.exportBusinessPartnersToExcel(filteredPartners, db || []))}
              title="خروجی اکسل از شرکای تجاری (طبق فیلترهای فعلی)"
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-muted hover:bg-accent border border-border text-foreground px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>{excel.busy ? 'در حال آماده‌سازی…' : 'خروجی اکسل'}</span>
            </button>
            {excel.error && (
              <p className="text-xs text-rose-600 dark:text-rose-400 self-center">{excel.error}</p>
            )}

            {can(currentUser, 'partner.create') && (
              <button
                onClick={handleOpenAdd}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/20 shrink-0 border border-blue-400/30"
              >
                <Plus className="w-4 h-4" />
                <span>ثبت شریک تجاری جدید</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end gap-2.5 pt-3 border-t border-border">
          <div className="flex items-center gap-1.5 bg-muted border border-border rounded-xl p-1 text-xs shrink-0 overflow-x-auto">
            <Filter className="w-3.5 h-3.5 text-muted-foreground mr-1 shrink-0" />
            {([
              { key: 'All', label: 'همه انواع' },
              { key: 'Manufacturer', label: 'Manufacturer' },
              { key: 'Supplier', label: 'Supplier' },
            ] as const).map(opt => (
              <button
                key={opt.key}
                onClick={() => { setTypeFilter(opt.key as any); setCurrentPage(1); }}
                className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                  typeFilter === opt.key ? 'bg-card shadow text-foreground font-bold' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 flex-1">
            <div>
              <label className="text-2xs font-bold text-muted-foreground block mb-1">وضعیت ارزیابی SOP</label>
              <select
                value={sopStatusFilter}
                onChange={e => { setSopStatusFilter(e.target.value as any); setCurrentPage(1); }}
                className="w-full bg-muted border border-border rounded-xl px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500 focus:bg-card font-medium transition-colors"
              >
                <option value="All">همه وضعیت‌های SOP</option>
                <option value="Approved Supplier">Approved Supplier (تاییدشده)</option>
                <option value="Approved with Monitoring">Approved with Monitoring (با پایش)</option>
                <option value="Conditional Supplier">Conditional Supplier (مشروط)</option>
                <option value="Pending Review">Pending Review (در انتظار تصمیم)</option>
                <option value="Blacklist">Blacklist (لیست سیاه)</option>
                <option value="Not Evaluated">Not Evaluated (ارزیابی نشده)</option>
              </select>
            </div>

            <div>
              <label className="text-2xs font-bold text-muted-foreground block mb-1">رتبه کیفی (Grade)</label>
              <select
                value={gradeFilter}
                onChange={e => { setGradeFilter(e.target.value as any); setCurrentPage(1); }}
                className="w-full bg-muted border border-border rounded-xl px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500 focus:bg-card font-medium transition-colors"
              >
                <option value="All">همه گریدها</option>
                <option value="A">Grade A (تاییدشده: ۸۰-۱۰۰)</option>
                <option value="B">Grade B (با پایش: ۶۰-۷۹)</option>
                <option value="C">Grade C (مشروط: ۴۰-۵۹)</option>
                <option value="Pending Review">Pending Review (در انتظار تصمیم)</option>
                <option value="Blacklist">Blacklist (لیست سیاه: ۰-۳۹)</option>
                <option value="Not Evaluated">ارزیابی نشده</option>
              </select>
            </div>

            <div>
              <label className="text-2xs font-bold text-muted-foreground block mb-1">کشور سازنده / فروشنده</label>
              <select
                value={countryFilter}
                onChange={e => { setCountryFilter(e.target.value); setCurrentPage(1); }}
                className="w-full bg-muted border border-border rounded-xl px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500 focus:bg-card font-medium transition-colors"
              >
                <option value="All">همه کشورها</option>
                {availableCountries.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="text-2xs font-bold text-muted-foreground block mb-1">وضعیت فعالیت سیستم</label>
              <select
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value as any); setCurrentPage(1); }}
                className="w-full bg-muted border border-border rounded-xl px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500 focus:bg-card font-medium transition-colors"
              >
                <option value="All">همه وضعیت‌ها</option>
                <option value="Active">فعال (Active)</option>
                <option value="Inactive">غیرفعال (Inactive)</option>
                <option value="Blacklisted">لیست سیاه (Blacklisted)</option>
              </select>
            </div>
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 dark:text-rose-200 dark:border-rose-900 border rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1 shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>حذف فیلترها</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-card rounded-2xl border border-border shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse" aria-busy={isLoading}>
            <caption className="sr-only">فهرست شرکای تجاری ثبت‌شده</caption>
            <thead>
              <tr className="bg-muted/80 border-b border-border text-muted-foreground text-xs font-bold">
                <SortHeader field="name" label="نام شرکت" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="type" label="نوع" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="country" label="کشور / شهر" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="grade" label="نتیجهٔ ارزیابی SOP" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="status" label="وضعیت سیستم" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="createdAt" label="تاریخ ثبت" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <th scope="col" className="py-3 px-4 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {isLoading ? (
                /* Until the first fetch lands there is nothing to show, and the
                   empty state below would claim the repository is empty. */
                [0, 1, 2, 3, 4].map(i => (
                  <tr key={`skeleton-${i}`} aria-hidden="true">
                    {Array.from({ length: 7 }).map((_, c) => (
                      <td key={c} className="py-3.5 px-4">
                        <div className="h-3.5 rounded bg-muted animate-pulse" style={{ width: c === 0 ? '80%' : c > 4 ? '3rem' : '60%' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginatedPartners.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center">
                    <Building2 className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
                    {hasActiveFilters ? (
                      <div className="space-y-3">
                        <p className="text-muted-foreground">هیچ شریکی با این جستجو یا فیلترها پیدا نشد.</p>
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-muted hover:bg-accent border border-border text-xs font-bold text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          پاک‌کردن جستجو و فیلترها
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-muted-foreground">هنوز شریک تجاری‌ای ثبت نشده است.</p>
                        {can(currentUser, 'partner.create') ? (
                          <button
                            type="button"
                            onClick={handleOpenAdd}
                            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
                          >
                            <Plus className="w-4 h-4" />
                            ثبت اولین شریک تجاری
                          </button>
                        ) : (
                          <p className="text-xs text-muted-foreground">ثبت شریک تجاری در دسترس نقش شما نیست.</p>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedPartners.map(partner => {
                  return (
                    <tr key={partner.id} className="hover:bg-muted/70 transition-colors">
                      {/* Name */}
                      <td className="py-3 px-4 font-bold text-foreground max-w-[18rem] xl:max-w-[26rem]">
                        <EntityName name={partner.name} lines={2} className="font-black whitespace-normal" />
                      </td>

                      {/* Type */}
                      <td className="py-3 px-4">
                        {partner.type === 'Manufacturer' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-900 border">
                            <Factory className="w-3 h-3" />
                            Manufacturer
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900 border">
                            <Handshake className="w-3 h-3" />
                            Supplier
                          </span>
                        )}
                      </td>

                      {/* Country / City */}
                      <td className="py-3 px-4 text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>{partner.country}</span>
                          {partner.city && <span className="text-muted-foreground">({partner.city})</span>}
                        </div>
                      </td>

                      {/* SOP Supplier Evaluation */}
                      <td className="py-3 px-4">
                        {partner.type === 'Supplier' ? (
                          partner.evaluation && partner.evaluation.grade !== 'Not Evaluated' ? (
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-2xs font-bold border ${describeGrade(partner.evaluation.grade).tone}`}>
                                <Award className="w-3 h-3" />
                                {partner.evaluation.grade} · {describeGrade(partner.evaluation.grade).fa}
                              </span>
                              <span className="text-2xs font-mono text-muted-foreground font-bold">
                                ({partner.evaluation.totalScore}/100)
                              </span>
                              {/* The grade alone does not answer the question the
                                  buyer actually has. Only grade A may be attached
                                  to a source, and the server refuses the rest with
                                  422 — so the row says so instead of letting the
                                  refusal come as a surprise later. */}
                              {!canSupplySources(partner).allowed && (
                                <span
                                  title={canSupplySources(partner).reason}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-bold bg-muted text-muted-foreground border border-border"
                                >
                                  <XCircle className="w-3 h-3 shrink-0" />
                                  قابل اتصال به سورس نیست
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground font-semibold bg-muted px-2.5 py-0.5 rounded-md border border-border">
                                ارزیابی نشده
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  handleOpenEdit(partner);
                                  setActiveModalTab('evaluation');
                                }}
                                disabled={!can(currentUser, 'partner.edit')}
                                title={can(currentUser, 'partner.edit') ? undefined : 'ثبت ارزیابی در دسترس نقش شما نیست.'}
                                className="text-2xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-bold underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
                              >
                                شروع ارزیابی
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="text-muted-foreground text-2xs font-mono">- (فقط مخصوص Supplier)</span>
                        )}
                      </td>

                      {/* System Status */}
                      <td className="py-3 px-4">
                        {partner.status === 'Active' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-bold bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-200 dark:border-teal-900 border">
                            <CheckCircle2 className="w-3 h-3" />
                            Active
                          </span>
                        ) : partner.status === 'Blacklisted' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-bold bg-rose-600 text-white border border-rose-700 dark:bg-rose-700 dark:border-rose-800">
                            <AlertTriangle className="w-3 h-3" />
                            Blacklist
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-bold bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900 border">
                            <XCircle className="w-3 h-3" />
                            Inactive
                          </span>
                        )}
                      </td>

                      {/* Created At */}
                      <td className="py-3 px-4 text-muted-foreground font-mono text-2xs">
                        {formatDate(partner.createdAt)}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleOpenView(partner)}
                            className={`p-1.5 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-300 dark:hover:bg-blue-950/50 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
                            title="مشاهده جزئیات کامل"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {/* Delete was gated but edit was not, so a user without
                              `partner.edit` could fill in the whole form only for
                              the server to refuse the save. */}
                          {can(currentUser, 'partner.edit') && (
                            <button
                              onClick={() => handleOpenEdit(partner)}
                              className={`p-1.5 text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:text-amber-300 dark:hover:bg-amber-950/50 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
                              title="ویرایش اطلاعات"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {can(currentUser, 'partner.delete') && (
                            <button
                              onClick={() => handleDeletePartnerClick(partner)}
                              className={`p-1.5 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-300 dark:hover:bg-rose-950/50 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
                              title="حذف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer / Pagination */}
        <div className="px-6 py-3 bg-muted/50 border-t border-border flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex items-center gap-2 text-2xs font-bold text-muted-foreground shrink-0">
            <span>تعداد در هر صفحه</span>
            <select
              value={itemsPerPage}
              onChange={e => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
              className={`bg-card border border-border rounded-lg px-2 py-1 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex-1 min-w-0">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={filteredPartners.length}
              startIndex={(page - 1) * itemsPerPage}
              endIndex={page * itemsPerPage}
              onPageChange={setCurrentPage}
            />
          </div>
        </div>
      </div>

      {/* Add / Edit Partner Modal with Portal & Sticky Header/Footer */}
      <FormModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        size="lg"
        ariaLabel="فرم شریک تجاری"
        unsavedChanges={partnerFormDirty}
        unsavedLabel={editingPartner ? 'تغییرات این شریک تجاری' : 'اطلاعات شریک تجاری جدید'}
      >
            {isSuccess ? (
              <div className="p-16 text-center flex flex-col items-center justify-center fade-in">
                <div className="bg-emerald-500/10 p-4 rounded-full border border-emerald-500/20 mb-6">
                  <CheckCircle className="w-16 h-16 text-emerald-500 bounce-in" />
                </div>
                <h3 className="text-2xl font-bold text-foreground mb-2">
                  {editingPartner ? 'تغییرات شریک تجاری با موفقیت ذخیره شد' : 'شریک تجاری جدید با موفقیت ثبت شد'}
                </h3>
                <p className="text-[#6E6E73] text-sm font-medium">اطلاعات شریک تجاری با موفقیت در سیستم ثبت گردید. در حال بازگشت...</p>
              </div>
            ) : (
              <>
                {/* Sticky Top Header */}
                <div className="sticky top-0 z-30 px-6 py-4 border-b border-border bg-card/95 backdrop-blur-md flex items-center justify-between shrink-0 shadow-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900 border flex items-center justify-center font-bold">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-foreground text-base">
                        {editingPartner ? 'ویرایش اطلاعات شریک تجاری' : 'ثبت شریک تجاری جدید'}
                      </h3>
                      <p className="text-xs text-muted-foreground font-medium mt-0.5">
                        {editingPartner ? 'به‌روزرسانی و مدیریت داده‌های شریک تجاری' : 'ثبت مشخصات و اتصال تولیدکننده/فروشنده در مخزن مرجع'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="p-2 text-muted-foreground hover:text-muted-foreground hover:bg-muted rounded-xl transition-colors cursor-pointer"
                    title="بستن"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Scrollable Form Body */}
                <form id="partner-form" onSubmit={handleSubmitForm} className="p-6 overflow-y-auto flex-1 space-y-6 focus:outline-none">
                  {/* Error Banner */}
                  {formError && (
                    <div className="p-3 bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/50 dark:border-rose-900 dark:text-rose-200 border rounded-xl text-xs font-semibold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {/* Type Switch Header */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground block">
                      نوع موجودیت <span className="text-rose-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({ ...prev, type: 'Manufacturer' }));
                          setActiveModalTab('general');
                          setFormError(null);
                        }}
                        className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                          formData.type === 'Manufacturer'
                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200 border-indigo-500 shadow-sm ring-1 ring-indigo-500'
                            : 'bg-muted border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <Factory className="w-4 h-4" />
                        <span>تولیدکننده (Manufacturer)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({ ...prev, type: 'Supplier' }));
                          setFormError(null);
                        }}
                        className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                          formData.type === 'Supplier'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200 border-emerald-500 shadow-sm ring-1 ring-emerald-500'
                            : 'bg-muted border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <Handshake className="w-4 h-4" />
                        <span>فروشنده / Supplier</span>
                      </button>
                    </div>
                  </div>

                  {/* Modal Navigation Tabs (Only when type === 'Supplier') */}
                  {formData.type === 'Supplier' && (
                    <div className="flex border-b border-border gap-4 pt-1">
                      <button
                        type="button"
                        onClick={() => setActiveModalTab('general')}
                        className={`pb-2 text-xs font-bold transition-colors border-b-2 cursor-pointer ${
                          activeModalTab === 'general'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        ۱. مشخصات عمومی شریک تجاری
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveModalTab('evaluation')}
                        className={`pb-2 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer ${
                          activeModalTab === 'evaluation'
                            ? 'border-emerald-600 text-emerald-600'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>۲. ارزیابی SOP Supplier</span>
                        {computedEval.grade === 'Not Evaluated' ? (
                          <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-muted text-muted-foreground border border-border">
                            ارزیابی نشده
                          </span>
                        ) : (
                          <span className={`px-2 py-0.5 rounded-full font-mono text-2xs font-bold border ${getGradeBadgeClass(computedEval.grade)}`}>
                            {computedEval.grade === 'Pending Review' ? '🟡 Pending' :
                             computedEval.grade === 'Blacklist' ? '🔴 Blacklist' :
                             `Grade ${computedEval.grade}`} ({computedEval.totalScore}/100)
                          </span>
                        )}
                      </button>
                    </div>
                  )}

                  {/* TAB 1: General Info */}
                  {(formData.type === 'Manufacturer' || activeModalTab === 'general') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Name */}
                  <div className="space-y-1 md:col-span-2">
                    <label className="font-semibold text-foreground block">
                      {formData.type === 'Manufacturer' ? 'نام تولیدکننده' : 'نام فروشنده / Supplier'} <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder={formData.type === 'Manufacturer' ? 'مثلاً: BASF SE' : 'مثلاً: Biesterfeld Spezialchemie GmbH'}
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500 focus:bg-card"
                    />
                  </div>


                  {/* Country */}
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground block">
                      کشور <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.country || ''}
                      onChange={e => setFormData({ ...formData, country: e.target.value })}
                      placeholder="مثلاً: آلمان، چین، هند..."
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500 focus:bg-card"
                    />
                  </div>

                  {/* City */}
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground block">شهر</label>
                    <input
                      type="text"
                      value={formData.city || ''}
                      onChange={e => setFormData({ ...formData, city: e.target.value })}
                      placeholder="مثلاً: لودویگزهافن"
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500 focus:bg-card"
                    />
                  </div>

                  {/* Address */}
                  <div className="space-y-1 md:col-span-2">
                    <label className="font-semibold text-foreground block">آدرس کامل</label>
                    <input
                      type="text"
                      value={formData.address || ''}
                      onChange={e => setFormData({ ...formData, address: e.target.value })}
                      placeholder="آدرس دقیق..."
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500 focus:bg-card"
                    />
                  </div>

                  {/* Contact Person */}
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground block">نام رابط / مسئول تماس</label>
                    <input
                      type="text"
                      value={formData.contactPerson || ''}
                      onChange={e => setFormData({ ...formData, contactPerson: e.target.value })}
                      placeholder="مثلاً: Dr. Klaus Weber"
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500 focus:bg-card"
                    />
                  </div>

                  {/* Phone */}
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground block">شماره تماس</label>
                    <input
                      type="text"
                      value={formData.phone || ''}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+49 621 60-0"
                      dir="ltr"
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono focus:outline-none focus:border-blue-500 focus:bg-card"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground block">ایمیل رسمی</label>
                    <input
                      type="email"
                      value={formData.email || ''}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      placeholder="contact@company.com"
                      dir="ltr"
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono focus:outline-none focus:border-blue-500 focus:bg-card"
                    />
                  </div>

                  {/* Website */}
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground block">وبسایت</label>
                    <input
                      type="text"
                      value={formData.website || ''}
                      onChange={e => setFormData({ ...formData, website: e.target.value })}
                      placeholder="https://www.company.com"
                      dir="ltr"
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono focus:outline-none focus:border-blue-500 focus:bg-card"
                    />
                  </div>

                  {/* System Status */}
                  <div className="space-y-1 md:col-span-2">
                    <label className="font-semibold text-foreground block">وضعیت فعالیت در سیستم</label>
                    <div className="flex items-center gap-4 pt-1">
                      <label className="flex items-center gap-2 text-foreground cursor-pointer font-bold">
                        <input
                          type="radio"
                          name="status"
                          checked={formData.status === 'Active'}
                          onChange={() => setFormData({ ...formData, status: 'Active' })}
                          className="text-blue-600 focus:ring-blue-500"
                        />
                        <span>فعال (Active)</span>
                      </label>

                      <label className="flex items-center gap-2 text-foreground cursor-pointer font-bold">
                        <input
                          type="radio"
                          name="status"
                          checked={formData.status === 'Inactive'}
                          onChange={() => setFormData({ ...formData, status: 'Inactive' })}
                          className="text-rose-600 focus:ring-rose-500"
                        />
                        <span>غیرفعال (Inactive)</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Supplier Evaluation (SOP) - Only visible when type === 'Supplier' */}
              {formData.type === 'Supplier' && activeModalTab === 'evaluation' && (
                <div className="space-y-4">
                  {/* Banner */}
                  <div className="p-3 bg-muted/60 border border-border rounded-xl flex items-center justify-between shadow-xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 font-bold text-xs text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="w-4 h-4" />
                        <span>Supplier Evaluation (مطابق SOP شرکت)</span>
                      </div>
                      <p className="text-2xs text-muted-foreground">
                        تعیین وضعیت دقیق ۵ مدرک الزامی SOP جهت محاسبه خودکار امتیاز، Grade و وضعیت تایید Supplier.
                      </p>
                    </div>
                  </div>

                  {/* How much of the attachment budget is spent — the save sends
                      every document in one body, so this is the number that
                      decides whether the server will accept it. */}
                  {docsTotalBytes > 0 && (
                    <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground px-1">
                      <span>مجموع حجم مدارک پیوست: <span className="font-mono font-bold text-foreground">{formatFileSize(docsTotalBytes)}</span> از {formatFileSize(MAX_DOCS_TOTAL_BYTES)}</span>
                      {docsTotalBytes > MAX_DOCS_TOTAL_BYTES * 0.8 && (
                        <span className="text-amber-600 dark:text-amber-400 font-bold">نزدیک به سقف مجاز</span>
                      )}
                    </div>
                  )}

                  {/* SOP Documents Checklist */}
                  <div className="space-y-3">
                    {SOP_DOCUMENTS_DEF.map((def, idx) => {
                      const doc = evalDocs[def.key] || {
                        key: def.key,
                        nameFa: def.nameFa,
                        nameEn: def.nameEn,
                        status: null,
                        score: 0
                      };
                      const statusInfo = getDocStatusInfo(doc.status);

                      return (
                        <div key={def.key} className="p-3.5 bg-muted border border-border rounded-xl space-y-3 hover:border-border transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-muted border border-border text-foreground font-mono text-xs font-bold flex items-center justify-center shrink-0">
                                {idx + 1}
                              </span>
                              <div>
                                <h4 className="text-xs font-black text-foreground">{def.nameEn}</h4>
                                <p className="text-2xs text-muted-foreground font-medium">{def.nameFa}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`px-2 py-0.5 rounded-md text-2xs font-bold border ${statusInfo.badge}`}>
                                {statusInfo.desc}
                              </span>
                              <span className="text-xs font-mono font-bold text-foreground bg-card px-2.5 py-1 rounded-md border border-border">
                                {doc.score} / ۲۰ امتیاز
                              </span>
                            </div>
                          </div>

                          {/* Status Options & File Control */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                            {/* Status Selector Dropdown */}
                            <div className="space-y-1">
                              <label className="text-2xs font-bold text-foreground block">
                                وضعیت مدرک <span className="text-rose-500">*</span>
                              </label>
                              <select
                                value={doc.status || ''}
                                onChange={e => handleDocStatusChange(def.key, e.target.value as SOPDocumentStatus)}
                                className={`w-full text-xs rounded-lg px-3 py-2 border font-bold focus:outline-none transition-colors ${
                                  !doc.status ? 'border-amber-300 bg-amber-50/50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'border-border bg-card text-foreground'
                                }`}
                              >
                                <option value="" disabled>-- انتخاب وضعیت مدرک --</option>
                                <option value="Approved">Approved (تایید شده - ۲۰ امتیاز)</option>
                                <option value="Permit Approval">Permit Approval (تایید مشروط - ۱۰ امتیاز)</option>
                                <option value="Expired">Expired (منقضی شده - ۵ امتیاز)</option>
                                <option value="Not Submitted">Not Submitted (ارائه نشده - ۰ امتیاز)</option>
                              </select>
                            </div>

                            {/* File Upload / Attachment Actions */}
                            <div className="space-y-1">
                              <label className="text-2xs font-bold text-foreground block">
                                فایل پیوست مدرک (اختیاری)
                              </label>

                              {doc.fileName ? (
                                <div className="p-2 bg-card border border-border rounded-lg flex items-center justify-between text-xs gap-2">
                                  <div className="flex items-center gap-1.5 overflow-hidden text-foreground font-medium">
                                    <Paperclip className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                    <span className="truncate text-2xs" title={doc.fileName}>
                                      {doc.fileName}
                                    </span>
                                    {doc.fileSize && (
                                      <span className="text-2xs text-muted-foreground font-mono shrink-0">
                                        ({formatFileSize(doc.fileSize)})
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    {canFiles && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleDocFileView(doc, editingPartner?.id)}
                                          className="p-1 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded"
                                          title="مشاهده فایل"
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDocFileDownload(doc, editingPartner?.id)}
                                          className="p-1 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded"
                                          title="دانلود فایل"
                                        >
                                          <Download className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleDocFileRemove(def.key)}
                                      className="p-1 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded"
                                      title="حذف فایل"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <label className="flex items-center justify-center gap-2 p-2 bg-card border border-dashed border-border rounded-lg text-muted-foreground hover:border-blue-500 hover:text-blue-600 cursor-pointer text-xs transition-colors">
                                  <Upload className="w-3.5 h-3.5" />
                                  <span className="font-semibold text-2xs">انتخاب و بارگذاری فایل مدرک (حداکثر {formatFileSize(MAX_DOC_BYTES)})</span>
                                  <input
                                    type="file"
                                    className="hidden"
                                    onChange={e => {
                                      if (e.target.files && e.target.files[0]) {
                                        handleDocFileUpload(def.key, e.target.files[0]);
                                      }
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary Card (Live Real-time Calculated) */}
                  {/* Inverted with tokens rather than a fixed slate gradient:
                      this panel is the computed result, and it has to keep that
                      contrast in both themes (same treatment as the standard-name
                      preview in the materials repository). */}
                  <div className="p-4 bg-foreground text-background rounded-2xl border border-border shadow-lg space-y-3">
                    <div className="flex items-center justify-between border-b border-background/20 pb-2">
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        <Award className="w-4 h-4 shrink-0" />
                        <span>نتیجه ارزیابی کیفی Supplier (Live SOP Result)</span>
                      </span>
                      <span className="text-2xs text-background/70 font-mono">
                        {computedEval.grade === 'Not Evaluated' ? 'در انتظار امتیازدهی' : 'محاسبه خودکار'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* Total Score */}
                      <div className="bg-background/10 border border-background/20 p-3 rounded-xl text-center space-y-1">
                        <span className="text-2xs text-background/70 font-bold block">مجموع امتیاز (Total Score)</span>
                        <div className="text-xl font-black font-mono">
                          {computedEval.grade === 'Not Evaluated' ? (
                            <span className="text-background/60 text-sm">-- / ۱۰۰</span>
                          ) : (
                            <>
                              {computedEval.totalScore} <span className="text-xs text-background/70">/ ۱۰۰</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Grade */}
                      <div className="bg-background/10 border border-background/20 p-3 rounded-xl text-center space-y-1">
                        <span className="text-2xs text-background/70 font-bold block">رتبه کیفیت (Grade)</span>
                        <div className="flex items-center justify-center">
                          {computedEval.grade === 'Not Evaluated' ? (
                            <span className="px-3 py-1 rounded-lg text-xs font-bold bg-background/10 text-background border border-background/20">
                              ارزیابی نشده
                            </span>
                          ) : (
                            <span className={`px-3 py-0.5 rounded-lg font-mono font-black text-sm border ${getGradeBadgeClass(computedEval.grade)}`}>
                              {computedEval.grade === 'Pending Review' ? '🟡 Pending Review' :
                               computedEval.grade === 'Blacklist' ? '🔴 Blacklist' :
                               `Grade ${computedEval.grade}`}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Supplier Status */}
                      <div className="bg-background/10 border border-background/20 p-3 rounded-xl text-center space-y-1">
                        <span className="text-2xs text-background/70 font-bold block">وضعیت Supplier Status</span>
                        <div className="flex items-center justify-center">
                          {computedEval.grade === 'Not Evaluated' ? (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-background/10 text-background border border-background/20">
                              در انتظار ارزیابی
                            </span>
                          ) : (
                            <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${describeGrade(computedEval.grade).tone}`}>
                              {describeGrade(computedEval.grade).en} ({describeGrade(computedEval.grade).fa})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </form>

                {/* Sticky Bottom Footer */}
                <div className="sticky bottom-0 z-30 px-6 py-4 border-t border-border bg-muted/95 backdrop-blur-md flex items-center justify-between shrink-0 shadow-xs">
                  <div>
                    {formData.type === 'Supplier' && activeModalTab === 'evaluation' && (
                      <button
                        type="button"
                        onClick={() => setActiveModalTab('general')}
                        className="px-4 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:bg-muted font-bold transition-colors cursor-pointer"
                      >
                        بازگشت به اطلاعات پایه
                      </button>
                    )}
                    {formData.type === 'Supplier' && activeModalTab === 'general' && (
                      <button
                        type="button"
                        onClick={() => setActiveModalTab('evaluation')}
                        className="px-4 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-200 dark:border-emerald-900 border text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <span>ادامه به ارزیابی SOP Supplier</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {editingPartner && can(currentUser, 'partner.edit') && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsModalOpen(false);
                          handleDeletePartnerClick(editingPartner);
                        }}
                        className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-200 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 dark:text-rose-200 dark:border-rose-900 border text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="حذف شریک تجاری"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>حذف شریک</span>
                      </button>
                    )}
                    {savedCount > 0 && (
                      <span className="text-2xs font-bold text-emerald-700 dark:text-emerald-300 truncate max-w-[16rem]"
                        title={recentlySaved.join('، ')}>
                        {savedCount.toLocaleString('fa-IR')} شریک ثبت شد
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-accent rounded-xl transition-colors border border-border cursor-pointer"
                    >
                      {savedCount > 0 ? 'پایان' : 'انصراف'}
                    </button>
                    {!editingPartner && (
                      <button
                        type="button"
                        onClick={e => handleSubmitForm(e, true)}
                        title="ذخیره می‌کند، فرم را خالی می‌کند و همین‌جا می‌مانید"
                        className="px-4 py-2 text-xs font-bold text-foreground bg-muted hover:bg-accent rounded-xl transition-colors border border-border cursor-pointer"
                      >
                        ذخیره و ثبت بعدی
                      </button>
                    )}
                    <button
                      type="submit"
                      form="partner-form"
                      className="px-6 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-md shadow-blue-600/20 transition-all active:scale-95 border border-blue-400/30 cursor-pointer"
                    >
                      {editingPartner ? 'ذخیره تغییرات' : 'ثبت در مخزن'}
                    </button>
                  </div>
                </div>
              </>
            )}
      </FormModal>

      {/* Comprehensive View Details Modal (Dashboard for Manufacturer / 3 Cards for Supplier) */}
      <FormModal open={!!(isViewModalOpen && selectedPartner)} onClose={() => setIsViewModalOpen(false)} size="lg" ariaLabel="جزئیات شریک تجاری">
        {selectedPartner && (<>
            {/* Sticky Top Header */}
            <div className="sticky top-0 z-30 px-6 py-4 border-b border-border bg-card/95 backdrop-blur-md flex items-center justify-between shrink-0 shadow-xs">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-2xl ${
                  selectedPartner.type === 'Manufacturer' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                }`}>
                  {selectedPartner.type === 'Manufacturer' ? <Factory className="w-6 h-6" /> : <Handshake className="w-6 h-6" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black text-foreground">{selectedPartner.name}</h2>
                    <span className={`px-2.5 py-0.5 rounded-full text-2xs font-bold border ${
                      selectedPartner.type === 'Manufacturer' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {selectedPartner.type === 'Manufacturer' ? 'Manufacturer (تولیدکننده)' : 'Supplier (فروشنده)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{selectedPartner.country} {selectedPartner.city ? `(${selectedPartner.city})` : ''}</span>
                    <span>•</span>
                    <span>وضعیت سیستم: {
                      selectedPartner.status === 'Active' ? <strong className="text-teal-600">فعال (Active)</strong> :
                      selectedPartner.status === 'Blacklisted' ? <strong className="text-rose-600">⛔ لیست سیاه (Blacklisted)</strong> :
                      <strong className="text-amber-600">غیرفعال (Inactive)</strong>
                    }</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {can(currentUser, 'partner.edit') && selectedPartner.status !== 'Blacklisted' && (
                  <button
                    type="button"
                    onClick={() => { setBlacklistTarget(selectedPartner); setBlacklistReason(''); }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                    title="افزودن به لیست سیاه"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>لیست سیاه</span>
                  </button>
                )}
                {can(currentUser, 'partner.edit') && selectedPartner.status === 'Blacklisted' && (
                  <button
                    type="button"
                    onClick={() => handleRestoreFromBlacklist(selectedPartner)}
                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-200 dark:border-emerald-900 border rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                    title="خروج از لیست سیاه"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>خروج از لیست سیاه</span>
                  </button>
                )}
                {can(currentUser, 'partner.delete') && (
                  <button
                    type="button"
                    onClick={() => handleDeletePartnerClick(selectedPartner)}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                    title="حذف شریک تجاری"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleOpenEdit(selectedPartner)}
                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>ویرایش</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsViewModalOpen(false)}
                  className="p-2 text-muted-foreground hover:text-muted-foreground hover:bg-muted rounded-xl transition-colors cursor-pointer"
                  title="بستن"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6 focus:outline-none">

            {selectedPartner.status === 'Blacklisted' && (
              <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-300 rounded-2xl">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-black text-rose-800">این شریک تجاری در لیست سیاه قرار دارد</div>
                  <p className="text-xs text-rose-700 mt-0.5">امکان انتخاب این شریک برای سورس‌های جدید وجود ندارد. دلیل قرارگیری در لیست سیاه در ردیابی تغییرات (Audit Trail) ثبت شده است.</p>
                </div>
              </div>
            )}

            {/* ========================================================
               CASE A: MANUFACTURER DETAIL DASHBOARD
            ======================================================== */}
            {selectedPartner.type === 'Manufacturer' ? (
              <div className="space-y-6">
                {/* 1. Manufacturer Metadata Grid */}
                <div className="bg-muted rounded-2xl border border-border/80 p-4 space-y-3">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 border-b border-border/60 pb-2">
                    <Factory className="w-4 h-4 text-indigo-600" />
                    <span>مشخصات مدیریتی تولیدکننده</span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">نام تولیدکننده</span>
                      <span className="font-bold text-foreground">{selectedPartner.name}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">کشور / شهر</span>
                      <span className="font-bold text-foreground">{selectedPartner.country} {selectedPartner.city ? `(${selectedPartner.city})` : ''}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">مسئول تماس / رابط</span>
                      <span className="font-bold text-foreground">{selectedPartner.contactPerson || '-'}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">شماره تماس</span>
                      <span className="font-bold font-mono text-foreground dir-ltr text-right block">{selectedPartner.phone || '-'}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">ایمیل</span>
                      <span className="font-bold font-mono text-foreground dir-ltr text-right block">{selectedPartner.email || '-'}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">وبسایت رسمی</span>
                      {selectedPartner.website ? (
                        <a
                          href={selectedPartner.website.startsWith('http') ? selectedPartner.website : `https://${selectedPartner.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline font-mono dir-ltr inline-flex items-center gap-1 font-bold text-2xs"
                        >
                          {selectedPartner.website}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>

                    {selectedPartner.address && (
                      <div className="sm:col-span-2 md:col-span-3">
                        <span className="text-muted-foreground text-2xs block font-medium">آدرس کامل</span>
                        <span className="text-foreground leading-relaxed">{selectedPartner.address}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Connected sources */}
                {renderConnectedSources(selectedPartner)}

              </div>
            ) : (
              /* ========================================================
                 CASE B: SUPPLIER DETAIL VIEW (3 Structured Cards)
              ======================================================== */
              <div className="space-y-6">
                {/* 1. General Information Card */}
                <div className="bg-muted rounded-2xl border border-border p-4 space-y-3">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 border-b border-border/60 pb-2">
                    <Handshake className="w-4 h-4 text-emerald-600" />
                    <span>۱. مشخصات عمومی Supplier</span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">نام فروشنده / Supplier</span>
                      <span className="font-black text-foreground">{selectedPartner.name}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">کشور / شهر</span>
                      <span className="font-bold text-foreground">{selectedPartner.country} {selectedPartner.city ? `(${selectedPartner.city})` : ''}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">مسئول تماس / رابط</span>
                      <span className="font-bold text-foreground">{selectedPartner.contactPerson || '-'}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">شماره تماس</span>
                      <span className="font-bold font-mono text-foreground dir-ltr text-right block">{selectedPartner.phone || '-'}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">ایمیل رسمی</span>
                      <span className="font-bold font-mono text-foreground dir-ltr text-right block">{selectedPartner.email || '-'}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground text-2xs block font-medium">وبسایت</span>
                      {selectedPartner.website ? (
                        <a
                          href={selectedPartner.website.startsWith('http') ? selectedPartner.website : `https://${selectedPartner.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline font-mono dir-ltr inline-flex items-center gap-1 font-bold text-2xs"
                        >
                          {selectedPartner.website}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>

                    {selectedPartner.address && (
                      <div className="sm:col-span-2 md:col-span-3">
                        <span className="text-muted-foreground text-2xs block font-medium">آدرس کامل</span>
                        <span className="text-foreground leading-relaxed">{selectedPartner.address}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Supplier Evaluation Summary Card */}
                <div className="p-4 bg-foreground text-background rounded-2xl border border-border shadow-lg space-y-3">
                  <div className="flex items-center justify-between border-b border-background/20 pb-2">
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      <Award className="w-4 h-4 shrink-0" />
                      <span>۲. خلاصه ارزیابی کیفی Supplier (SOP Quality Result)</span>
                    </span>
                    <span className="text-2xs text-background/70 font-mono">آخرین به‌روزرسانی: {formatDate(selectedPartner.updatedAt)}</span>
                  </div>

                  {selectedPartner.evaluation && selectedPartner.evaluation.grade !== 'Not Evaluated' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* Total Score */}
                      <div className="bg-background/10 border border-background/20 p-3 rounded-xl text-center space-y-1">
                        <span className="text-2xs text-background/70 font-bold block">مجموع امتیاز ارزیابی (Score)</span>
                        <div className="text-2xl font-black font-mono">
                          {selectedPartner.evaluation.totalScore} <span className="text-xs text-background/70">/ ۱۰۰</span>
                        </div>
                      </div>

                      {/* Grade */}
                      <div className="bg-background/10 border border-background/20 p-3 rounded-xl text-center space-y-1">
                        <span className="text-2xs text-background/70 font-bold block">رتبه کیفیت (Grade)</span>
                        <div className="flex items-center justify-center">
                          <span className={`px-3 py-0.5 rounded-lg font-mono font-black text-sm border ${getGradeBadgeClass(selectedPartner.evaluation.grade)}`}>
                            {selectedPartner.evaluation.grade === 'Pending Review' ? '🟡 Pending Review' :
                             selectedPartner.evaluation.grade === 'Blacklist' ? '🔴 Blacklist' :
                             `Grade ${selectedPartner.evaluation.grade}`}
                          </span>
                        </div>
                      </div>

                      {/* Supplier Status */}
                      <div className="bg-background/10 border border-background/20 p-3 rounded-xl text-center space-y-1">
                        <span className="text-2xs text-background/70 font-bold block">وضعیت Supplier Status</span>
                        <div className="flex items-center justify-center">
                          <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${describeGrade(selectedPartner.evaluation.grade).tone}`}>
                            {describeGrade(selectedPartner.evaluation.grade).en} ({describeGrade(selectedPartner.evaluation.grade).fa})
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-background/10 border border-background/20 rounded-xl text-center space-y-1">
                      <span className="font-bold text-xs block">ارزیابی کیفی SOP برای این فروشنده هنوز انجام نشده است.</span>
                      <p className="text-2xs text-background/70">می‌توانید با ویرایش اطلاعات این شریک تجاری، ارزیابی مدارک ۵گانه را ثبت و نهایی نمایید.</p>
                    </div>
                  )}
                </div>

                {/* SOP evaluation history & trend (reconstructed from audit trail) */}
                {evalHistory.length > 0 && (
                  <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <History className="w-4 h-4 text-indigo-600" />
                        <span>تاریخچه و روند ارزیابی SOP <span className="text-muted-foreground font-normal font-mono">(Evaluation History)</span></span>
                      </h3>
                      <span className="text-2xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-bold">{evalHistory.length} تغییر</span>
                    </div>

                    {evalHistory.length >= 2 && (
                      <div className="h-44 w-full" dir="ltr">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={evalHistory.map((h, i) => ({
                            idx: i + 1,
                            label: new Date(h.date).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }),
                            score: h.totalScore,
                          }))} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'Vazirmatn FD' }} />
                            <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                            <RTooltip contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }} formatter={(v: any) => [`${v}`, 'Score']} />
                            <Line type="monotone" dataKey="score" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3, fill: '#4f46e5' }} activeDot={{ r: 5 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b border-border">
                            <th className="text-right font-semibold py-2 px-2">تاریخ</th>
                            <th className="text-center font-semibold py-2 px-2">امتیاز</th>
                            <th className="text-center font-semibold py-2 px-2">تغییر</th>
                            <th className="text-center font-semibold py-2 px-2">گرید</th>
                            <th className="text-right font-semibold py-2 px-2">کاربر</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...evalHistory].reverse().map((h, i, arr) => {
                            const prev = arr[i + 1];
                            const delta = prev ? +(h.totalScore - prev.totalScore).toFixed(1) : null;
                            return (
                              <tr key={h.id} className="border-b border-border hover:bg-muted/60">
                                <td className="py-2 px-2 text-foreground">{new Date(h.date).toLocaleDateString('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                                <td className="py-2 px-2 text-center font-mono font-bold text-foreground">{h.totalScore}</td>
                                <td className="py-2 px-2 text-center font-mono">
                                  {delta === null || delta === 0 ? <span className="text-muted-foreground">—</span> : delta > 0 ? <span className="text-emerald-600">▲ {delta}</span> : <span className="text-red-500">▼ {Math.abs(delta)}</span>}
                                </td>
                                <td className="py-2 px-2 text-center">
                                  {h.grade ? <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold border ${getGradeBadgeClass(h.grade)}`}>{h.grade}</span> : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="py-2 px-2 text-muted-foreground">{h.user}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 3. SOP Documents Table Card */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5 border-b border-border pb-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>۳. وضعیت مدارک ۵گانه الزامی SOP (SOP Documents Verification)</span>
                  </h3>

                  {selectedPartner.evaluation ? (
                    <div className="border border-border rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-muted border-b border-border font-bold text-muted-foreground">
                          <tr>
                            <th className="py-2.5 px-3">نام مدرک SOP</th>
                            <th className="py-2.5 px-3">وضعیت مدرک</th>
                            <th className="py-2.5 px-3">امتیاز مکتسبه</th>
                            <th className="py-2.5 px-3 text-center">فایل پیوست</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {SOP_DOCUMENTS_DEF.map(def => {
                            const doc = selectedPartner.evaluation?.documents?.[def.key];
                            const statusInfo = getDocStatusInfo(doc?.status || null);

                            return (
                              <tr key={def.key} className="hover:bg-muted/60 transition-colors">
                                <td className="py-2.5 px-3 font-semibold text-foreground">
                                  <div className="font-bold text-foreground">{def.nameEn}</div>
                                  <div className="text-2xs text-muted-foreground">{def.nameFa}</div>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className={`px-2 py-0.5 rounded-md text-2xs font-bold border ${statusInfo.badge}`}>
                                    {statusInfo.desc}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold text-foreground">
                                  {doc?.score || 0} / ۲۰
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  {doc?.fileName ? (
                                    <div className="flex items-center justify-center gap-1">
                                      {canFiles ? (
                                        <>
                                          <button
                                            onClick={() => doc && handleDocFileView(doc, selectedPartner?.id)}
                                            className="p-1 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded"
                                            title="مشاهده"
                                          >
                                            <Eye className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            onClick={() => doc && handleDocFileDownload(doc, selectedPartner?.id)}
                                            className="p-1 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded"
                                            title="دانلود"
                                          >
                                            <Download className="w-3.5 h-3.5" />
                                          </button>
                                        </>
                                      ) : (
                                        <span
                                          className="text-2xs text-muted-foreground"
                                          title="حساب کاربری شما مجوز دریافت مدارک SOP را ندارد."
                                        >
                                          بدون مجوز دریافت
                                        </span>
                                      )}
                                      <span className="text-2xs text-muted-foreground truncate max-w-[120px] font-mono" title={doc.fileName}>
                                        {doc.fileName}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground text-2xs">ثبت نشده</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 bg-muted border border-border rounded-xl text-center text-muted-foreground text-xs">
                      مدارک ثبت نشده است.
                    </div>
                  )}
                </div>

                {/* Connected sources */}
                {renderConnectedSources(selectedPartner)}
              </div>
            )}

            </div>

            {/* Sticky Bottom Footer */}
            <div className="sticky bottom-0 z-30 px-6 py-4 border-t border-border bg-muted/95 backdrop-blur-md flex items-center justify-between shrink-0 shadow-xs text-2xs text-muted-foreground font-mono">
              <div>تاریخ ایجاد: {formatDate(selectedPartner.createdAt)}</div>
              <button
                type="button"
                onClick={() => setIsViewModalOpen(false)}
                className="px-6 py-2.5 rounded-xl bg-muted hover:bg-accent border border-border text-foreground font-sans font-bold text-xs transition-colors cursor-pointer"
              >
                بستن
              </button>
            </div>
</>)}
      </FormModal>

      {/* Blacklist Confirmation Modal (reason required) */}
      <FormModal open={!!blacklistTarget} onClose={() => setBlacklistTarget(null)} size="sm"
        role="alertdialog" closeOnBackdrop={false} className="p-6 space-y-4" ariaLabel="تأیید انتقال به لیست سیاه">
        {blacklistTarget && (<>
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <div className="p-2.5 bg-rose-600 text-white rounded-xl">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-foreground text-sm">افزودن به لیست سیاه</h3>
                <p className="text-2xs text-muted-foreground mt-0.5">{blacklistTarget.name}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              با این کار، این شریک تجاری در لیست سیاه قرار می‌گیرد و دیگر قابل انتخاب برای سورس‌های جدید نخواهد بود. ثبت دلیل الزامی است و در ردیابی تغییرات ذخیره می‌شود.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground block">دلیل قرارگیری در لیست سیاه <span className="text-rose-500">*</span></label>
              <textarea
                dir="rtl"
                rows={3}
                value={blacklistReason}
                onChange={e => setBlacklistReason(e.target.value)}
                placeholder="مثلاً: عدم انطباق مکرر کیفی، تخلف قراردادی، مشکلات رگولاتوری..."
                className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-rose-500 focus:bg-card resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setBlacklistTarget(null); setBlacklistReason(''); }}
                className="px-4 py-2 bg-muted hover:bg-accent border border-border text-foreground rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={!blacklistReason.trim()}
                onClick={confirmBlacklist}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>تأیید و افزودن به لیست سیاه</span>
              </button>
            </div>
</>)}
      </FormModal>

      {/* Custom Deletion Confirmation Modal */}
      <FormModal open={!!partnerToDelete} onClose={() => setPartnerToDelete(null)} size="sm"
        role="alertdialog" closeOnBackdrop={false} className="p-6 space-y-4" ariaLabel="تأیید حذف شریک تجاری">
        {partnerToDelete && (<>
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-foreground">تایید حذف شریک تجاری</h3>
                <p className="text-xs text-muted-foreground mt-0.5">این عملیات غیر قابل بازگشت است.</p>
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-2 leading-relaxed">
              <p>
                آیا از حذف شریک تجاری <strong className="text-foreground">"{partnerToDelete.name}"</strong> اطمینان دارید؟
              </p>
              {partnerToDelete.type === 'Supplier' ? (
                <p className="text-rose-700 bg-rose-50/50 p-2 rounded-lg font-medium border border-rose-100">
                  ⚠️ با حذف این فروشنده، کلیه سوابق ارزیابی SOP و فایل‌های پیوست آن نیز برای همیشه از سیستم پاک خواهد شد.
                </p>
              ) : (
                <p className="text-amber-700 bg-amber-50/50 p-2 rounded-lg font-medium border border-amber-100">
                  ⚠️ با حذف این تولیدکننده، اطلاعات پایه آن حذف خواهد شد.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setPartnerToDelete(null)}
                className="px-4 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:bg-muted font-bold transition-colors cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 transition-colors cursor-pointer"
              >
                بله، حذف شود
              </button>
            </div>
</>)}
      </FormModal>

      {/* Custom Deletion Constraints Warning Modal */}
      <FormModal open={!!deleteConstraintError} onClose={() => setDeleteConstraintError(null)} size="md" closeOnBackdrop={true} className="p-6 space-y-4" ariaLabel="هشدار محدودیت حذف">
        {deleteConstraintError && (<>
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-foreground">
                  {deleteConstraintError.type === 'Manufacturer' ? 'امکان حذف این تولیدکننده وجود ندارد' : 'امکان حذف این فروشنده وجود ندارد'}
                </h3>
                <p className="text-xs text-rose-600 font-bold mt-0.5">خطای یکپارچگی داده‌ها (Data Integrity Constraints)</p>
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-3 leading-relaxed">
              <div className="p-3 bg-rose-50/80 border border-rose-200/80 rounded-xl text-rose-900 font-bold leading-relaxed text-xs">
                {deleteConstraintError.type === 'Manufacturer' ? (
                  <>
                    <strong className="block text-sm mb-1">امکان حذف این تولیدکننده وجود ندارد.</strong>
                    این تولیدکننده به یک یا چند Source یا فروشنده اختصاص داده شده است و حذف آن امکان‌پذیر نیست.
                  </>
                ) : (
                  <>
                    <strong className="block text-sm mb-1">امکان حذف این فروشنده وجود ندارد.</strong>
                    این فروشنده در یک یا چند Source استفاده شده است و حذف آن باعث از بین رفتن یکپارچگی سوابق سیستم می‌شود.
                  </>
                )}
              </div>

              {deleteConstraintError.sources && deleteConstraintError.sources.length > 0 && (
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto bg-muted border border-border rounded-xl p-3">
                  <p className="font-bold text-2xs text-foreground mb-1 flex items-center gap-1.5 border-b border-border/60 pb-1.5">
                    <Package className="w-4 h-4 text-indigo-600" />
                    <span>تعداد {deleteConstraintError.sources.length} سورس (Source) به این رکورد متصل هستند:</span>
                  </p>
                  <ul className="space-y-1">
                    {deleteConstraintError.sources.map(src => (
                      <li key={src.id} className="flex items-center justify-between text-2xs bg-card p-1.5 rounded-lg border border-border font-bold">
                        <span className="text-foreground">{src.material || src.name}</span>
                        <span className="text-muted-foreground font-medium font-mono">({src.country || 'نامشخص'})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-2xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-xl p-3 leading-relaxed">
                ℹ️ <strong>توصیه یکپارچگی داده‌ها:</strong> برای حفظ کامل سوابق تاریخی بر اساس GMP و ALCOA+، می‌توانید به جای حذف، وضعیت رکورد را به حالت <strong>غیرفعال (Inactive)</strong> تغییر دهید.
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setDeleteConstraintError(null)}
                className="px-5 py-2 rounded-xl bg-foreground text-background hover:opacity-90 text-xs font-bold shadow-md transition-opacity cursor-pointer"
              >
                متوجه شدم
              </button>
            </div>
</>)}
      </FormModal>
    </div>
  );
};
