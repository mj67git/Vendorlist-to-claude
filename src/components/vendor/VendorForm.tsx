import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Building, Building2, CheckCircle, Handshake, Info, Plus, X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { FormModal } from '../../components/FormModal';
import { MaterialSelector } from '../../components/MaterialSelector';
import { PartnerSelector } from '../../components/PartnerSelector';
import { EntityName } from '../../components/EntityName';
import { ShamsiDatePicker } from '../../components/ShamsiDatePicker';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { categoryLabels } from '../../constants/categories';
import { authFetch } from '../../services/authFetch';
import { BusinessPartner, Category, Material, SOPDocumentEval, SOPDocumentKey, SOPDocumentStatus, Status, SupplierEvaluation, User, Vendor } from '../../types';
import { SOP_DOCUMENTS_DEF, computeSupplierEvaluation } from '../../utils/sopEvaluation';
import { hasQcReject } from '../../utils/vendorState';
import { checkLicenseExpiry } from '../../utils/vendorUtils';

// extracted from App.tsx

// --- View: Vendor Form (Add / Edit) ---
export function VendorForm({ onClose, onSave, categoryId, existingVendor, currentUser, db = [], materials = [], onAddMaterial, partners = [], onAddPartner, registerNavGuard, onSaved }: { onClose: () => void, onSave: (v: Vendor, msg?: string | null) => void, categoryId: Category, existingVendor?: Vendor, currentUser: User | null, db?: Vendor[], materials?: Material[], onAddMaterial?: (m: Material) => void, partners?: BusinessPartner[], onAddPartner?: (p: BusinessPartner) => void, registerNavGuard?: (fn: (() => boolean) | null) => void, onSaved?: () => void }) {
  const [isSuccess, setIsSuccess] = useState(false);
  
  // Create autocomplete suggestions
  const materialSuggestions = Array.from(new Set(db.map(v => v.material).filter(Boolean)));
  const materialEnSuggestions = Array.from(new Set(db.map(v => v.materialEn).filter(Boolean)));

  const initialSourceType = existingVendor ? (
    ['approved_samples', 'rejected_samples', 'sample'].includes(existingVendor.category as string) ? 'domestic' : existingVendor.category
  ) : categoryId;
      
  const [sourceType, setSourceType] = useState<string>(initialSourceType);
  const [isSample, setIsSample] = useState<boolean>(existingVendor ? !!existingVendor.isSample : false);
  const [sampleStatus, setSampleStatus] = useState<string>(() => {
    if (existingVendor) {
      const initial = existingVendor.initialSampleStatus;
      if (initial === 'rejected' || initial === 'reject') return 'rejected';
      if (initial === 'conditional' || initial === 'not_approved') return 'not_approved';
      if (initial === 'approved') return 'approved';
      if (existingVendor.status === 'rejected') return 'rejected';
      if (existingVendor.status === 'conditional') return 'not_approved';
      return 'approved';
    }
    return 'approved';
  });

  const [formData, setFormData] = useState({
    materialId: existingVendor?.materialId || '',
    material: existingVendor?.material || '',
    materialEn: existingVendor?.materialEn || '',
    cas: existingVendor?.cas || '',
    irc: existingVendor?.irc || '',
    lastAudit: existingVendor?.lastAudit || '',
    ircExpiryDate: existingVendor?.ircExpiryDate || '',
    name: existingVendor?.name || '',
    nameEn: existingVendor?.nameEn || '',
    contactInfo: existingVendor?.contactInfo || '',
    grade: existingVendor?.grade || 'new',
    status: existingVendor?.status || 'new',
    rejectionReasonList: existingVendor?.rejectionReasons?.join('\n') || ''
  });

  // Business Partner Selection States
  const [selectedManufacturerId, setSelectedManufacturerId] = useState<string>(() => {
    if (existingVendor?.manufacturerId) return existingVendor.manufacturerId;
    if (existingVendor?.name) {
      // A supplier no longer points at a manufacturer, so the old lookup that
      // read `match.manufacturerId` off a Supplier record has gone: the field
      // does not exist on the table and always came back undefined.
      const mfgMatch = partners.find(p => p.type === 'Manufacturer' && p.name.trim().toLowerCase() === existingVendor.name.trim().toLowerCase());
      if (mfgMatch) return mfgMatch.id;
    }
    return '';
  });

  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(() => {
    if (existingVendor?.supplierId) return existingVendor.supplierId;
    if (existingVendor?.name) {
      const match = partners.find(p => p.type === 'Supplier' && p.name.trim().toLowerCase() === existingVendor.name.trim().toLowerCase());
      if (match) return match.id;
    }
    return '';
  });

  // Modal display states for partner creation
  const [showNewSupplierModal, setShowNewSupplierModal] = useState(false);
  // The inline "new partner" modal covers both partner kinds; suppliers are the
  // only ones that carry an SOP evaluation (flat partner model).
  const [newPartnerType, setNewPartnerType] = useState<'Manufacturer' | 'Supplier'>('Manufacturer');
  const [newPartnerError, setNewPartnerError] = useState<string | null>(null);

  /**
   * Which required field is missing, if any.
   *
   * This used to be a native `alert()`: it blocked the whole interface, could
   * not be styled or laid out right-to-left, and once dismissed left no trace
   * of which field it was talking about. The error now lives next to the field
   * it belongs to, and submitting scrolls that field into view and focuses it.
   */
  const [fieldError, setFieldError] = useState<null | 'material' | 'partner' | 'irc'>(null);
  const materialFieldRef = useRef<HTMLDivElement | null>(null);
  const partnerFieldRef = useRef<HTMLDivElement | null>(null);
  const ircFieldRef = useRef<HTMLDivElement | null>(null);

  // Modals Data State

  const [newSupplierTab, setNewSupplierTab] = useState<'general' | 'evaluation'>('general');
  const [newSupplierData, setNewSupplierData] = useState({
    name: '',
    country: 'ایران',
    city: '',
    address: '',
    email: '',
    contactPerson: '',
    phone: '',
    website: '',
    status: 'Active' as 'Active' | 'Inactive'
  });

  // Unset, exactly as the partner module's form opens. These used to default
  // to Approved, so a supplier created from here was born with a full 100 and
  // a Grade A that nobody had actually assessed.
  const [newSupplierSopDocs, setNewSupplierSopDocs] = useState<{
    manufacturerLetter: SOPDocumentStatus | null;
    authorizedSignatory: SOPDocumentStatus | null;
    businessLicense: SOPDocumentStatus | null;
    officialEnglishTranslation: SOPDocumentStatus | null;
    legalization: SOPDocumentStatus | null;
  }>({
    manufacturerLetter: null,
    authorizedSignatory: null,
    businessLicense: null,
    officialEnglishTranslation: null,
    legalization: null
  });

  const selectedManufacturer = partners.find(p => p.type === 'Manufacturer' && p.id === selectedManufacturerId);
  const selectedSupplier = partners.find(p => p.type === 'Supplier' && p.id === selectedSupplierId);
  // "Not Evaluated" is a real stored grade, so an evaluation object alone does
  // not mean anyone has assessed the documents.
  const sopEvaluated = !!selectedSupplier?.evaluation && selectedSupplier.evaluation.grade !== 'Not Evaluated';

  // Helper Audit
  const logSourceSelectionAudit = (action: string, details: string, beforeValue: any, afterValue: any) => {
    authFetch('/api/audit-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'Source Evaluation Form',
        action: action,
        entityType: 'SourceSelection',
        entityId: existingVendor?.id || 'new_source',
        entityName: formData.material || 'سورس جدید',
        severity: 'info',
        description: details,
        beforeValue,
        afterValue
      })
    }).catch(err => console.error("Failed to sync selection audit log:", err));
  };


  // Scoring and grading live in utils/sopEvaluation — this form must not carry
  // its own copy of the rubric, or the two drift apart.
  const computeNewSupplierEval = (): SupplierEvaluation => {
    const documents = {} as Record<SOPDocumentKey, SOPDocumentEval>;
    SOP_DOCUMENTS_DEF.forEach(def => {
      documents[def.key] = {
        key: def.key,
        nameFa: def.nameFa,
        nameEn: def.nameEn,
        status: newSupplierSopDocs[def.key] ?? null,
        score: 0,
      };
    });
    return {
      ...computeSupplierEvaluation(documents),
      updatedBy: currentUser?.name || 'مدیر سیستم',
    };
  };

  const handleCreateSupplier = (e: React.FormEvent) => {
    e.preventDefault();

    // Report what is missing instead of returning silently. This form used to
    // also require a previously selected manufacturer, which the flat partner
    // model removed — leaving the submit button doing nothing at all.
    if (!newSupplierData.name.trim()) {
      setNewPartnerError('نام شریک تجاری الزامی است.');
      setNewSupplierTab('general');
      return;
    }
    if (!newSupplierData.country.trim()) {
      setNewPartnerError('کشور مبدا الزامی است.');
      setNewSupplierTab('general');
      return;
    }
    setNewPartnerError(null);

    const isSupplier = newPartnerType === 'Supplier';
    // Only suppliers are SOP-evaluated.
    const evaluation = isSupplier ? computeNewSupplierEval() : undefined;

    const newSupplier: BusinessPartner = {
      id: (isSupplier ? 'bp_sup_' : 'bp_mfg_') + Math.random().toString(36).substring(2, 9),
      type: newPartnerType,
      name: newSupplierData.name.trim(),
      country: newSupplierData.country.trim(),
      city: newSupplierData.city.trim() || undefined,
      address: newSupplierData.address.trim() || undefined,
      email: newSupplierData.email.trim() || undefined,
      contactPerson: newSupplierData.contactPerson.trim() || undefined,
      phone: newSupplierData.phone.trim() || undefined,
      website: newSupplierData.website.trim() || undefined,
      status: newSupplierData.status,
      evaluation: evaluation as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (onAddPartner) {
      onAddPartner(newSupplier);
    }

    // Route the new partner into the matching field so the source form picks it
    // up straight away (the two are mutually exclusive).
    if (isSupplier) {
      setSelectedSupplierId(newSupplier.id);
      setSelectedManufacturerId('');
    } else {
      setSelectedManufacturerId(newSupplier.id);
      setSelectedSupplierId('');
    }

    logSourceSelectionAudit(
      isSupplier ? 'CreateSupplierInsideSource' : 'CreateManufacturerInsideSource',
      `ایجاد ${isSupplier ? 'فروشنده' : 'تولیدکننده'} جدید از داخل فرم سورس: ${newSupplier.name}`,
      null,
      newSupplier
    );

    setNewSupplierData({
      name: '',
      country: 'ایران',
      city: '',
      address: '',
      email: '',
      contactPerson: '',
      phone: '',
      website: '',
      status: 'Active'
    });
    setNewSupplierSopDocs({
      manufacturerLetter: null,
      authorizedSignatory: null,
      businessLicense: null,
      officialEnglishTranslation: null,
      legalization: null
    });
    setNewSupplierTab('general');
    setShowNewSupplierModal(false);
  };

  // While this form is a page of its own, leaving it is ordinary navigation —
  // so it registers the same unsaved-changes guard a detail page uses. It
  // reports dirty only once something actually changed, otherwise merely
  // opening and leaving the form would nag.
  /** How many records this sitting has produced, shown next to the button. */
  const [savedCount, setSavedCount] = useState(0);
  const [recentlySaved, setRecentlySaved] = useState<Array<{ id: string; label: string }>>([]);

  const pristineRef = useRef(JSON.stringify({ formData, selectedManufacturerId, selectedSupplierId, isSample, sourceType, sampleStatus }));
  const savedRef = useRef(false);
  useEffect(() => {
    if (!registerNavGuard) return;
    registerNavGuard(() => {
      if (savedRef.current) return false;
      return JSON.stringify({ formData, selectedManufacturerId, selectedSupplierId, isSample, sourceType, sampleStatus }) !== pristineRef.current;
    });
    return () => registerNavGuard(null);
  }, [registerNavGuard, formData, selectedManufacturerId, selectedSupplierId, isSample, sourceType, sampleStatus]);

  /**
   * IRC is the 16-digit IFDA code. It stays optional, but a half-typed one is
   * worse than an empty one: it looks like a filed licence and is unsearchable.
   * Persian/Arabic digits are normalised on the way in so a user typing on a
   * Persian keyboard is not told their correct code is wrong.
   */
  const IRC_LENGTH = 16;
  const toFaDigits = (n: number | string) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  const toLatinDigits = (input: string) =>
    input
      .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776))
      .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632));
  const ircDigits = formData.irc.trim();
  const isIrcValid = ircDigits === '' || /^\d{16}$/.test(ircDigits);
  const ircTooShort = ircDigits !== '' && /^\d+$/.test(ircDigits) && ircDigits.length !== IRC_LENGTH;
  /**
   * Records predating this rule carry things like "N/A". Blocking on an
   * untouched legacy value would make those sources uneditable, so the warning
   * still shows but only a *changed* value blocks the save.
   */
  const isLegacyIrcUntouched = !!existingVendor && (existingVendor.irc || '') === formData.irc;
  const blocksSubmitOnIrc = !isIrcValid && !isLegacyIrcUntouched;

  /**
   * Empty the form for the next record without leaving the page.
   *
   * The category, the source type and the sample flag are kept on purpose: a
   * pile of records transcribed in one sitting is almost always of one kind,
   * and clearing them would mean re-picking the same two answers every time.
   * Everything identifying the record itself is cleared, and the pristine
   * snapshot is retaken so the unsaved-changes guard does not think the fresh
   * empty form is a half-finished one.
   */
  const resetForNext = () => {
    setFormData({
      materialId: '', material: '', materialEn: '', cas: '', irc: '',
      lastAudit: '', ircExpiryDate: '', name: '', nameEn: '', contactInfo: '',
      grade: 'new', status: 'new', rejectionReasonList: '',
    });
    setSelectedManufacturerId('');
    setSelectedSupplierId('');
    setFieldError(null);
    savedRef.current = false;
    window.setTimeout(() => {
      pristineRef.current = JSON.stringify({
        formData: {
          materialId: '', material: '', materialEn: '', cas: '', irc: '',
          lastAudit: '', ircExpiryDate: '', name: '', nameEn: '', contactInfo: '',
          grade: 'new', status: 'new', rejectionReasonList: '',
        },
        selectedManufacturerId: '', selectedSupplierId: '',
        isSample, sourceType, sampleStatus,
      });
      materialFieldRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      materialFieldRef.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    }, 0);
  };

  const focusMissingField = (which: 'material' | 'partner' | 'irc') => {
    setFieldError(which);
    const target =
      which === 'material' ? materialFieldRef.current
      : which === 'partner' ? partnerFieldRef.current
      : ircFieldRef.current;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.querySelector<HTMLElement>('button, input, select')?.focus();
  };

  const handleSubmit = (e: React.FormEvent, keepGoing = false) => {
    e.preventDefault();

    if (!formData.materialId) {
      focusMissingField('material');
      return;
    }

    if (!selectedManufacturerId && !selectedSupplierId) {
      focusMissingField('partner');
      return;
    }

    // IRC stays optional, but a filled one must be the real 16-digit code.
    if (blocksSubmitOnIrc) {
      focusMissingField('irc');
      return;
    }

    setFieldError(null);

    const newId = existingVendor?.id || ('v' + Math.random().toString(36).substring(2, 6));
    const finalPartnerDisplayName = selectedSupplier?.name || selectedManufacturer?.name || formData.name;
    
    // Process rejections
    const rejectLines = formData.rejectionReasonList.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    let finalIsSample = isSample;
    let finalCategory = finalIsSample ? 'sample' as Category : sourceType as Category;
    let finalGrade = existingVendor ? existingVendor.grade : (finalIsSample ? null : 'new');
    let finalStatus = existingVendor ? existingVendor.status : (finalIsSample ? 'approved' : 'new');
    let finalInitialSampleStatus: Status | null = null;

    if (finalIsSample) {
      finalCategory = 'sample';
      finalGrade = null; // samples don't have evaluation grade

      const initialMap: Record<string, 'approved' | 'conditional' | 'rejected'> = {
        approved: 'approved',
        not_approved: 'conditional',
        rejected: 'rejected'
      };
      finalInitialSampleStatus = initialMap[sampleStatus] || 'approved';

      // A sample is blacklisted by a single failing QC result. Use the shared
      // predicate rather than re-counting here, so this form cannot drift from
      // the rule the rest of the app applies (applyDerivedState re-checks it on
      // save anyway).
      finalStatus = hasQcReject(existingVendor) ? 'rejected' : finalInitialSampleStatus;
    } else {
      finalInitialSampleStatus = null;
      if (existingVendor) {
        if (existingVendor.isSample) {
          finalStatus = 'new';
          finalGrade = 'new';
          finalCategory = sourceType as Category;
        } else {
          finalStatus = existingVendor.status;
          finalGrade = existingVendor.grade;
          if (existingVendor.category === 'blacklist') {
            finalCategory = 'blacklist';
          } else {
            finalCategory = sourceType as Category;
          }
        }
      } else {
        // A brand-new source always starts as 'new'; it can only reach the
        // blacklist through an explicit decision later. (The branch that used
        // to read formData.grade here was unreachable — this form never sets
        // those fields — and grade must never feed the rejection decision.)
        finalStatus = 'new';
        finalGrade = 'new';
      }
    }

    const hasStatusChanged = existingVendor && existingVendor.status !== finalStatus;
    const hasGradeChanged = existingVendor && existingVendor.grade !== finalGrade;
    const statusTextMap = { approved: 'تایید شده', conditional: 'تایید مشروط', rejected: 'مردود', new: 'جدید' };
    
    let actionDetail = existingVendor 
      ? `ویرایش اطلاعات سورس "${formData.material}" (${finalPartnerDisplayName})`
      : `ثبت سورس جدید "${formData.material}" (${finalPartnerDisplayName}) در دسته ${categoryLabels[finalCategory as keyof typeof categoryLabels]?.fa || finalCategory}`;
    
    if (existingVendor && existingVendor.materialId !== formData.materialId) {
      actionDetail += ` | تغییر ماده از [${existingVendor.material || 'نامشخص'}] به [${formData.material}]`;
    }

    if (hasStatusChanged) {
      actionDetail += ` | تغییر وضعیت از [${statusTextMap[existingVendor.status] || existingVendor.status}] به [${statusTextMap[finalStatus] || finalStatus}]`;
    }
    if (hasGradeChanged) {
      actionDetail += ` | تغییر درجه کیفی از [Grade ${existingVendor.grade || 'نامشخص'}] به [Grade ${finalGrade || 'نامشخص'}]`;
    }

    const newLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 8),
      action: actionDetail,
      date: new Date().toLocaleString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
      user: currentUser?.name || 'کاربر سیستم'
    };

    const finalCas = formData.cas;
    const finalIrc = formData.irc;
    const finalLastAudit = formData.lastAudit;
    const finalIrcExpiryDate = formData.ircExpiryDate;
    const finalName = selectedSupplier?.name || selectedManufacturer?.name || formData.name;
    const finalNameEn = selectedSupplier?.nameEn || selectedManufacturer?.nameEn || (sourceType === 'domestic' ? '' : formData.nameEn);
    const finalCountry = selectedSupplier?.country || selectedManufacturer?.country || existingVendor?.country || 'نامشخص';
    const finalContactInfo = selectedSupplier 
      ? `${selectedSupplier.contactPerson || ''}\n${selectedSupplier.phone || ''}\n${selectedSupplier.email || ''}`
      : (selectedManufacturer 
          ? `${selectedManufacturer.contactPerson || ''}\n${selectedManufacturer.phone || ''}\n${selectedManufacturer.email || ''}`
          : formData.contactInfo);

    const vendorContext: Vendor = {
      ...existingVendor,
      id: newId,
      category: finalCategory,
      materialId: formData.materialId,
      material: formData.material,
      materialEn: formData.materialEn,
      cas: finalCas,
      irc: finalIrc,
      lastAudit: finalLastAudit,
      ircExpiryDate: finalIrcExpiryDate || undefined,
      name: finalName,
      nameEn: finalNameEn,
      country: finalCountry,
      contactInfo: finalContactInfo,
      manufacturerId: selectedManufacturerId,
      supplierId: selectedSupplierId || null,
      grade: finalGrade,
      status: finalStatus,
      scores: existingVendor?.scores || null, 
      rejectionReasons: rejectLines.length > 0 ? rejectLines : null,
      registrationDate: existingVendor?.registrationDate || new Date().toLocaleDateString('fa-IR'),
      isSample: finalIsSample,
      initialSampleStatus: finalInitialSampleStatus || undefined,
      activityLogs: [...(existingVendor?.activityLogs || []), newLog]
    } as Vendor;

    savedRef.current = true;
    registerNavGuard?.(null);
    onSave(vendorContext, null);

    // "Save and add the next one": the record is stored and the form empties in
    // place, so someone transcribing a stack of sources from an old file never
    // leaves this page. The category and the source type are kept, since the
    // next record in the pile is almost always of the same kind, and the
    // material field takes focus because that is where the entry starts.
    if (keepGoing && !existingVendor) {
      setSavedCount(n => n + 1);
      setRecentlySaved(prev => [
        { id: newId, label: `${formData.material || finalName}${finalPartnerDisplayName ? ` — ${finalPartnerDisplayName}` : ''}` },
        ...prev,
      ].slice(0, 5));
      resetForNext();
      return;
    }

    setIsSuccess(true);
    setTimeout(() => {
      (onSaved ?? onClose)();
    }, 1000);
  };

  if (isSuccess) {
    return (
      <Card className="p-12 text-center flex flex-col items-center justify-center mt-6 fade-in shadow-sm border-border bg-card" dir="rtl">
        <div className="bg-emerald-500/10 p-4 rounded-full border border-emerald-500/20 mb-6">
          <CheckCircle className="w-14 h-14 text-emerald-500 bounce-in" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-2">{existingVendor ? 'تغییرات با موفقیت ذخیره شد' : 'سورس جدید با موفقیت ثبت شد'}</h3>
        <p className="text-muted-foreground text-sm font-medium">اطلاعات با موفقیت در آرشیو ثبت گردید. در حال بازگشت...</p>
      </Card>
    );
  }

  return (
    <Card className="w-full shadow-sm text-right mt-6 fade-in relative border-border bg-card overflow-hidden" dir="rtl">
      
      {/* Modals inside form */}
      <AnimatePresence>
        {/* The standalone "new manufacturer" modal was unreachable dead UI —
            nothing ever set showNewMfgModal. Both partner kinds are now created
            through the single "ثبت تأمین‌کننده جدید" modal below. */}

        <FormModal
          open={showNewSupplierModal}
          onClose={() => { setShowNewSupplierModal(false); setNewPartnerError(null); }}
          size="md"
          className="p-6"
          ariaLabel="ثبت تأمین‌کننده جدید"
        >
              <div className="flex justify-between items-center border-b border-border pb-3 mb-3 shrink-0">
                <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                  <Handshake className="w-5 h-5 text-primary" />
                  ثبت تأمین‌کننده جدید (New Business Partner)
                </h3>
                <button type="button" onClick={() => { setShowNewSupplierModal(false); setNewPartnerError(null); }} className="p-1.5 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Partner kind — manufacturers and suppliers are independent records */}
              <div className="shrink-0 mb-3">
                <label className="text-xs font-bold text-foreground block mb-1.5">نوع موجودیت <span className="text-rose-500">*</span></label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { key: 'Manufacturer', label: 'تولیدکننده (Manufacturer)', icon: Building2,
                      on: 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm ring-1 ring-indigo-500' },
                    { key: 'Supplier', label: 'فروشنده / Supplier', icon: Handshake,
                      on: 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm ring-1 ring-emerald-500' },
                  ] as const).map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => { setNewPartnerType(opt.key); setNewSupplierTab('general'); setNewPartnerError(null); }}
                      className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        newPartnerType === opt.key ? opt.on : 'bg-muted border-border text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      <opt.icon className="w-4 h-4" />
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  {newPartnerType === 'Supplier'
                    ? 'فروشنده‌ها ارزیابی مدارک SOP دارند و گرید کیفی می‌گیرند.'
                    : 'تولیدکننده‌ها ارزیابی SOP ندارند؛ فقط مشخصات عمومی ثبت می‌شود.'}
                </p>
              </div>

              {/* Navigation Tabs — the SOP step exists for suppliers only */}
              {newPartnerType === 'Supplier' && (
                <div className="flex gap-2 border-b border-border pb-2 mb-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => setNewSupplierTab('general')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      newSupplierTab === 'general' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-slate-200'
                    }`}
                  >
                    ۱. مشخصات عمومی
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewSupplierTab('evaluation')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      newSupplierTab === 'evaluation' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-slate-200'
                    }`}
                  >
                    ۲. ارزیابی مدارک SOP
                    <span className="bg-card/20 px-1.5 py-0.2 rounded text-[10px]">
                      امتیاز: {computeNewSupplierEval().totalScore}
                    </span>
                  </button>
                </div>
              )}

              <form onSubmit={handleCreateSupplier} className="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
                {newPartnerError && (
                  <div className="bg-rose-50 border border-rose-300 text-rose-800 dark:bg-rose-950/40 dark:border-rose-700/50 dark:text-rose-300 rounded-xl p-3 mb-3 flex items-center gap-2 font-semibold fade-in">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {newPartnerError}
                  </div>
                )}

                {/* Same fields, in the same order, as the partner form in the
                    business-partner module — this dialog writes the same record,
                    so asking for a different set of details (it used to open on
                    a Persian *and* an English name, which that form does not
                    collect at all) produced partners that looked different
                    depending on where they were created. */}
                {(newSupplierTab === 'general' || newPartnerType !== 'Supplier') ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1 md:col-span-2">
                      <label className="font-semibold text-foreground block">
                        {newPartnerType === 'Manufacturer' ? 'نام تولیدکننده' : 'نام فروشنده / Supplier'} <span className="text-rose-500">*</span>
                      </label>
                      <input required type="text" className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500 focus:bg-card" value={newSupplierData.name}
                        onChange={e => setNewSupplierData({ ...newSupplierData, name: e.target.value })}
                        placeholder={newPartnerType === 'Manufacturer' ? 'مثلاً: BASF SE' : 'مثلاً: Biesterfeld Spezialchemie GmbH'} />
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-foreground block">کشور <span className="text-rose-500">*</span></label>
                      <input required type="text" className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500 focus:bg-card" value={newSupplierData.country}
                        onChange={e => setNewSupplierData({ ...newSupplierData, country: e.target.value })}
                        placeholder="مثلاً: آلمان، چین، هند..." />
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-foreground block">شهر</label>
                      <input type="text" className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500 focus:bg-card" value={newSupplierData.city}
                        onChange={e => setNewSupplierData({ ...newSupplierData, city: e.target.value })}
                        placeholder="مثلاً: لودویگزهافن" />
                    </div>

                    <div className="space-y-1 md:col-span-2">
                      <label className="font-semibold text-foreground block">آدرس کامل</label>
                      <input type="text" className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500 focus:bg-card" value={newSupplierData.address}
                        onChange={e => setNewSupplierData({ ...newSupplierData, address: e.target.value })}
                        placeholder="آدرس دقیق..." />
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-foreground block">نام رابط / مسئول تماس</label>
                      <input type="text" className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-blue-500 focus:bg-card" value={newSupplierData.contactPerson}
                        onChange={e => setNewSupplierData({ ...newSupplierData, contactPerson: e.target.value })}
                        placeholder="مثلاً: Dr. Klaus Weber" />
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-foreground block">شماره تماس</label>
                      <input type="text" dir="ltr" className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono focus:outline-none focus:border-blue-500 focus:bg-card" value={newSupplierData.phone}
                        onChange={e => setNewSupplierData({ ...newSupplierData, phone: e.target.value })}
                        placeholder="+49 621 60-0" />
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-foreground block">ایمیل رسمی</label>
                      <input type="email" dir="ltr" className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono focus:outline-none focus:border-blue-500 focus:bg-card" value={newSupplierData.email}
                        onChange={e => setNewSupplierData({ ...newSupplierData, email: e.target.value })}
                        placeholder="contact@company.com" />
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-foreground block">وبسایت</label>
                      <input type="text" dir="ltr" className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-left font-mono focus:outline-none focus:border-blue-500 focus:bg-card" value={newSupplierData.website}
                        onChange={e => setNewSupplierData({ ...newSupplierData, website: e.target.value })}
                        placeholder="https://www.company.com" />
                    </div>

                    {/* Active/Inactive only, as in the partner module: blacklisting
                        is a separate action there and requires a written reason. */}
                    <div className="space-y-1 md:col-span-2">
                      <label className="font-semibold text-foreground block">وضعیت فعالیت در سیستم</label>
                      <div className="flex items-center gap-4 pt-1">
                        <label className="flex items-center gap-2 text-foreground cursor-pointer font-bold">
                          <input type="radio" name="new-partner-status"
                            checked={newSupplierData.status === 'Active'}
                            onChange={() => setNewSupplierData({ ...newSupplierData, status: 'Active' })}
                            className="text-blue-600 focus:ring-blue-500" />
                          <span>فعال (Active)</span>
                        </label>
                        <label className="flex items-center gap-2 text-foreground cursor-pointer font-bold">
                          <input type="radio" name="new-partner-status"
                            checked={newSupplierData.status === 'Inactive'}
                            onChange={() => setNewSupplierData({ ...newSupplierData, status: 'Inactive' })}
                            className="text-rose-600 focus:ring-rose-500" />
                          <span>غیرفعال (Inactive)</span>
                        </label>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-muted p-3 rounded-xl border border-border flex items-center justify-between">
                      <div className="text-xs font-bold text-foreground">
                        نتیجه محاسبه ارزیابی SOP: <span className="text-primary">{computeNewSupplierEval().status}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">امتیاز کل: <strong>{computeNewSupplierEval().totalScore} / 100</strong></span>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold text-white ${
                          computeNewSupplierEval().grade === 'A' ? 'bg-emerald-600' :
                          computeNewSupplierEval().grade === 'B' ? 'bg-blue-600' :
                          computeNewSupplierEval().grade === 'C' ? 'bg-amber-600' :
                          computeNewSupplierEval().grade === 'Pending Review' ? 'bg-yellow-600' : 'bg-rose-600'
                        }`}>
                          گرید {computeNewSupplierEval().grade}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {[
                        { key: 'manufacturerLetter', label: '۱. نامه نمایندگی از سازنده (Authorization Letter)' },
                        { key: 'authorizedSignatory', label: '۲. تعهدنامه صاحبان امضای مجاز (Authorized Signatory)' },
                        { key: 'businessLicense', label: '۳. پروانه کسب یا مدرک ثبتی معتبر (Business License)' },
                        { key: 'officialEnglishTranslation', label: '۴. ترجمه رسمی انگلیسی مدارک (English Translation)' },
                        { key: 'legalization', label: '۵. تاییدیه سفارت یا آپوستیل (Embassy Legalization)' }
                      ].map((doc) => (
                        <div key={doc.key} className="flex items-center justify-between p-2.5 bg-card border border-border rounded-xl">
                          <span className="font-semibold text-foreground">{doc.label}</span>
                          <select
                            value={(newSupplierSopDocs as any)[doc.key] ?? ''}
                            onChange={(e) => setNewSupplierSopDocs({ ...newSupplierSopDocs, [doc.key]: (e.target.value || null) as SOPDocumentStatus | null })}
                            className="bg-muted border border-border rounded-lg px-2 py-1 text-xs font-bold text-foreground focus:outline-none focus:border-ring"
                          >
                            <option value="">ارزیابی نشده</option>
                            <option value="Approved">تایید شده (۲۰ امتیاز)</option>
                            <option value="Permit Approval">تایید با مجوز (۱۰ امتیاز)</option>
                            <option value="Expired">منقضی شده (۵ امتیاز)</option>
                            <option value="Not Submitted">عدم ارائه (۰ امتیاز)</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-border shrink-0">
                  <button type="button" onClick={() => { setShowNewSupplierModal(false); setNewPartnerError(null); }} className="px-4 py-2 hover:bg-accent text-muted-foreground rounded-lg font-semibold">انصراف</button>
                  <button type="submit" className="px-5 py-2 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary-hover transition-colors">
                    {newPartnerType === 'Supplier' ? 'ثبت و انتخاب فروشنده' : 'ثبت و انتخاب تولیدکننده'}
                  </button>
                </div>
              </form>
        </FormModal>
      </AnimatePresence>

      <div className="p-5 border-b border-border flex justify-between items-center bg-muted/40 rounded-t-2xl">
        <h2 className="text-base font-bold flex items-center gap-2 text-foreground">
          {existingVendor ? <Building className="w-5 h-5 text-primary" /> : <Plus className="w-5 h-5 text-primary" />}
          {existingVendor ? 'ویرایش سورس' : 'افزودن سورس جدید'}
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* One scroller, not two. The body used to carry `max-h-[80vh]
          overflow-y-auto`, which put a second scrollbar inside the page's own:
          measured 921px of content in a 760px panel, itself inside an 887px
          page viewport. The wheel then moved whichever of the two happened to
          be under the pointer. This is a page, not a modal (project rule 8b),
          so the page scrolls it. */}
      <div className="p-6 space-y-6 text-sm">
          {/* SECTION 1: MATERIAL MASTER SELECTION */}
          <div className="space-y-3 p-4 bg-muted/70 border border-border/80 rounded-2xl">
            <div className="flex items-center gap-2 pb-2 border-b border-border/60">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-fuchsia-600 text-white text-[11px] font-bold shrink-0">۱</span>
              {/* The badge already numbers the section, so the title no longer
                  repeats it, and the English gloss is gone. */}
              <h3 className="text-xs font-black text-foreground">انتخاب ماده اولیه از مخزن مرجع</h3>
            </div>
            
            <div ref={materialFieldRef}>
              <MaterialSelector 
                materials={materials} 
                onAddMaterial={onAddMaterial}
                value={formData.materialId} 
                oldMaterialName={existingVendor?.material}
                onChange={(id, mat) => {
                  setFormData(prev => ({
                    ...prev,
                    materialId: id,
                    material: mat ? mat.nameFa : '',
                    materialEn: mat ? mat.nameEn : '',
                    cas: mat ? mat.cas : '',
                    irc: prev.irc,
                    lastAudit: prev.lastAudit,
                    ircExpiryDate: prev.ircExpiryDate
                  }));
                }}
              />
              {fieldError === 'material' && (
                <p role="alert" className="mt-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                  انتخاب ماده اولیه الزامی است.
                </p>
              )}
            </div>
          </div>

          {/* SECTION 2: SUPPLY CHAIN & PARTNERS */}
          <div className="space-y-4 p-4 bg-muted/70 border border-border/80 rounded-2xl">
            <div className="flex items-center gap-2 pb-2 border-b border-border/60">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold shrink-0">۲</span>
              <h3 className="text-xs font-black text-foreground">زنجیرهٔ تأمین: تولیدکننده و فروشنده</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="vf-source-type" className="text-foreground font-semibold text-xs">نوع دسته‌بندی <span className="text-rose-500">*</span></label>
                <select
                  id="vf-source-type"
                  className={`w-full bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 text-primary font-bold focus:outline-none focus:ring-1 focus:ring-ring ${isSample ? 'opacity-50 cursor-not-allowed' : ''}`} 
                  value={sourceType} 
                  onChange={e => setSourceType(e.target.value)}
                  disabled={isSample}
                >
                  <option value="domestic">خرید داخلی</option>
                  <option value="foreign">خرید خارجی</option>
                  <option value="veterinary">دامی</option>
                  <option value="packaging">اقلام بسته‌بندی</option>
                  <option value="blacklist">لیست سیاه</option>
                </select>
              </div>
              
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input 
                    type="checkbox" 
                    checked={isSample} 
                    onChange={e => setIsSample(e.target.checked)}
                    className="w-4 h-4 accent-primary rounded border-border focus:ring-ring"
                  />
                  <span className="text-xs font-bold text-foreground">این تامین‌کننده به عنوان یک «نمونه» ثبت می‌شود</span>
                </label>

                {isSample && (
                  <div className="space-y-1 fade-in">
                    <label htmlFor="vf-sample-status" className="text-foreground font-semibold text-xs">وضعیت اولیهٔ نمونه</label>
                    <select
                      id="vf-sample-status"
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring" 
                      value={sampleStatus} 
                      onChange={e => setSampleStatus(e.target.value)}
                    >
                      <option value="approved">تایید شده</option>
                      <option value="not_approved">تایید مشروط</option>
                      <option value="rejected">رد شده</option>
                    </select>

                    {existingVendor && hasQcReject(existingVendor) && (
                      <p className="text-rose-500 text-xs mt-1.5 font-medium bg-rose-50 p-2.5 rounded-lg border border-rose-100 leading-relaxed text-right">
                        این Source دارای نتیجه آزمایشگاهی Reject است و وضعیت آن تا زمان اصلاح نتایج آزمایشگاه قابل تغییر نیست.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* PARTNER REPOSITORY INTEGRATION - single supplier/manufacturer selector */}
            <div ref={partnerFieldRef} className="bg-card border border-border p-4 rounded-xl shadow-2xs">
              <PartnerSelector
                partners={partners}
                type="Supplier"
                anyType={true}
                selectedId={selectedManufacturerId || selectedSupplierId}
                onSelect={(newId) => {
                  const oldName = partners.find(p => p.id === (selectedManufacturerId || selectedSupplierId))?.name || 'بدون تأمین‌کننده';
                  const picked = partners.find(p => p.id === newId);
                  const newName = picked?.name || 'بدون تأمین‌کننده';

                  // Route the chosen partner into the correct field by its type;
                  // manufacturers and suppliers are independent now.
                  if (!newId || !picked) {
                    setSelectedManufacturerId('');
                    setSelectedSupplierId('');
                  } else if (picked.type === 'Manufacturer') {
                    setSelectedManufacturerId(newId);
                    setSelectedSupplierId('');
                  } else {
                    setSelectedSupplierId(newId);
                    setSelectedManufacturerId('');
                  }

                  logSourceSelectionAudit(
                    'ChangeSupplier',
                    `تغییر تأمین‌کننده از [${oldName}] به [${newName}]`,
                    oldName,
                    newName
                  );
                }}
                onAddNew={() => {
                  setNewPartnerType('Manufacturer');
                  setNewSupplierTab('general');
                  setNewPartnerError(null);
                  setShowNewSupplierModal(true);
                }}
              />
              <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
                تأمین‌کنندهٔ این سورس می‌تواند یک تولیدکننده یا یک فروشنده باشد.
              </p>
              {fieldError === 'partner' && (
                <p role="alert" className="mt-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                  انتخاب تأمین‌کننده الزامی است. یکی را از مخزن شرکای تجاری انتخاب کنید یا تأمین‌کنندهٔ جدید ثبت کنید.
                </p>
              )}
            </div>

            {/* The selected partner, shown the same way whichever kind it is.
                Manufacturers and suppliers are independent records now, so
                picking a manufacturer is an ordinary choice rather than the
                "direct purchase" shortcut it used to be. This block used to
                announce that in three places at once (a green panel, a badge
                above it, and a second badge on the contact card) and to tell
                the user no supplier evaluation was needed, which only makes
                sense if a supplier were otherwise expected. */}
            {(selectedSupplier || selectedManufacturer) && (
              <div className="bg-muted/60 border border-border rounded-xl p-4 fade-in">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${
                    selectedSupplier
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800'
                  }`}>
                    {selectedSupplier ? 'فروشنده' : 'تولیدکننده'}
                  </span>
                  <EntityName
                    name={(selectedSupplier || selectedManufacturer)!.name}
                    lines={1}
                    className="text-xs font-bold text-foreground"
                  />
                </div>

                {/* Only suppliers carry an SOP evaluation (project rule 4). */}
                {selectedSupplier && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-muted-foreground block mb-0.5 font-medium">امتیاز ارزیابی SOP:</span>
                      {sopEvaluated ? (
                        <span className="font-bold text-foreground font-mono text-sm">{selectedSupplier.evaluation!.totalScore} / ۱۰۰</span>
                      ) : (
                        <span className="font-bold text-muted-foreground">—</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-0.5 font-medium">گرید:</span>
                      {/* Was `grade || 'A'` and `status || 'تایید شده'`: an
                          unevaluated supplier appeared here as an approved
                          Grade A while nobody had assessed a single document. */}
                      {sopEvaluated ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                          گرید {selectedSupplier.evaluation!.grade}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-muted text-muted-foreground border border-border">
                          ارزیابی نشده
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-0.5 font-medium">وضعیت صلاحیت:</span>
                      <span className={`font-bold ${sopEvaluated ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {sopEvaluated ? selectedSupplier.evaluation!.status : 'هنوز ارزیابی نشده است'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Auto-filled read-only fields for selected partner */}
            {(selectedSupplier || selectedManufacturer) && (
              <div className="bg-card border border-border/80 rounded-xl p-4 space-y-3 shadow-2xs">
                <div className="text-foreground font-bold text-xs border-b border-border pb-2 mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-primary" />
                    <span>اطلاعات تماس {selectedSupplier ? 'فروشنده' : 'تولیدکننده'}</span>
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground">از مخزن شرکای تجاری</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs leading-relaxed">
                  <div>
                    <span className="text-muted-foreground block mb-1 font-medium">کشور مبدا:</span>
                    <span className="block text-foreground font-bold ">{(selectedSupplier?.country || selectedManufacturer?.country) || 'نامشخص'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1 font-medium">شهر دفتر/کارخانه:</span>
                    <span className="block text-foreground font-bold ">{(selectedSupplier?.city || selectedManufacturer?.city) || 'نامشخص'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1 font-medium">نام رابط:</span>
                    <span className="block text-foreground font-bold ">{(selectedSupplier?.contactPerson || selectedManufacturer?.contactPerson) || 'نامشخص'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1 font-medium">شماره تماس رابط:</span>
                    <span className="block text-foreground font-bold font-mono text-left" dir="ltr">{(selectedSupplier?.phone || selectedManufacturer?.phone) || 'نامشخص'}</span>
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-muted-foreground block mb-1 font-medium">پست الکترونیکی:</span>
                    <span className="block text-foreground font-bold font-mono text-left" dir="ltr">{(selectedSupplier?.email || selectedManufacturer?.email) || 'نامشخص'}</span>
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-muted-foreground block mb-1 font-medium">نشانی کامل پستی:</span>
                    <span className="block text-foreground font-bold ">{(selectedSupplier?.address || selectedManufacturer?.address) || 'نامشخص'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 3: REGULATORY, IRC & INITIAL STATUS */}
          <div className="space-y-4 p-4 bg-muted/70 border border-border/80 rounded-2xl">
            <div className="flex items-center gap-2 pb-2 border-b border-border/60">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-bold shrink-0">۳</span>
              <h3 className="text-xs font-black text-foreground">اطلاعات رگولاتوری و پروانهٔ IRC</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1" ref={ircFieldRef}>
                <label htmlFor="vf-irc" className="text-foreground font-semibold text-xs flex items-center justify-between gap-2">
                  <span>کد IRC (اختیاری)</span>
                  {ircDigits !== '' && (
                    <span className={`text-[10px] font-mono ${isIrcValid ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                      {ircDigits.replace(/\D/g, '').length}/{IRC_LENGTH}
                    </span>
                  )}
                </label>
                <input
                  id="vf-irc"
                  type="text"
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={IRC_LENGTH}
                  aria-invalid={!isIrcValid}
                  aria-describedby="vf-irc-hint"
                  className={`w-full bg-background border rounded-lg px-3 py-2 text-foreground text-left focus:outline-none focus:ring-1 font-mono text-sm tracking-wider ${
                    !blocksSubmitOnIrc
                      ? 'border-border focus:ring-ring focus:border-ring'
                      : 'border-rose-500 focus:ring-rose-500 focus:border-rose-500'
                  }`}
                  value={formData.irc}
                  onChange={e => {
                    // Keep only digits so a pasted code with dashes/spaces still lands correctly.
                    const cleaned = toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, IRC_LENGTH);
                    setFormData({ ...formData, irc: cleaned });
                    if (fieldError === 'irc') setFieldError(null);
                  }}
                  // The input is dir="ltr", so a Persian placeholder renders with its
                  // parts reordered; the ۱۶-digit rule lives in the hint line instead.
                  placeholder="1228123456789012"
                />
                {isIrcValid ? (
                  <p id="vf-irc-hint" className="text-[11px] text-muted-foreground">
                    کد IRC سازمان غذا و دارو دقیقاً ۱۶ رقم عددی است. اگر هنوز صادر نشده، خالی بگذارید.
                  </p>
                ) : (
                  <p
                    id="vf-irc-hint"
                    role="alert"
                    className={`flex items-start gap-1.5 text-[11px] font-bold ${blocksSubmitOnIrc ? 'text-rose-600' : 'text-amber-600'}`}
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    <span>
                      {!blocksSubmitOnIrc
                        ? `کد IRC ثبت‌شدهٔ این رکورد ${toFaDigits(IRC_LENGTH)} رقم عددی نیست؛ در فرصت مناسب اصلاحش کنید.`
                        : ircTooShort
                          ? `کد IRC باید دقیقاً ${toFaDigits(IRC_LENGTH)} رقم باشد؛ ${toFaDigits(ircDigits.length)} رقم وارد شده است.`
                          : `کد IRC باید ${toFaDigits(IRC_LENGTH)} رقم عددی باشد.`}
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-foreground font-semibold text-xs">تاریخ دریافت / صدور مجوز (اختیاری)</label>
                <ShamsiDatePicker
                  value={formData.lastAudit}
                  onChange={(date) => setFormData({ ...formData, lastAudit: date })}
                  placeholder="انتخاب تاریخ یا مثال: 1403/05/12"
                />
              </div>

              <div className="space-y-1">
                <label className="text-foreground font-semibold text-xs flex items-center justify-between">
                  <span>تاریخ انقضای مجوز (اختیاری)</span>
                  {formData.ircExpiryDate && (
                    <span className="text-[10px] text-muted-foreground font-mono">انقضا</span>
                  )}
                </label>
                <ShamsiDatePicker
                  value={formData.ircExpiryDate}
                  onChange={(date) => setFormData({ ...formData, ircExpiryDate: date })}
                  placeholder="انتخاب تاریخ یا مثال: 1405/05/12"
                />
              </div>

              {/* Not a field: nothing here is editable, and dressing a
                  sentence up as an input invites the user to type in it. */}
              {!existingVendor && (
                <p className="md:col-span-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  سورس با وضعیت «در انتظار بررسی» ثبت می‌شود؛ گرید کیفی در مرحلهٔ ارزیابی تعیین می‌گردد.
                </p>
              )}
            </div>

            {/* Real-time Expiry Status Alert in Form */}
            {formData.ircExpiryDate && (() => {
              const expCheck = checkLicenseExpiry(formData.ircExpiryDate);
              if (expCheck.status === 'expired') {
                return (
                  <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 text-xs flex items-center gap-2.5 fade-in">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <div>
                      <strong className="font-bold">اخطار انقضای مجوز:</strong> مجوز وارد شده در تاریخ {formData.ircExpiryDate} منقضی شده است ({Math.abs(expCheck.daysLeft || 0)} روز پیش).
                    </div>
                  </div>
                );
              }
              if (expCheck.status === 'expiring_soon') {
                return (
                  <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs flex items-center gap-2.5 fade-in">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <strong className="font-bold">اعلان انقضای مجوز (کمتر از ۲ ماه):</strong> تنها {expCheck.daysLeft} روز تا انقضای این مجوز در تاریخ {formData.ircExpiryDate} باقی‌مانده است.
                    </div>
                  </div>
                );
              }
              if (expCheck.status === 'valid') {
                return (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-2.5 text-xs flex items-center gap-2 fade-in">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>مجوز تا تاریخ <strong>{formData.ircExpiryDate}</strong> دارای اعتبار قانونی است ({expCheck.daysLeft} روز باقی‌مانده).</span>
                  </div>
                );
              }
              return null;
            })()}

            <div className="space-y-1">
              <label htmlFor="vf-deviations" className="text-foreground font-semibold text-xs">سوابق انحرافات (هر مورد در یک خط)</label>
              <textarea id="vf-deviations" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring h-20 placeholder:text-muted-foreground text-xs" value={formData.rejectionReasonList} onChange={e => setFormData({...formData, rejectionReasonList: e.target.value})}></textarea>
            </div>
          </div>

          {/* What this sitting has produced so far. Without it, "save and add
              next" would clear the screen with nothing to show for the work —
              the operator has no way to tell the fifth save from the first, or
              to reach a record they have just entered. */}
          {recentlySaved.length > 0 && (
            <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{savedCount.toLocaleString('fa-IR')} سورس در این نشست ثبت شد</span>
              </div>
              <ul className="mt-2 space-y-1">
                {recentlySaved.map(r => (
                  <li key={r.id} className="text-[11px] text-muted-foreground truncate" title={r.label}>
                    • {r.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose} className="px-4 text-xs font-semibold">
              {savedCount > 0 ? 'پایان و بازگشت به فهرست' : 'انصراف'}
            </Button>
            {!existingVendor && (
              <Button
                type="button"
                variant="outline"
                onClick={e => handleSubmit(e, true)}
                title="ذخیره می‌کند، فرم را خالی می‌کند و در همین صفحه می‌مانید"
                className="px-4 text-xs font-semibold"
              >
                ذخیره و ثبت بعدی
              </Button>
            )}
            <Button type="button" onClick={e => handleSubmit(e)} className="px-5 text-xs font-bold">
              {existingVendor ? 'ثبت تغییرات' : 'ثبت سورس'}
            </Button>
          </div>
        </div>
      </Card>
  );
}

// --- View: Category ---
