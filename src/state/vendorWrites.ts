import type { MutableRefObject } from 'react';
import type { User, Vendor } from '../types';
import { ApiWriteError, authFetch, authWrite, isLocalMode } from '../services/authFetch';
import { fetchAllVendors } from '../services/vendorPages';
import { isAllowedVendor, normalizeAndCleanVendor } from '../utils/vendorNormalize';
import { appendLocalAudit } from '../services/localAudit';
import { isVendorRejected } from '../utils/vendorState';
import type { UseToast } from '../hooks/useToast';

/**
 * Every write a source can receive, and the optimistic bookkeeping around it.
 *
 * This was ~350 lines in the middle of `App.tsx`, wedged between the navigation
 * stack and the material handlers, which is how it came to be edited as four
 * unrelated jobs: the save queue, the rollback rules, the local-mode audit and
 * the poll bookkeeping. They are one job — «the register on screen and the
 * register in PostgreSQL must end up saying the same thing» — and they are
 * hard to hold in view while reading a file that also draws a sidebar.
 *
 * Nothing about the behaviour changed in the move. The optimistic update, the
 * rollback on refusal, the `expectedUpdatedAt` claim, the audit written only in
 * local mode, and the `ownWrites`/`knownTotal` bookkeeping the background poll
 * reads are all exactly as they were.
 *
 * The dependencies arrive as one object rather than a dozen arguments because
 * every one of them is state or a ref owned by `App`: this hook does not own
 * the register, it owns what happens to it.
 */
export interface VendorWriteDeps {
  vendors: Vendor[];
  setVendors: React.Dispatch<React.SetStateAction<Vendor[]>>;
  currentUser: User | null;
  notify: UseToast['notify'];
  /** Writes the saved record onto every history entry that shows it. */
  updateCurrentVendorInHistory: (vendor: Vendor | null) => void;
  /** Used by the delete path to leave the record's own page. */
  selectVendor: (vendor: Vendor | null) => void;
  setSavesInFlight: React.Dispatch<React.SetStateAction<number>>;
  setRemoteChangeCount: React.Dispatch<React.SetStateAction<number>>;
  setDataRevision: React.Dispatch<React.SetStateAction<number>>;
  /** Ids this session wrote, so the poll does not announce them back. */
  ownWritesRef: MutableRefObject<Set<string>>;
  /** Dropped to null by our own insert or delete, which moves the count. */
  knownTotalRef: MutableRefObject<number | null>;
  /**
   * Where the background-sync effect finds the resync function. That effect is
   * declared above the sign-in early return, so it cannot see the function
   * directly — hooks may not move below a return.
   */
  resyncRef: MutableRefObject<((focusVendorId?: string) => Promise<void>) | null>;
}

/**
 * Deliberately not a hook.
 *
 * It holds no state of its own — every piece of state it touches belongs to
 * `App` and arrives in `deps` — and `App` calls it below the sign-in early
 * return, where a real hook may not go without breaking the order of hooks on
 * the next render. Naming it `useVendorWrites` made the linter (correctly)
 * refuse it, and the honest fix is the name, not a suppression: this is a
 * factory that closes over the caller's setters and hands back five functions.
 */
export function createVendorWrites(deps: VendorWriteDeps) {
  const {
    vendors, setVendors, currentUser, notify, updateCurrentVendorInHistory,
    selectVendor, setSavesInFlight, setRemoteChangeCount, setDataRevision,
    ownWritesRef, knownTotalRef, resyncRef,
  } = deps;

  const handleDownloadBackup = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(vendors, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      
      const dateStr = new Date().toLocaleDateString('fa-IR').replace(/\//g, '-');
      downloadAnchor.setAttribute("download", `vendor-scores-backup-${dateStr}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      
      notify('بانک اطلاعاتی لوکال با موفقیت دانلود شد!');
    } catch (err) {
      console.error("Failed to download backup JSON:", err);
      notify('خطا در پشتیبان‌گیری از اطلاعات.', 'error', 3000);
    }
  };
  
  const handleUpdateVendor = (updatedVendor: Vendor, msg?: string | null) => {
    const normalized = normalizeAndCleanVendor(updatedVendor);
    // Ours, so the next background poll does not announce this record back to
    // the person who just saved it.
    ownWritesRef.current.add(normalized.id);
    const original = vendors.find(v => v.id === normalized.id);
  
    setVendors(prev => prev.map(v => (v.id === normalized.id ? normalized : v)));
    updateCurrentVendorInHistory(normalized);
    if (msg !== null) {
      notify(msg || 'تغییرات با موفقیت ذخیره شد!');
    }
  
    if (isLocalMode()) {
      const isSource = !!(normalized.isSample || normalized.category === 'sample');
      const wasRejected = original ? isVendorRejected(original) : false;
      const nowRejected = isVendorRejected(normalized);
      const rejected = nowRejected && !wasRejected;
      const restored = wasRejected && !nowRejected;
      appendLocalAudit({
        user: currentUser?.name, role: currentUser?.role,
        module: isSource ? 'Source Management' : 'Supplier Management',
        action: original ? 'Update' : 'Create',
        entityType: isSource ? 'Source' : 'Supplier',
        entityName: normalized.material || normalized.name || 'سورس',
        severity: rejected || restored ? 'Critical' : original ? 'Warning' : 'Info',
        description: `${original ? 'ویرایش' : 'ثبت'} "${normalized.name || normalized.material}"${rejected ? ' — انتقال به لیست سیاه' : restored ? ' — خروج از لیست سیاه (علت رد برطرف شد)' : ''}`,
        before: original || null, after: normalized,
        reason: normalized.reasonForChange || 'به‌روزرسانی رکورد',
      });
    }
  
    if (!original) {
      // Fallback to traditional monolithic POST if there is no previous record found to diff safely
      authWrite('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized)
      }).catch((err: unknown) => {
        console.error('Failed to sync updated vendor to DB:', err);
        notify(
          err instanceof ApiWriteError ? err.message : 'ارتباط با سرور برقرار نشد؛ تغییر ثبت نشد.',
          'error', 8000,
        );
        resyncVendorsFromServer(normalized.id);
      });
      return;
    }
  
    // Determine fine-grained delta adjustments for API Splitting
    const contactChanged = original.contactInfo !== normalized.contactInfo || original.lastAudit !== normalized.lastAudit || original.ircExpiryDate !== normalized.ircExpiryDate;
    const scoresChanged = JSON.stringify(original.scores) !== JSON.stringify(normalized.scores) || 
                          JSON.stringify(original.rawScores) !== JSON.stringify(normalized.rawScores) || 
                          JSON.stringify(original.rejectionReasons) !== JSON.stringify(normalized.rejectionReasons);
    const logsChanged = JSON.stringify(original.activityLogs) !== JSON.stringify(normalized.activityLogs);
    const analysisChanged = JSON.stringify(original.analysisRecords) !== JSON.stringify(normalized.analysisRecords);
    const riskChanged = JSON.stringify(original.riskAssessment) !== JSON.stringify(normalized.riskAssessment);
    
    const profileChanged = original.material !== normalized.material ||
                           original.materialEn !== normalized.materialEn ||
                           original.cas !== normalized.cas ||
                           original.irc !== normalized.irc ||
                           original.ircExpiryDate !== normalized.ircExpiryDate ||
                           original.name !== normalized.name ||
                           original.nameEn !== normalized.nameEn ||
                           original.country !== normalized.country ||
                           original.grade !== normalized.grade ||
                           original.status !== normalized.status ||
                           original.isSample !== normalized.isSample ||
                           original.initialSampleStatus !== normalized.initialSampleStatus ||
                           // The partner link was missing from both the change
                           // check and the payload, so re-pointing a source at a
                           // different company was never sent to the server: the
                           // name changed and the link silently did not.
                           (original.manufacturerId || null) !== (normalized.manufacturerId || null) ||
                           (original.supplierId || null) !== (normalized.supplierId || null);
  
    /*
     * One request carrying only the parts that changed.
     *
     * This used to be a queue of up to five PATCHes sent strictly one after
     * another, because every one of them is a read-modify-write of the whole
     * source (rule 12) and two in flight at once meant the slower one wrote
     * back its stale copy — which is how a deleted laboratory result used to
     * reappear after a reload. Sending them in order solved that and left
     * something worse in place: a refusal or a dropped connection on the third
     * request left the first two stored, in a combination nobody asked for and
     * the client could not undo.
     *
     * `PUT /api/vendors/:id` checks every part first and writes them in one
     * transaction, so the save either happens or it does not. The parts are
     * still computed separately — an untouched part is left out of the payload
     * and is not written — and the server still records one audit row per part
     * that actually changed.
     */
    const sections: Record<string, unknown> = {};
  
    if (profileChanged) {
      sections.profile = {
        material: normalized.material,
        materialEn: normalized.materialEn,
        cas: normalized.cas,
        irc: normalized.irc,
        ircExpiryDate: normalized.ircExpiryDate,
        name: normalized.name,
        nameEn: normalized.nameEn,
        country: normalized.country,
        grade: normalized.grade,
        status: normalized.status,
        isSample: normalized.isSample,
        initialSampleStatus: normalized.initialSampleStatus,
        manufacturerId: normalized.manufacturerId ?? null,
        supplierId: normalized.supplierId ?? null,
      };
    }
  
    if (contactChanged) {
      sections.contact = {
        contactInfo: normalized.contactInfo,
        lastAudit: normalized.lastAudit,
        ircExpiryDate: normalized.ircExpiryDate,
      };
    }
  
    if (scoresChanged) {
      sections.scores = {
        scores: normalized.scores,
        rawScores: normalized.rawScores,
        rejectionReasons: normalized.rejectionReasons,
      };
    }
  
    // The analysis part carries the activity log with it, the way the old
    // `/analysis` endpoint did; the log is only sent on its own when nothing
    // about the laboratory results changed.
    if (analysisChanged) {
      sections.analysis = {
        analysisRecords: normalized.analysisRecords,
        activityLogs: normalized.activityLogs,
      };
    } else if (logsChanged) {
      sections.logs = { activityLogs: normalized.activityLogs };
    }
  
    if (riskChanged) {
      sections.risk = { riskAssessment: normalized.riskAssessment };
    }
  
    if (Object.keys(sections).length === 0) return;
  
    /*
     * Send it, and treat a refusal as a refusal.
     *
     * The save is one transaction now, so a refusal means nothing was written
     * and the record on the server is still `original`. The resync below is
     * kept anyway: the local copy has already been updated optimistically, and
     * re-reading is the only thing that is true whether the write was refused,
     * lost on the wire, or answered after somebody else had changed the row.
     */
    void (async () => {
      setSavesInFlight(n => n + 1);
      try {
        // What this save was based on. `original` is the copy that was on
        // screen when the form was opened, so its timestamp is exactly the
        // claim the server has to check. Absent (a record this session has
        // never read) means no claim, and the write behaves as it always did.
        const expectedUpdatedAt: string | null = typeof original?.updatedAt === 'string'
          ? original.updatedAt
          : null;
        const saved = await authWrite(`/api/vendors/${normalized.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sections,
            reasonForChange: normalized.reasonForChange,
            expectedUpdatedAt,
          }),
        });
        // Carry the row's new timestamp into the copy on screen. Without this
        // the next edit in this session would claim the timestamp from before
        // this save and be refused as stale — a conflict with nobody on the
        // other side of it (rule 11a).
        const stamp = saved?.vendor?.updatedAt;
        if (typeof stamp === 'string') {
          setVendors(prev => prev.map(v => (v.id === normalized.id ? { ...v, updatedAt: stamp } as Vendor : v)));
          updateCurrentVendorInHistory({ ...normalized, updatedAt: stamp } as Vendor);
        }
      } catch (err: unknown) {
        const reason = err instanceof ApiWriteError ? err.message : 'ارتباط با سرور برقرار نشد؛ تغییر ثبت نشد.';
        console.error('Vendor sync failed:', err);
        notify(reason, 'error', 8000, {
          label: 'بارگذاری دوبارهٔ رکورد',
          run: () => resyncVendorsFromServer(normalized.id),
        });
        resyncVendorsFromServer(normalized.id);
      } finally {
        setSavesInFlight(n => Math.max(0, n - 1));
      }
    })();
  };
  
  /**
   * Pull the sources back from the server and replace the local copy.
   *
   * Used after a write was refused: the optimistic update and its localStorage
   * cache are both showing something the database did not accept, and the only
   * honest way back is to re-read. There is no per-vendor GET, so this refetches
   * the list — which only happens on a failure path.
   */
  const resyncVendorsFromServer = async (focusVendorId?: string) => {
    if (isLocalMode()) return;
    try {
      const rows = await fetchAllVendors<Vendor>({
        fetchPage: async (page, limit) => {
          const res = await authFetch(`/api/vendors?page=${page}&limit=${limit}`);
          if (!res.ok) throw new Error(`vendors page ${page} answered ${res.status}`);
          return res.json();
        },
        // This path exists to correct a wrong local copy, so nothing is shown
        // until the whole list is in hand: painting a prefix would replace one
        // incorrect view with a differently incorrect one.
        onPage: () => {},
      });
      const fresh = rows.filter(isAllowedVendor).map(normalizeAndCleanVendor);
      setVendors(fresh);
      setDataRevision(n => n + 1);
      const focused = focusVendorId ? fresh.find((v: Vendor) => v.id === focusVendorId) : null;
      if (focused) updateCurrentVendorInHistory(focused);
    } catch (err) {
      console.error('Could not re-read sources after a failed write:', err);
    } finally {
      // Whatever the outcome, the offer on screen is answered: either the list
      // now matches the server, or the failure is logged and a later poll will
      // ask again.
      setRemoteChangeCount(0);
    }
  };
  
  // The background-sync effect is declared above the sign-in early return, so
  // it cannot see this function directly (hooks may not move below a return).
  resyncRef.current = resyncVendorsFromServer;
  
  const handleDeleteVendor = (vendorId: string, reasonForChange?: string) => {
    const removed = vendors.find(v => v.id === vendorId);
    // Ours, so the next background poll does not announce this record back to
    // the person who just saved it.
    ownWritesRef.current.add(vendorId);
    // Our own removal moves the register size too; re-baseline on the next poll.
    knownTotalRef.current = null;
    setVendors(prev => prev.filter(v => v.id !== vendorId));
    selectVendor(null);
    notify('سورس با موفقیت حذف شد!');
    if (isLocalMode()) {
      const isSource = !!(removed?.isSample || removed?.category === 'sample');
      appendLocalAudit({ user: currentUser?.name, role: currentUser?.role, module: isSource ? 'Source Management' : 'Supplier Management', action: 'Delete', entityType: isSource ? 'Source' : 'Supplier', entityName: removed?.material || removed?.name || 'سورس', severity: 'Critical', description: `حذف "${removed?.name || removed?.material || vendorId}"`, before: removed || null, after: null, reason: reasonForChange || 'حذف رکورد' });
    }
    // A refused delete has to put the record back: the row was already taken off
    // the screen, so staying quiet would look exactly like a successful delete.
    authWrite(`/api/vendors/${vendorId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reasonForChange })
    }).catch((err: unknown) => {
      console.error('Failed to sync vendor deletion to DB:', err);
      if (removed) setVendors(prev => (prev.some(v => v.id === vendorId) ? prev : [removed, ...prev]));
      notify(
        err instanceof ApiWriteError ? err.message : 'ارتباط با سرور برقرار نشد؛ سورس حذف نشد.',
        'error', 8000,
      );
    });
  };
  
  /**
   * Register a new source.
   *
   * Saving deliberately does not move the user: this used to end by opening the
   * new record's page, which suits someone registering one source in order to
   * score it straight away, and works against someone transcribing a stack of
   * them from an old file — every save landed them on a page they had to leave
   * again. The record is offered on the toast instead, so reaching it is one
   * click for whoever wants it and none for whoever does not.
   */
  /**
   * Register a source, and report whether the database accepted it.
   *
   * The row is still inserted optimistically — the register redraws at once —
   * but the promise settles on the server's answer, so a caller can wait before
   * it navigates or clears a form. It resolves with the stored record, or with
   * `null` once the refusal has been rolled back and shown; it never rejects,
   * because callers that do not care about the outcome (the dashboard's quick
   * add) would otherwise raise an unhandled rejection.
   */
  const handleAddVendor = (newVendor: Vendor): Promise<Vendor | null> => {
    const normalized = normalizeAndCleanVendor(newVendor);
    // Ours: skip it in the next poll, and drop the count baseline so our own
    // new row is not read as somebody else's change to the register size.
    ownWritesRef.current.add(normalized.id);
    knownTotalRef.current = null;
    setVendors(prev => [normalized, ...prev]);
    // No action button on the toast any more: the form now takes the user to
    // the new source's own page, so «مشاهده و امتیازدهی» would point at the
    // page they are already standing on.
    notify(`سورس «${normalized.name || normalized.material || 'جدید'}» ثبت شد.`, 'success', 3000);
    if (isLocalMode()) {
      const isSource = !!(normalized.isSample || normalized.category === 'sample');
      appendLocalAudit({
        user: currentUser?.name, role: currentUser?.role,
        module: isSource ? 'Source Management' : 'Supplier Management',
        action: 'Create', entityType: isSource ? 'Source' : 'Supplier',
        entityName: normalized.material || normalized.name || 'سورس', severity: 'Info',
        description: `ثبت سورس جدید "${normalized.name || normalized.material}"`,
        before: null, after: normalized, reason: 'ثبت سورس جدید',
      });
    }
    /*
     * A refused create used to leave the new source sitting in the list and in
     * the localStorage cache while the database had never heard of it — the
     * next person to open the register saw a source that did not exist. The
     * optimistic row is withdrawn and the server's reason is shown instead.
     */
    setSavesInFlight(n => n + 1);
    return authWrite('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized)
    }).then(() => normalized).catch((err: unknown) => {
      console.error('Failed to sync new vendor to DB:', err);
      setVendors(prev => prev.filter(v => v.id !== normalized.id));
      notify(
        err instanceof ApiWriteError ? err.message : 'ارتباط با سرور برقرار نشد؛ سورس ثبت نشد.',
        'error', 8000,
      );
      return null;
    }).finally(() => setSavesInFlight(n => Math.max(0, n - 1)));
  };

  return {
    handleDownloadBackup,
    handleUpdateVendor,
    resyncVendorsFromServer,
    handleDeleteVendor,
    handleAddVendor,
  };
}
