import type { BusinessPartner, Material, User } from '../types';
import { authFetch, isLocalMode } from '../services/authFetch';
import { appendLocalAudit } from '../services/localAudit';
import { describeError } from '../utils/errorMessage';
import type { UseToast } from '../hooks/useToast';

/**
 * Writes to the two repositories a source points at: materials and partners.
 *
 * Both follow the same shape and neither is the source register, which is why
 * they are here and not in `vendorWrites.ts`: an optimistic update, a request,
 * and — on refusal — the server's reason shown rather than a silent divergence.
 * The audit is written by the server (rule 2); the `appendLocalAudit` calls
 * below only run in local mode, where there is no server to write one.
 *
 * Not a hook, for the same reason `createVendorWrites` is not: it holds no
 * state, and `App` calls it below the sign-in early return.
 */
export interface DomainWriteDeps {
  materials: Material[];
  setMaterials: React.Dispatch<React.SetStateAction<Material[]>>;
  businessPartners: BusinessPartner[];
  setBusinessPartners: React.Dispatch<React.SetStateAction<BusinessPartner[]>>;
  currentUser: User | null;
  notify: UseToast['notify'];
  /** Re-read the collection from the server — used on a 409, where what is on
   *  screen is provably not what is on file. */
  reloadMaterials: () => void | Promise<unknown>;
  reloadPartners: () => void | Promise<unknown>;
}

export function createDomainWrites(deps: DomainWriteDeps) {
  const {
    materials, setMaterials, businessPartners, setBusinessPartners, currentUser, notify,
    reloadMaterials, reloadPartners,
  } = deps;

  // Material changes are persisted and audited server-side (module "مدیریت مواد"),
  // so the client only does an optimistic update and syncs to the API.
  const handleAddMaterial = (newMaterial: Material) => {
    setMaterials(prev => [newMaterial, ...prev]);
    notify('ماده اولیه جدید با موفقیت اضافه شد!');
    if (isLocalMode()) appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'مدیریت مواد', action: 'Create', entityType: 'Material', entityName: newMaterial.nameFa || 'ماده', severity: 'Info', description: `ثبت مادهٔ اولیهٔ جدید "${newMaterial.nameFa || ''}"`, before: null, after: newMaterial, reason: 'ثبت ماده جدید' });
    authFetch('/api/materials', { method: 'POST', body: JSON.stringify(newMaterial) })
      .then(async res => { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'خطا در ثبت ماده'); })
      .catch(err => {
        setMaterials(prev => prev.filter(m => m.id !== newMaterial.id));
        notify(describeError(err, 'ثبت ماده در سرور ناموفق بود.'), 'error', 5000);
      });
  };
  
  const handleEditMaterial = (updatedMaterial: Material, customAction?: string) => {
    const oldMaterial = materials.find(m => m.id === updatedMaterial.id);
    setMaterials(prev => prev.map(m => (m.id === updatedMaterial.id ? updatedMaterial : m)));
    notify('اطلاعات ماده اولیه با موفقیت به‌روزرسانی شد!');
    if (isLocalMode()) appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'مدیریت مواد', action: 'Update', entityType: 'Material', entityName: updatedMaterial.nameFa || 'ماده', severity: 'Warning', description: customAction || `ویرایش مادهٔ اولیه "${updatedMaterial.nameFa || ''}"`, before: oldMaterial || null, after: updatedMaterial, reason: 'ویرایش ماده' });
    // The copy this edit was based on. The server refuses with 409 when the row
    // has moved on since, so a form opened before somebody else's save cannot
    // quietly undo it.
    authFetch(`/api/materials/${updatedMaterial.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...updatedMaterial, expectedUpdatedAt: oldMaterial?.updatedAt ?? null }),
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Re-read on a conflict: what is on screen is not what is on file.
          if (res.status === 409) void reloadMaterials();
          throw new Error(body.error || 'خطا در ویرایش ماده');
        }
        // Carry the row's new timestamp, so the next edit in this session
        // claims the copy the server actually holds.
        const saved = body?.material;
        if (saved?.updatedAt) {
          setMaterials(prev => prev.map(m => (m.id === updatedMaterial.id ? { ...m, updatedAt: saved.updatedAt } as Material : m)));
        }
      })
      .catch(err => {
        if (oldMaterial) setMaterials(prev => prev.map(m => m.id === updatedMaterial.id ? oldMaterial : m));
        notify(describeError(err, 'ویرایش ماده در سرور ناموفق بود.'), 'error', 5000);
      });
  };
  
  const handleDeleteMaterial = async (id: string) => {
    const removed = materials.find(m => m.id === id);
    setMaterials(prev => prev.filter(m => m.id !== id));
    if (isLocalMode()) {
      appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'مدیریت مواد', action: 'Delete', entityType: 'Material', entityName: removed?.nameFa || 'ماده', severity: 'Critical', description: `حذف مادهٔ اولیه "${removed?.nameFa || ''}"`, before: removed || null, after: null, reason: 'حذف ماده' });
      notify('ماده اولیه با موفقیت حذف شد!');
      return;
    }
    try {
      const response = await authFetch(`/api/materials/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'خطا در حذف');
      }
      notify('ماده اولیه با موفقیت حذف شد!');
    } catch (err: unknown) {
      // Put back the one row, rather than the whole list as it stood before the
      // request. Restoring a snapshot also un-does anything that arrived while
      // the request was in flight — another operator's edit, a background
      // refresh — and the user sees their own delete fail and someone else's
      // work disappear with it.
      if (removed) setMaterials(prev => (prev.some(m => m.id === id) ? prev : [removed, ...prev]));
      notify(describeError(err, 'حذف ماده در سرور ناموفق بود.'), 'error', 5000);
    }
  };
  
  // Business-partner changes are audited server-side (authoritative, in the
  // Business Partner Repository module), so the client no longer posts its own
  // audit records — that would double-log every change.
  
  /**
   * Why a rejected save must be surfaced, not logged.
   *
   * Both handlers used to end in `.catch(err => console.error(...))` and never
   * looked at `res.ok`. A 403 (no permission), a 400 (validation) or a 413 (an
   * evaluation whose attached documents exceed the body limit) therefore left
   * the user with a green "saved successfully" toast, the change alive in
   * memory, and nothing on the server — until the next reload silently took it
   * away. For a supplier evaluation in a GxP system that is the worst possible
   * failure mode, so a rejected write now rolls the optimistic update back and
   * says what happened.
   */
  const describePartnerFailure = async (res: Response, fallback: string) => {
    // A refusal does not always carry JSON — a proxy 413 is HTML, and a dropped
    // connection is nothing at all — so the parse is allowed to fail and the
    // status decides the wording instead.
    const body: { error?: unknown } = await res.json().catch(() => ({}));
    if (typeof body.error === 'string' && body.error) return body.error;
    if (res.status === 413) return 'حجم مدارک پیوست بیش از حد مجاز سرور است. فایل‌های کوچک‌تری بارگذاری کنید.';
    if (res.status === 403) return 'دسترسی لازم برای این تغییر را ندارید.';
    return fallback;
  };
  
  const handleAddBusinessPartner = (newPartner: BusinessPartner) => {
    setBusinessPartners(prev => [newPartner, ...prev]);
    if (isLocalMode()) appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'Business Partner Repository', action: 'Create', entityType: 'BusinessPartner', entityName: newPartner.name, severity: 'Info', description: `ثبت شریک تجاری جدید "${newPartner.name}" (${newPartner.type})`, before: null, after: newPartner, reason: 'ثبت شریک تجاری' });
    if (isLocalMode()) {
      notify(`شریک تجاری "${newPartner.name}" با موفقیت اضافه شد!`);
      return;
    }
    authFetch('/api/business-partners', {
      method: 'POST',
      body: JSON.stringify(newPartner)
    })
      .then(async res => {
        if (!res.ok) throw new Error(await describePartnerFailure(res, 'ثبت شریک تجاری در سرور ناموفق بود.'));
        notify(`شریک تجاری "${newPartner.name}" با موفقیت اضافه شد!`);
      })
      .catch(err => {
        // Take back this row only — see the note on the material delete.
        setBusinessPartners(prev => prev.filter(p => p.id !== newPartner.id));
        notify(describeError(err, 'ثبت شریک تجاری در سرور ناموفق بود.'), 'error');
      });
  };
  
  const handleEditBusinessPartner = (updatedPartner: BusinessPartner) => {
    const oldPartner = businessPartners.find(p => p.id === updatedPartner.id);
    setBusinessPartners(prev => prev.map(p => (p.id === updatedPartner.id ? updatedPartner : p)));
    if (isLocalMode()) appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'Business Partner Repository', action: 'Update', entityType: 'BusinessPartner', entityName: updatedPartner.name, severity: 'Warning', description: `ویرایش شریک تجاری "${updatedPartner.name}"`, before: oldPartner || null, after: updatedPartner, reason: 'ویرایش شریک تجاری' });
    if (isLocalMode()) {
      notify(`اطلاعات شریک تجاری "${updatedPartner.name}" با موفقیت به‌روزرسانی شد!`);
      return;
    }
    authFetch(`/api/business-partners/${updatedPartner.id}`, {
      method: 'PUT',
      // Claiming the copy this form was opened on: the server answers 409 when
      // somebody else has saved in the meantime, rather than letting this write
      // replace the whole record — SOP evaluation included — with older values.
      body: JSON.stringify({ ...updatedPartner, expectedUpdatedAt: oldPartner?.updatedAt ?? null })
    })
      .then(async res => {
        if (!res.ok) {
          if (res.status === 409) void reloadPartners();
          throw new Error(await describePartnerFailure(res, 'ذخیرهٔ تغییرات شریک تجاری در سرور ناموفق بود.'));
        }
        const body = await res.json().catch(() => ({}));
        const saved = body?.partner;
        if (saved?.updatedAt) {
          setBusinessPartners(prev => prev.map(p => (p.id === updatedPartner.id ? { ...p, updatedAt: saved.updatedAt } : p)));
        }
        notify(`اطلاعات شریک تجاری "${updatedPartner.name}" با موفقیت به‌روزرسانی شد!`);
      })
      .catch(err => {
        if (oldPartner) setBusinessPartners(prev => prev.map(p => (p.id === updatedPartner.id ? oldPartner : p)));
        notify(describeError(err, 'ذخیرهٔ تغییرات شریک تجاری در سرور ناموفق بود.'), 'error');
      });
  };
  
  const handleDeleteBusinessPartner = (id: string) => {
    const partner = businessPartners.find(p => p.id === id);
    if (!partner) return;
  
    // The server enforces referential integrity and audits both the blocked
    // attempt and the successful delete; revert optimistically on rejection.
    setBusinessPartners(prev => prev.filter(p => p.id !== id));
    if (isLocalMode()) {
      appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: 'Business Partner Repository', action: 'Delete', entityType: 'BusinessPartner', entityName: partner.name, severity: 'Critical', description: `حذف شریک تجاری "${partner.name}"`, before: partner, after: null, reason: 'حذف شریک تجاری' });
      notify('شریک تجاری با موفقیت حذف شد!');
      return;
    }
    authFetch(`/api/business-partners/${id}`, { method: 'DELETE' })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'حذف شریک تجاری در سرور ناموفق بود.');
        }
        notify('شریک تجاری با موفقیت حذف شد!');
      })
      .catch(err => {
        setBusinessPartners(prev => (prev.some(p => p.id === id) ? prev : [partner, ...prev]));
        notify(describeError(err, 'حذف شریک تجاری در سرور ناموفق بود.'), 'error');
      });
  };

  return {
    handleAddMaterial,
    handleEditMaterial,
    handleDeleteMaterial,
    handleAddBusinessPartner,
    handleEditBusinessPartner,
    handleDeleteBusinessPartner,
  };
}
