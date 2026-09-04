import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle, FileSpreadsheet, KeyRound, Loader2,
  Pencil, Plus, Search, ShieldCheck, SlidersHorizontal, Trash2, UserCog, UserX,
  Users as UsersIcon,
} from 'lucide-react';
import { Input, inputBaseClass } from './ui/input';
import { Button } from './ui/button';
import { EntityName } from './EntityName';
import { FormModal } from './FormModal';
import { authFetch, isLocalMode } from '../services/authFetch';
import { useDirtySnapshot } from '../utils/useDirtySnapshot';
import { Role, User } from '../types';
import { cn } from '../lib/utils';
import { SortHeader } from './ui/sort-header';
import { TableEmptyRow } from './ui/table-empty-row';
import { PageTitle } from './ui/page-title';
import { TableSkeletonRows } from './ui/table-skeleton-rows';
import {
  ALL_PERMISSIONS, LOCKED_REASONS, PERMISSION_LABELS, PERMISSION_MODULES,
  roleTemplate, type ModuleAction, type Permission, type PermissionModule,
} from '../utils/permissions';

/**
 * The four columns of the module grid, right to left as the page reads.
 *
 * The CRUD letter is shown under the Persian label because that is the shape
 * admins ask for the matrix in ("بازرگانی روی شرکای تجاری CRUD، مالی فقط R"),
 * and it gives the row summary badge a vocabulary to be terse in.
 */
const ACTION_COLUMNS: Array<{ key: ModuleAction; label: string; letter: string }> = [
  { key: 'view', label: 'مشاهده', letter: 'R' },
  { key: 'create', label: 'ثبت', letter: 'C' },
  { key: 'edit', label: 'ویرایش', letter: 'U' },
  { key: 'delete', label: 'حذف', letter: 'D' },
];

/** Scoring is listed separately: it is per department, not per action. */
const SCORE_PERMISSIONS: Permission[] = ['score.commercial', 'score.qa', 'score.planning', 'score.finance'];

/** Whether two permission lists grant the same thing, order aside. */
function samePermissions(a: Permission[], b: Permission[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every(p => set.has(p));
}

/**
 * Short module names for the access column in the list. The dialog has room for
 * «سورس‌ها (تأمین‌کنندگان)»; a table cell repeated once per module does not.
 */
const MODULE_SHORT: Record<string, string> = {
  vendors: 'سورس',
  materials: 'مواد',
  partners: 'شرکا',
  analysis: 'آزمایش',
  risk: 'ریسک',
  audit: 'ممیزی',
  users: 'کاربران',
};

/**
 * The CRUD letters a draft currently grants on one module, e.g. `RCUD` or `R`.
 * An always-open cell counts as granted, since nothing can take it away.
 */
function moduleLetters(module: PermissionModule, draft: Permission[]): string {
  const crud = ACTION_COLUMNS
    .filter(col => {
      const cell = module.actions[col.key];
      if (cell === null) return false;
      if (cell === 'open') return true;
      return draft.includes(cell);
    })
    .map(col => col.letter);
  const extras = (module.extras || [])
    .filter(x => draft.includes(x.permission))
    .map(x => x.letter);
  return [...crud, ...extras].join('');
}

/** Every permission a module can grant, its non-CRUD extras included. */
function allModulePermissions(module: PermissionModule): Permission[] {
  return [...new Set([...modulePermissions(module), ...(module.extras || []).map(x => x.permission)])];
}

/** The distinct permissions a module row can actually toggle. */
function modulePermissions(module: PermissionModule): Permission[] {
  const found = ACTION_COLUMNS
    .map(col => module.actions[col.key])
    .filter((p): p is Permission => p !== null && p !== 'open');
  return [...new Set(found)];
}

/**
 * Administration of the user accounts.
 *
 * The endpoints for this existed on the server from the start but nothing ever
 * called them, so adding a colleague meant using curl or editing the database.
 * Everything here is admin-only and audited server-side, so this view only
 * sends the request and reports the answer — it must not write its own audit
 * records, or every action would be logged twice.
 */

export interface ManagedUser {
  username: string;
  name: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  /** Per-user overrides. Empty means "follow the role". */
  permissions: Permission[];
  /** What is actually in force — overrides when set, otherwise the template. */
  effectivePermissions: Permission[];
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'مدیر سیستم',
  qa: 'تضمین کیفیت (QA)',
  lab: 'آزمایشگاه',
  commercial: 'بازرگانی و خرید',
  planning: 'برنامه‌ریزی و انبار',
  finance: 'مالی و حسابداری',
};

const ROLE_OPTIONS = Object.keys(ROLE_LABELS) as Role[];

function formatLastLogin(value: string | null): string {
  if (!value) return 'هرگز';
  const d = new Date(value);
  if (isNaN(d.getTime())) return 'نامشخص';
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}

type SortField = 'name' | 'username' | 'role' | 'status' | 'lastLogin';
type SortOrder = 'asc' | 'desc';


/** Persian names sort by the Persian alphabet, not by code point. */
const collator = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });

type Draft = { username: string; name: string; role: Role; password: string };

const EMPTY_DRAFT: Draft = { username: '', name: '', role: 'commercial', password: '' };

interface UsersViewProps {
  currentUser: User;
}

export function UsersView({ currentUser }: UsersViewProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /**
   * Three filters, because the questions an access review asks are always the
   * same three: who is in this department, whose account is still open, and
   * whose access was adjusted away from their role.
   */
  const [filterRole, setFilterRole] = useState<'all' | Role>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive' | 'never'>('all');
  const [filterAccess, setFilterAccess] = useState<'all' | 'template' | 'custom'>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  const [permTarget, setPermTarget] = useState<ManagedUser | null>(null);
  const [permDraft, setPermDraft] = useState<Permission[]>([]);
  const [permError, setPermError] = useState<string | null>(null);
  const [permSaving, setPermSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const userFormDirty = useDirtySnapshot(formOpen, draft);
  // The permissions dialog compares against what is actually in force, so
  // opening it and ticking nothing closes without a question — the same reason
  // its save button is disabled in that state.
  const permDirty = useDirtySnapshot(!!permTarget, permDraft);
  const resetDirty = useDirtySnapshot(!!resetTarget, resetPassword);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const loadUsers = React.useCallback(() => {
    if (isLocalMode()) {
      setLoading(false);
      setLoadError('در حالت آزمایشی محلی، مدیریت کاربران در دسترس نیست.');
      return;
    }
    setLoading(true);
    authFetch('/api/users')
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'دریافت فهرست کاربران ناموفق بود.');
        return res.json();
      })
      .then((data: ManagedUser[]) => {
        setUsers(Array.isArray(data) ? data : []);
        setLoadError(null);
      })
      .catch(err => setLoadError(err.message || 'ارتباط با سرور برقرار نشد.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = users.filter(u => {
      if (q && !(
        u.username.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        (ROLE_LABELS[u.role] || '').includes(q)
      )) return false;
      if (filterRole !== 'all' && u.role !== filterRole) return false;
      if (filterStatus === 'active' && !u.isActive) return false;
      if (filterStatus === 'inactive' && u.isActive) return false;
      if (filterStatus === 'never' && u.lastLoginAt) return false;
      // An empty exception list means "follow the role" — that is the whole
      // rule the dialog warns about, so the filter reads it the same way.
      if (filterAccess === 'custom' && u.permissions.length === 0) return false;
      if (filterAccess === 'template' && u.permissions.length > 0) return false;
      return true;
    });

    const dir = sortOrder === 'asc' ? 1 : -1;
    const value = (u: ManagedUser): string | number => {
      switch (sortField) {
        case 'username': return u.username;
        case 'role': return ROLE_LABELS[u.role] || u.role;
        // Deactivated accounts are the interesting end of this column, so
        // "ascending" puts active first and pushes them to the bottom.
        case 'status': return u.isActive ? 0 : 1;
        // "Never signed in" sorts as the oldest possible moment rather than
        // being dropped somewhere arbitrary.
        case 'lastLogin': return u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : 0;
        default: return u.name;
      }
    };

    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : collator.compare(String(av), String(bv));
      // Ties fall back to the name so the order never shuffles between renders.
      return (cmp || collator.compare(a.name, b.name)) * dir;
    });
  }, [users, search, filterRole, filterStatus, filterAccess, sortField, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(visible.length / perPage));
  const pageRows = useMemo(
    () => visible.slice((page - 1) * perPage, page * perPage),
    [visible, page, perPage],
  );

  // A filter or a page-size change can leave the current page past the end.
  useEffect(() => { setPage(p => Math.min(p, totalPages)); }, [totalPages]);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const activeAdmins = users.filter(u => u.role === 'admin' && u.isActive).length;
  const activeCount = users.filter(u => u.isActive).length;
  const customCount = users.filter(u => u.permissions.length > 0).length;
  const neverSignedIn = users.filter(u => !u.lastLoginAt).length;

  /**
   * The access list as a spreadsheet, for the review that happens away from
   * the screen. It exports what is on screen — the filters applied — because a
   * review is normally of one department or of the closed accounts, and a file
   * that silently widens to everyone is the wrong answer to that.
   */
  const [isExporting, setIsExporting] = useState(false);
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const moduleTitles = PERMISSION_MODULES.map(m => m.title);
      const rows = visible.map(u => ({
        name: u.name,
        username: u.username,
        roleLabel: ROLE_LABELS[u.role] || u.role,
        status: u.isActive ? 'فعال' : 'غیرفعال',
        accessSource: u.permissions.length > 0 ? 'سفارشی (استثنای کاربر)' : 'الگوی سمت سازمانی',
        lastLogin: formatLastLogin(u.lastLoginAt),
        modules: Object.fromEntries(
          PERMISSION_MODULES.map(m => [m.title, moduleLetters(m, u.effectivePermissions) || '—']),
        ),
        permissionNames: u.effectivePermissions.map(p => PERMISSION_LABELS[p] || p),
      }));
      // Loaded on demand: the spreadsheet writer is the largest dependency in
      // the bundle and this page is not an export tool until the button is used.
      const { exportUserAccessToExcel } = await import('../utils/excelExport');
      exportUserAccessToExcel(rows, moduleTitles);
    } catch (err: any) {
      setActionError('تهیهٔ خروجی Excel ناموفق بود. دوباره تلاش کنید.');
      console.error('User access export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (u: ManagedUser) => {
    setEditing(u);
    setDraft({ username: u.username, name: u.name, role: u.role, password: '' });
    setFormError(null);
    setFormOpen(true);
  };

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const name = draft.name.trim();
    const username = draft.username.trim().toLowerCase();

    if (!name) return setFormError('نام و نام خانوادگی الزامی است.');
    if (!editing) {
      if (!username) return setFormError('نام کاربری الزامی است.');
      if (!/^[a-zA-Z0-9._-]{3,}$/.test(username)) {
        return setFormError('نام کاربری باید حداقل ۳ کاراکتر و فقط شامل حروف لاتین، عدد، نقطه، خط تیره یا زیرخط باشد.');
      }
      if (users.some(u => u.username.toLowerCase() === username)) {
        return setFormError('کاربری با این نام کاربری از قبل وجود دارد.');
      }
      if (draft.password && draft.password.length < 6) {
        return setFormError('کلمه عبور اولیه باید حداقل ۶ کاراکتر باشد.');
      }
    }

    setSaving(true);
    const request = editing
      ? authFetch(`/api/users/${encodeURIComponent(editing.username)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, role: draft.role }),
        })
      : authFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({ username, name, role: draft.role, password: draft.password || undefined }),
        });

    request
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'ثبت تغییرات ناموفق بود.');
        return data;
      })
      .then(() => {
        setFormOpen(false);
        flash(editing ? 'اطلاعات کاربر به‌روزرسانی شد.' : 'کاربر جدید ایجاد شد. در اولین ورود باید کلمه عبور را تغییر دهد.');
        loadUsers();
      })
      .catch(err => setFormError(err.message))
      .finally(() => setSaving(false));
  };

  const setActive = (u: ManagedUser, isActive: boolean) => {
    setActionError(null);
    authFetch(`/api/users/${encodeURIComponent(u.username)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'تغییر وضعیت ناموفق بود.');
        flash(isActive ? `حساب ${u.name} فعال شد.` : `حساب ${u.name} غیرفعال شد.`);
        loadUsers();
      })
      .catch(err => setActionError(err.message));
  };

  const submitReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    if (resetPassword.length < 6) return setResetError('کلمه عبور موقت باید حداقل ۶ کاراکتر باشد.');

    authFetch(`/api/users/${encodeURIComponent(resetTarget.username)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword: resetPassword }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'بازنشانی کلمه عبور ناموفق بود.');
        setResetTarget(null);
        setResetPassword('');
        flash('کلمه عبور بازنشانی شد. کاربر در ورود بعدی باید آن را تغییر دهد.');
        loadUsers();
      })
      .catch(err => setResetError(err.message));
  };

  const openPermissions = (u: ManagedUser) => {
    setPermTarget(u);
    setPermDraft([...u.effectivePermissions]);
    setPermError(null);
  };

  /**
   * Read and write are not independent: "may edit partners but may not see
   * them" is not a state the application can render, and "may see them" with
   * every write still ticked would leave writes the server allows behind a
   * page the reader cannot open. So ticking any action of a module turns its
   * read on, and turning its read off clears the rest of the row.
   */
  const togglePermission = (permission: Permission) => {
    const module = PERMISSION_MODULES.find(m =>
      ACTION_COLUMNS.some(c => m.actions[c.key] === permission)
      || m.single === permission
      || (m.extras || []).some(x => x.permission === permission));
    const read = module?.actions.view;
    const readPerm = read && read !== 'open' ? read : null;
    const rowPerms = module ? allModulePermissions(module) : [];

    setPermDraft(prev => {
      const on = prev.includes(permission);
      let next: Permission[];
      if (on) {
        next = permission === readPerm
          ? prev.filter(p => !rowPerms.includes(p))   // read off ⇒ whole row off
          : prev.filter(p => p !== permission);
      } else {
        next = [...prev, permission];
        if (readPerm && !next.includes(readPerm)) next.push(readPerm);
      }
      return ALL_PERMISSIONS.filter(p => next.includes(p));
    });
  };

  /** The row's master tick: all of this module's actions on, or all off. */
  const toggleModule = (module: PermissionModule) => {
    const owned = allModulePermissions(module);
    if (owned.length === 0) return;
    setPermDraft(prev => {
      const allOn = owned.every(p => prev.includes(p));
      const next = allOn
        ? prev.filter(p => !owned.includes(p))
        : [...prev, ...owned.filter(p => !prev.includes(p))];
      return ALL_PERMISSIONS.filter(p => next.includes(p));
    });
  };

  const savePermissions = () => {
    if (!permTarget) return;
    setPermError(null);
    setPermSaving(true);
    // An empty list means "follow the role", so a draft that matches the role's
    // template is sent as one. Sending the expanded list instead pinned the
    // account to a snapshot of the template — the "سفارشی" badge appeared and a
    // Critical audit record was written for opening the dialog and pressing
    // save without touching anything.
    const body = samePermissions(permDraft, roleTemplate(permTarget.role)) ? [] : permDraft;
    authFetch(`/api/users/${encodeURIComponent(permTarget.username)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions: body }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'ذخیرهٔ سطح دسترسی ناموفق بود.');
        setPermTarget(null);
        flash(`سطح دسترسی «${permTarget.name}» به‌روزرسانی شد.`);
        loadUsers();
      })
      .catch(err => setPermError(err.message))
      .finally(() => setPermSaving(false));
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setActionError(null);
    authFetch(`/api/users/${encodeURIComponent(deleteTarget.username)}`, { method: 'DELETE' })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'حذف کاربر ناموفق بود.');
        setDeleteTarget(null);
        flash('حساب کاربری حذف شد.');
        loadUsers();
      })
      .catch(err => {
        setDeleteTarget(null);
        setActionError(err.message);
      });
  };

  const isSelf = (u: ManagedUser) => u.username.toLowerCase() === currentUser.username.toLowerCase();

  return (
    <div className="space-y-5 fade-in">
      {/* HEADER */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <PageTitle
          icon={UserCog}
          title="مدیریت کاربران سامانه"
          subtitle="تعریف دسترسی پرسنل، تغییر سمت سازمانی و کنترل وضعیت حساب‌ها — تمامی تغییرات در ردیابی تغییرات (Audit) ثبت می‌شود."
        />

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="جستجوی کاربر..."
              className="pr-9 pl-3 w-full sm:w-56"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="success"
            onClick={handleExport}
            disabled={isExporting || visible.length === 0}
            className="font-bold shrink-0"
          >
            {isExporting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            <span>خروجی Excel</span>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={openCreate}
            className="font-bold shrink-0"
          >
            <Plus />
            <span>کاربر جدید</span>
          </Button>
        </div>
      </div>

      {/* KPI STRIP — the same four-card shape the other repositories use. The
          numbers are counted from the loaded list, so they never claim more
          than the table can show. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'کل کاربران', value: users.length, hint: 'حساب تعریف‌شده در سامانه' },
          { label: 'حساب فعال', value: activeCount, hint: `${(users.length - activeCount).toLocaleString('fa-IR')} حساب غیرفعال` },
          { label: 'مدیر فعال', value: activeAdmins, hint: 'دارندهٔ دسترسی کامل' },
          { label: 'دسترسی سفارشی', value: customCount, hint: `${neverSignedIn.toLocaleString('fa-IR')} حساب هنوز وارد نشده` },
        ].map(card => (
          <div key={card.label} className="bg-card border border-border rounded-2xl p-4 shadow-xs">
            <span className="text-2xs font-bold text-muted-foreground block">{card.label}</span>
            <span className="text-xl font-black text-foreground block mt-1">
              {loading ? '—' : card.value.toLocaleString('fa-IR')}
            </span>
            <span className="text-2xs text-muted-foreground block mt-0.5">{card.hint}</span>
          </div>
        ))}
      </div>

      {/* FILTER BAR — the three questions an access review asks. Native selects
          styled from `inputBaseClass`, like every other filter in the app. */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-xs flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-bold text-muted-foreground">سمت سازمانی</span>
          <select
            value={filterRole}
            onChange={e => { setFilterRole(e.target.value as any); setPage(1); }}
            className={cn(inputBaseClass, 'w-44')}
          >
            <option value="all">همهٔ سمت‌ها</option>
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-bold text-muted-foreground">وضعیت حساب</span>
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value as any); setPage(1); }}
            className={cn(inputBaseClass, 'w-44')}
          >
            <option value="all">همه</option>
            <option value="active">فعال</option>
            <option value="inactive">غیرفعال</option>
            <option value="never">هرگز وارد نشده</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-bold text-muted-foreground">منبع دسترسی</span>
          <select
            value={filterAccess}
            onChange={e => { setFilterAccess(e.target.value as any); setPage(1); }}
            className={cn(inputBaseClass, 'w-52')}
          >
            <option value="all">همه</option>
            <option value="template">پیروی از الگوی سمت</option>
            <option value="custom">دسترسی سفارشی</option>
          </select>
        </label>
        {(filterRole !== 'all' || filterStatus !== 'all' || filterAccess !== 'all' || search) && (
          <div className="flex items-center gap-2 pb-0.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { setFilterRole('all'); setFilterStatus('all'); setFilterAccess('all'); setSearch(''); setPage(1); }}
              className="font-bold"
            >
              حذف فیلترها
            </Button>
            <span className="text-2xs text-muted-foreground">
              {visible.length.toLocaleString('fa-IR')} از {users.length.toLocaleString('fa-IR')} حساب
            </span>
          </div>
        )}
      </div>

      {toast && (
        <div role="status" className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl px-4 py-2.5 text-xs font-bold fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {actionError && (
        <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl px-4 py-2.5 text-xs font-semibold">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* TABLE */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right" aria-busy={loading}>
            <caption className="sr-only">فهرست کاربران سامانه با امکان مرتب‌سازی بر اساس هر ستون</caption>
            <thead>
              <tr className="bg-muted text-muted-foreground border-b border-border">
                <SortHeader field="name" label="نام و نام خانوادگی" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="username" label="نام کاربری" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="role" label="سمت سازمانی" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="status" label="وضعیت" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="lastLogin" label="آخرین ورود" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                {/* Deliberately not sortable: "RCUD" versus "R" has no order that
                    means anything, and a header that claims one would be the same
                    lie the audit table's severity column used to tell. */}
                <th scope="col" className="py-3.5 px-4 font-bold">دسترسی ماژول‌ها</th>
                <th scope="col" className="py-3.5 px-4 font-bold text-center">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                // Skeleton rows in the shape of the real table, rather than a
                // spinner on an empty page — the layout does not jump when the
                // data lands.
                <TableSkeletonRows
                  rows={5}
                  columns={7}
                  barClassName="h-3"
                  rowClassName="border-b border-border/60 last:border-0"
                  width={(c, i) => (c === 6 ? '5rem' : `${55 + ((i + c) % 3) * 15}%`)}
                />
              ) : loadError ? (
                <TableEmptyRow
                  colSpan={7}
                  icon={AlertCircle}
                  iconClassName="text-rose-400"
                  message={loadError}
                />
              ) : visible.length === 0 ? (
                <TableEmptyRow
                  colSpan={7}
                  icon={UsersIcon}
                  message={search.trim() ? 'کاربری با این مشخصات یافت نشد.' : 'هنوز کاربری تعریف نشده است.'}
                />
              ) : pageRows.map(u => (
                <tr key={u.username} className={`border-b border-border/60 last:border-0 hover:bg-accent/50 transition-colors ${u.isActive ? '' : 'opacity-60'}`}>
                  <td className="py-3 px-4 font-bold text-foreground">
                    {/* The badge must not squeeze the name: it never shrinks,
                        so without wrap all the pressure lands on the name
                        (rule 15). */}
                    <div className="flex flex-wrap items-center gap-2">
                      <EntityName name={u.name} lines={2} className="max-w-[22ch]" />
                      {isSelf(u) && <span className="shrink-0 text-2xs bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full font-bold">شما</span>}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-muted-foreground" dir="ltr">{u.username}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-2xs font-bold border ${
                      u.role === 'admin'
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-muted text-muted-foreground border-border'
                    }`}>
                      {u.role === 'admin' && <ShieldCheck className="w-3 h-3" />}
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                    {u.permissions.length > 0 && (
                      <span title="سطح دسترسی این کاربر دستی تنظیم شده و از الگوی نقش پیروی نمی‌کند"
                        className="mr-1.5 inline-flex items-center px-1.5 py-0.5 rounded-md text-2xs font-bold border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800">
                        سفارشی
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex w-fit items-center px-2 py-0.5 rounded-lg text-2xs font-bold border ${
                        u.isActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                          : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800'
                      }`}>
                        {u.isActive ? 'فعال' : 'غیرفعال'}
                      </span>
                      {u.mustChangePassword && (
                        <span className="text-2xs text-amber-700 dark:text-amber-400 font-semibold">تغییر رمز در ورود بعدی</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">{formatLastLogin(u.lastLoginAt)}</td>
                  {/* What this account actually holds, per module, in the same
                      CRUD shorthand the dialog uses — so reviewing who can do
                      what across the organisation does not mean opening seven
                      dialogs one at a time. Read from `effectivePermissions`,
                      which is the override when set and the role template
                      otherwise, so it shows what is in force rather than what
                      was ticked. */}
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap items-center gap-1 max-w-[22rem]">
                      {(() => {
                        const held = PERMISSION_MODULES
                          .map(m => ({ m, letters: moduleLetters(m, u.effectivePermissions) }))
                          // A module that borrows another's read — lab results
                          // and risk both open with `vendor.read` — would add a
                          // bare "R" chip to every row that says nothing the
                          // source chip did not already say. It earns its place
                          // only once it grants a write of its own.
                          .filter(({ m, letters }) => {
                            if (!letters) return false;
                            // The first module listed for a read permission owns
                            // it; the later ones borrow it (lab results and risk
                            // both open with `vendor.read`). A borrower with no
                            // write of its own would add a bare "R" chip saying
                            // nothing the owner's chip did not already say.
                            const owner = PERMISSION_MODULES
                              .find(other => other.actions.view === m.actions.view);
                            return owner?.key === m.key || letters !== 'R';
                          });
                        if (held.length === 0) {
                          return <span className="text-2xs text-muted-foreground">بدون دسترسی</span>;
                        }
                        return held.map(({ m, letters }) => (
                          <span
                            key={m.key}
                            title={`${m.title} — ${letters.split('').map(l => ACTION_COLUMNS.find(c => c.letter === l)?.label).join('، ')}`}
                            className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border bg-muted text-2xs font-bold text-foreground"
                          >
                            <span>{MODULE_SHORT[m.key] || m.title}</span>
                            <span className="font-mono text-2xs text-primary">{letters}</span>
                          </span>
                        ));
                      })()}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-1">
                      <Button type="button" variant="ghost" size="icon-xs" title="ویرایش" onClick={() => openEdit(u)}
                        className="text-muted-foreground hover:text-primary">
                        <Pencil />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" title="سطح دسترسی"
                        onClick={() => openPermissions(u)}
                        className="text-muted-foreground hover:text-primary">
                        <SlidersHorizontal />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" title="بازنشانی کلمه عبور"
                        onClick={() => { setResetTarget(u); setResetPassword(''); setResetError(null); }}
                        className="text-muted-foreground hover:text-amber-600">
                        <KeyRound />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" title={u.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                        disabled={isSelf(u)}
                        onClick={() => setActive(u, !u.isActive)}
                        className="text-muted-foreground hover:text-rose-600">
                        {u.isActive ? <UserX /> : <CheckCircle />}
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" title="حذف کامل"
                        disabled={isSelf(u)}
                        onClick={() => setDeleteTarget(u)}
                        className="text-muted-foreground hover:text-rose-600">
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && !loadError && (
          <>
            {visible.length > 0 && (
              <div className="px-5 py-3 border-t border-border flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="flex items-center gap-2 text-2xs font-bold text-muted-foreground shrink-0">
                  <span>تعداد در هر صفحه</span>
                  <select
                    value={perPage}
                    onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
                    className="bg-card border border-border rounded-lg px-2 py-1 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <span className="text-2xs text-muted-foreground sm:mr-auto">
                  نمایش {((page - 1) * perPage + 1).toLocaleString('fa-IR')}
                  {' '}تا {Math.min(page * perPage, visible.length).toLocaleString('fa-IR')}
                  {' '}از {visible.length.toLocaleString('fa-IR')} کاربر
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button type="button" variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                      className="h-7 px-2.5 text-2xs font-bold">
                      قبلی
                    </Button>
                    <span className="text-2xs font-mono text-muted-foreground px-1">
                      {page.toLocaleString('fa-IR')} / {totalPages.toLocaleString('fa-IR')}
                    </span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                      className="h-7 px-2.5 text-2xs font-bold">
                      بعدی
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div className="px-5 py-3 border-t border-border bg-muted/50 flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
              <span>مجموع {users.length} کاربر · {activeAdmins} مدیر فعال</span>
              <span>حذف کاربر، سوابق او در Audit را پاک نمی‌کند؛ برای قطع دسترسی، غیرفعال‌سازی توصیه می‌شود.</span>
            </div>
          </>
        )}
      </div>

      {/* CREATE / EDIT */}
      <FormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="md"
        labelledBy="users-form-title"
        unsavedChanges={userFormDirty}
        unsavedLabel={editing ? 'تغییرات این حساب کاربری' : 'اطلاعات کاربر جدید'}
      >
        <form onSubmit={submitForm} className="flex flex-col max-h-full">
          <div className="px-6 py-4 border-b border-border bg-muted/50">
            <h3 id="users-form-title" className="text-sm font-black text-foreground">
              {editing ? `ویرایش حساب کاربری «${editing.name}»` : 'تعریف کاربر جدید'}
            </h3>
            <p className="text-2xs text-muted-foreground mt-0.5">
              {editing
                ? 'نام کاربری قابل تغییر نیست؛ برای تغییر آن باید حساب جدیدی تعریف شود.'
                : 'کاربر در اولین ورود ملزم به تغییر کلمه عبور خواهد بود.'}
            </p>
          </div>

          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {formError && (
              <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl px-3.5 py-2.5 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="user-name" className="block text-xs font-bold text-foreground">نام و نام خانوادگی</label>
              <Input
                id="user-name"
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                className="w-full"
                placeholder="مثلاً: مریم رضایی"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="user-username" className="block text-xs font-bold text-foreground">نام کاربری</label>
              <Input
                id="user-username"
                value={draft.username}
                disabled={!!editing}
                onChange={e => setDraft({ ...draft, username: e.target.value })}
                dir="ltr"
                className="w-full font-mono text-left disabled:opacity-50"
                placeholder="m.rezaei"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="user-role" className="block text-xs font-bold text-foreground">سمت سازمانی</label>
              <select
                id="user-role"
                value={draft.role}
                onChange={e => setDraft({ ...draft, role: e.target.value as Role })}
                className={cn(inputBaseClass, 'w-full')}
              >
                {/* The `admin` role is offered only to an administrator. The
                    module itself is open to anyone holding `users.manage`, but
                    handing out the role that counts as "still has an
                    administrator" is a decision for someone who already holds
                    it — the server refuses it either way (rule 14), and this
                    keeps the form from offering a choice that will be refused. */}
                {ROLE_OPTIONS.filter(r => r !== 'admin' || currentUser.role === 'admin' || editing?.role === 'admin')
                  .map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              {currentUser.role !== 'admin' && (
                <p className="text-2xs text-muted-foreground pt-1">
                  تعیین سمت «مدیر سیستم» فقط از حساب مدیر سیستم امکان‌پذیر است.
                </p>
              )}
              {editing && editing.permissions.length > 0 && draft.role !== editing.role && (
                <p className="text-2xs text-amber-700 dark:text-amber-400 font-semibold pt-1">
                  با تغییر سمت، دسترسی‌های سفارشی این کاربر پاک می‌شود و الگوی سمت جدید اعمال می‌گردد.
                </p>
              )}
              {editing && editing.role === 'admin' && activeAdmins <= 1 && (
                <p className="text-2xs text-amber-700 dark:text-amber-400 font-semibold pt-1">
                  این تنها مدیر فعال سامانه است و سمت او قابل تغییر نیست.
                </p>
              )}
            </div>

            {!editing && (
              <div className="space-y-1">
                <label htmlFor="user-password" className="block text-xs font-bold text-foreground">
                  کلمه عبور اولیه <span className="font-normal text-muted-foreground">(اختیاری)</span>
                </label>
                <Input
                  id="user-password"
                  type="text"
                  value={draft.password}
                  onChange={e => setDraft({ ...draft, password: e.target.value })}
                  dir="ltr"
                  className="w-full font-mono text-left"
                  placeholder="حداقل ۶ کاراکتر — خالی بگذارید تا پیش‌فرض استفاده شود"
                />
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-border bg-muted/50 flex items-center justify-end gap-2 shrink-0">
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}
              className="text-xs font-bold text-muted-foreground">
              انصراف
            </Button>
            <Button type="submit" disabled={saving} className="text-xs font-bold">
              {saving && <Loader2 className="animate-spin" />}
              {editing ? 'ذخیره تغییرات' : 'ایجاد کاربر'}
            </Button>
          </div>
        </form>
      </FormModal>

      {/* RESET PASSWORD */}
      <FormModal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        size="sm"
        labelledBy="users-reset-title"
        unsavedChanges={resetDirty}
        unsavedLabel="کلمهٔ عبور موقتی که وارد کرده‌اید"
      >
        {resetTarget && (
          <form onSubmit={submitReset}>
            <div className="px-6 py-4 border-b border-border bg-muted/50">
              <h3 id="users-reset-title" className="text-sm font-black text-foreground">بازنشانی کلمه عبور</h3>
              <p className="text-2xs text-muted-foreground mt-0.5">
                برای «{resetTarget.name}» یک کلمه عبور موقت تعیین کنید. کاربر در ورود بعدی ملزم به تغییر آن است.
              </p>
            </div>
            <div className="p-6 space-y-3">
              {resetError && (
                <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl px-3.5 py-2.5 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{resetError}</span>
                </div>
              )}
              <Input
                autoFocus
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                dir="ltr"
                className="w-full font-mono text-left"
                placeholder="کلمه عبور موقت (حداقل ۶ کاراکتر)"
              />
            </div>
            <div className="px-6 py-4 border-t border-border bg-muted/50 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setResetTarget(null)}
                className="text-xs font-bold text-muted-foreground">
                انصراف
              </Button>
              {/* Amber is a one-off here; a variant for a single site would be
                  dead weight in the library, so it rides on `className`. */}
              <Button type="submit"
                className="text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 hover:shadow-amber-600/20">
                بازنشانی
              </Button>
            </div>
          </form>
        )}
      </FormModal>

      {/* PERMISSIONS */}
      <FormModal
        open={!!permTarget}
        onClose={() => setPermTarget(null)}
        size="md"
        labelledBy="users-perm-title"
        unsavedChanges={permDirty}
        unsavedLabel="تغییرات سطح دسترسی"
      >
        {permTarget && (
          <div className="flex flex-col max-h-full">
            <div className="px-6 py-4 border-b border-border bg-muted/50">
              <h3 id="users-perm-title" className="text-sm font-black text-foreground">
                سطح دسترسی «{permTarget.name}»
              </h3>
              <p className="text-2xs text-muted-foreground mt-0.5">
                سمت سازمانی ({ROLE_LABELS[permTarget.role] || permTarget.role}) الگوی پیش‌فرض را تعیین می‌کند؛ در اینجا می‌توانید برای همین کاربر استثنا بگذارید.
              </p>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {permError && (
                <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl px-3.5 py-2.5 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{permError}</span>
                </div>
              )}

              {/* How far this account has been moved from its role.
                  The dialog already marked each deviating tick with a tiny +/−,
                  which is precise and easy to miss on a table of seven rows.
                  The count says it once, in words, before the table — and the
                  legend explains the marks rather than leaving them to be
                  guessed at. */}
              {(() => {
                const template = roleTemplate(permTarget.role);
                const added = permDraft.filter(p => !template.includes(p));
                const removed = template.filter(p => !permDraft.includes(p));
                if (added.length === 0 && removed.length === 0) {
                  return (
                    <div className="text-2xs text-muted-foreground bg-muted border border-border rounded-xl px-3.5 py-2.5">
                      این فهرست دقیقاً همان الگوی سمت «{ROLE_LABELS[permTarget.role] || permTarget.role}» است.
                    </div>
                  );
                }
                return (
                  <div className="bg-muted border border-border rounded-xl px-3.5 py-2.5 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs font-bold">
                      <span className="text-foreground">تفاوت با الگوی سمت:</span>
                      {added.length > 0 && (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          + {added.length.toLocaleString('fa-IR')} مجوز اضافه‌شده
                        </span>
                      )}
                      {removed.length > 0 && (
                        <span className="text-rose-700 dark:text-rose-400">
                          − {removed.length.toLocaleString('fa-IR')} مجوز کم‌شده
                        </span>
                      )}
                    </div>
                    {added.length > 0 && (
                      <p className="text-2xs text-muted-foreground leading-relaxed">
                        اضافه‌شده: {added.map(p => PERMISSION_LABELS[p] || p).join('، ')}
                      </p>
                    )}
                    {removed.length > 0 && (
                      <p className="text-2xs text-muted-foreground leading-relaxed">
                        کم‌شده: {removed.map(p => PERMISSION_LABELS[p] || p).join('، ')}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* One row per module, one cell per action. A cell is a real
                  checkbox only where the server can tell that action apart;
                  everywhere else it is locked and says why, so no tick in this
                  dialog promises a control that does not exist. */}
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full min-w-[520px] border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="text-right text-2xs font-bold text-muted-foreground uppercase tracking-wide pb-2 pr-1">ماژول</th>
                      {ACTION_COLUMNS.map(col => (
                        <th key={col.key} className="text-center text-2xs font-bold text-muted-foreground uppercase tracking-wide pb-2 px-1 w-16">
                          <span className="block">{col.label}</span>
                          <span className="block font-mono text-2xs text-muted-foreground/70">{col.letter}</span>
                        </th>
                      ))}
                      <th className="text-center text-2xs font-bold text-muted-foreground uppercase tracking-wide pb-2 px-1 w-14">همه</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSION_MODULES.map(module => {
                      const owned = allModulePermissions(module);
                      const granted = owned.filter(p => permDraft.includes(p));
                      const allOn = owned.length > 0 && granted.length === owned.length;
                      const someOn = granted.length > 0 && !allOn;
                      const template = roleTemplate(permTarget.role);
                      return (
                        <tr key={module.key} className="align-top">
                          <td className="py-2.5 pr-1 border-t border-border/70">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-bold text-foreground">{module.title}</span>
                              {/* What this row currently grants, in the CRUD
                                  shorthand the columns are labelled with — so a
                                  glance down the dialog answers "what does this
                                  person have on partners?" without counting
                                  ticks. */}
                              <span
                                className={`shrink-0 font-mono text-2xs font-bold px-1.5 py-0.5 rounded-md border ${
                                  moduleLetters(module, permDraft)
                                    ? 'bg-primary/10 text-primary border-primary/20'
                                    : 'bg-muted text-muted-foreground border-border'
                                }`}
                                title={moduleLetters(module, permDraft)
                                  ? `دسترسی فعلی: ${moduleLetters(module, permDraft)}`
                                  : 'هیچ دسترسی‌ای به این ماژول ندارد'}
                              >
                                {moduleLetters(module, permDraft) || '—'}
                              </span>
                            </div>
                            {module.note && (
                              <span className="text-2xs text-muted-foreground leading-relaxed block mt-0.5 max-w-[26ch]">
                                {module.note}
                              </span>
                            )}
                            {/* Abilities that are not one of the four columns get
                                their own tick here rather than a fifth column
                                that would be empty on every other row. */}
                            {(module.extras || []).map(extra => (
                              <label key={extra.permission}
                                className="flex items-start gap-1.5 mt-1.5 cursor-pointer max-w-[26ch]">
                                <input
                                  type="checkbox"
                                  checked={permDraft.includes(extra.permission)}
                                  onChange={() => togglePermission(extra.permission)}
                                  className="w-3.5 h-3.5 mt-0.5 accent-primary cursor-pointer shrink-0"
                                />
                                <span>
                                  <span className="text-2xs font-bold text-foreground">
                                    {extra.label}
                                    <span className="font-mono text-2xs text-muted-foreground"> ({extra.letter})</span>
                                  </span>
                                  <span className="text-2xs text-muted-foreground leading-relaxed block">
                                    {extra.note}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </td>

                          {ACTION_COLUMNS.map(col => {
                            const cell = module.actions[col.key];
                            // A module whose every action is the same permission
                            // gets one checkbox across the whole row, rather
                            // than the same tick repeated in four columns.
                            const wholeRow = !!module.single
                              && ACTION_COLUMNS.every(c => module.actions[c.key] === module.single);
                            if (wholeRow) {
                              if (col.key !== 'view') return null;
                              const perm = module.single!;
                              const checked = permDraft.includes(perm);
                              const inTemplate = template.includes(perm);
                              return (
                                <td key={col.key} colSpan={4} className="py-2.5 px-1 text-center border-t border-border/70">
                                  <span className="inline-flex flex-col items-center gap-0.5">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => togglePermission(perm)}
                                      aria-label={`${module.title} — ${PERMISSION_LABELS[perm]}`}
                                      className="w-4 h-4 accent-primary cursor-pointer"
                                    />
                                    <span className="text-2xs text-muted-foreground">دسترسی کامل</span>
                                    {inTemplate !== checked && (
                                      <span className={`text-[8px] font-bold ${checked ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                                        {checked ? '+' : '−'}
                                      </span>
                                    )}
                                  </span>
                                </td>
                              );
                            }

                            if (cell === 'open' || cell === null) {
                              return (
                                <td key={col.key} className="py-2.5 px-1 text-center border-t border-border/70">
                                  <span
                                    className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-border bg-muted text-muted-foreground text-2xs cursor-help"
                                    title={cell === 'open' ? LOCKED_REASONS.open : LOCKED_REASONS.none}
                                  >
                                    {cell === 'open' ? '✓' : '—'}
                                  </span>
                                </td>
                              );
                            }

                            // A merged row repeats the same permission across
                            // create/edit/delete; render it once, centred.
                            if (module.single && col.key !== 'view' && cell === module.single && col.key !== 'create') {
                              return <td key={col.key} className="py-2.5 px-1 border-t border-border/70" />;
                            }

                            const checked = permDraft.includes(cell);
                            const inTemplate = template.includes(cell);
                            const merged = !!module.single && col.key === 'create';
                            return (
                              <td key={col.key}
                                colSpan={merged ? 3 : 1}
                                className="py-2.5 px-1 text-center border-t border-border/70">
                                <span className="inline-flex flex-col items-center gap-0.5">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePermission(cell)}
                                    aria-label={`${module.title} — ${PERMISSION_LABELS[cell]}`}
                                    className="w-4 h-4 accent-primary cursor-pointer"
                                  />
                                  {merged && (
                                    <span className="text-2xs text-muted-foreground">دسترسی کامل</span>
                                  )}
                                  {inTemplate !== checked && (
                                    <span className={`text-[8px] font-bold px-1 rounded ${
                                      checked
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-rose-700 dark:text-rose-400'
                                    }`}>
                                      {checked ? '+' : '−'}
                                    </span>
                                  )}
                                </span>
                              </td>
                            );
                          })}

                          <td className="py-2.5 px-1 text-center border-t border-border/70">
                            <input
                              type="checkbox"
                              checked={allOn}
                              ref={el => { if (el) el.indeterminate = someOn; }}
                              onChange={() => toggleModule(module)}
                              disabled={owned.length === 0}
                              aria-label={`دسترسی کامل به ${module.title}`}
                              title={owned.length === 0 ? LOCKED_REASONS.none : `دسترسی کامل به ${module.title}`}
                              className="w-4 h-4 accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Scoring does not fit the create/edit/delete shape: each
                  department is its own permission, and a person can hold more
                  than one. */}
              <div className="space-y-1.5 pt-2">
                <span className="text-2xs font-bold text-muted-foreground block border-b border-border/60 pb-1.5">
                  امتیازدهی دپارتمان‌ها
                </span>
                {SCORE_PERMISSIONS.map(permission => {
                  const inTemplate = roleTemplate(permTarget.role).includes(permission);
                  const checked = permDraft.includes(permission);
                  return (
                    <label key={permission}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-accent transition-colors cursor-pointer">
                      <span className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePermission(permission)}
                          className="w-4 h-4 accent-primary cursor-pointer"
                        />
                        <span className="text-xs font-semibold text-foreground">{PERMISSION_LABELS[permission]}</span>
                      </span>
                      {inTemplate !== checked && (
                        <span className={`text-2xs font-bold px-1.5 py-0.5 rounded-md border ${
                          checked
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                            : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800'
                        }`}>
                          {checked ? 'افزوده به سمت' : 'سلب‌شده از سمت'}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {/* Saving nothing is not "no access": an empty list is how the
                  record says "follow the role", so this would come back looking
                  unchanged. Say it here rather than let the dialog appear to
                  lose the change. */}
              {permDraft.length === 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <p className="text-2xs leading-relaxed text-amber-800 dark:text-amber-200">
                    هیچ اختیاری انتخاب نشده است. ذخیره در این حالت یعنی «پیروی از الگوی سمت
                    {' '}({ROLE_LABELS[permTarget.role] || permTarget.role})»، نه سلب کامل دسترسی.
                    برای قطع دسترسی، حساب کاربری را غیرفعال کنید.
                  </p>
                </div>
              )}

              <p className="text-2xs text-muted-foreground leading-relaxed border-t border-border/60 pt-3">
                خانه‌های خاکستری قابل تغییر نیستند. علامت <span className="font-bold">✓</span> یعنی همهٔ کاربران
                واردشده آن بخش را می‌بینند و <span className="font-bold">—</span> یعنی آن عملیات در آن ماژول وجود ندارد.
                نشانهٔ <span className="text-emerald-700 dark:text-emerald-400 font-bold">+</span> و
                <span className="text-rose-700 dark:text-rose-400 font-bold"> −</span> یعنی این مورد نسبت به الگوی سمت
                افزوده یا سلب شده است.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-border bg-muted/50 flex items-center justify-between gap-2 shrink-0">
              <Button type="button" variant="ghost" onClick={() => setPermDraft(roleTemplate(permTarget.role))}
                className="px-3 text-2xs font-bold text-muted-foreground">
                بازگشت به پیش‌فرض سمت
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => setPermTarget(null)}
                  className="text-xs font-bold text-muted-foreground">
                  انصراف
                </Button>
                <Button type="button" onClick={savePermissions}
                  disabled={permSaving || samePermissions(permDraft, permTarget.effectivePermissions)}
                  title={samePermissions(permDraft, permTarget.effectivePermissions) ? 'تغییری نسبت به وضعیت فعلی داده نشده است.' : undefined}
                  className="text-xs font-bold">
                  {permSaving && <Loader2 className="animate-spin" />}
                  ذخیره سطح دسترسی
                </Button>
              </div>
            </div>
          </div>
        )}
      </FormModal>

      {/* DELETE CONFIRMATION */}
      <FormModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} size="sm"
        role="alertdialog" closeOnBackdrop={false} labelledBy="users-delete-title">
        {deleteTarget && (
          <>
            <div className="px-6 py-4 border-b border-border bg-muted/50">
              <h3 id="users-delete-title" className="text-sm font-black text-foreground">حذف کامل حساب کاربری</h3>
            </div>
            <div className="p-6 space-y-3 text-xs text-muted-foreground leading-relaxed">
              <p>
                حساب «<strong className="text-foreground">{deleteTarget.name}</strong>» ({deleteTarget.username}) به‌طور کامل حذف می‌شود.
                این عمل بازگشت‌پذیر نیست.
              </p>
              <p className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 rounded-xl px-3.5 py-2.5 font-semibold">
                اگر هدف فقط قطع دسترسی است، <strong>غیرفعال‌سازی</strong> گزینهٔ درست‌تری است: سوابق کاربر حفظ می‌شود و امکان بازگرداندن دسترسی وجود دارد.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-border bg-muted/50 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)}
                className="text-xs font-bold text-muted-foreground">
                انصراف
              </Button>
              <Button type="button" variant="destructive" onClick={confirmDelete}
                className="text-xs font-bold">
                حذف کامل
              </Button>
            </div>
          </>
        )}
      </FormModal>
    </div>
  );
}
