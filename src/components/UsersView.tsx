import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle, KeyRound, Loader2, Pencil, Plus, Search,
  ShieldCheck, Trash2, UserCog, UserX, Users as UsersIcon,
} from 'lucide-react';
import { FormModal } from './FormModal';
import { authFetch, isLocalMode } from '../services/authFetch';
import { Role, User } from '../types';

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

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
    const rows = q
      ? users.filter(u =>
          u.username.toLowerCase().includes(q) ||
          u.name.toLowerCase().includes(q) ||
          (ROLE_LABELS[u.role] || '').includes(q))
      : users;
    // Admins first, then deactivated accounts last, then alphabetical.
    return [...rows].sort((a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      Number(b.role === 'admin') - Number(a.role === 'admin') ||
      a.name.localeCompare(b.name, 'fa'));
  }, [users, search]);

  const activeAdmins = users.filter(u => u.role === 'admin' && u.isActive).length;

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
    <div className="space-y-5 fade-in" dir="rtl">
      {/* HEADER */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 border border-primary/20 p-2.5 rounded-xl">
            <UserCog className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-black text-foreground">مدیریت کاربران سامانه</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              تعریف دسترسی پرسنل، تغییر سمت سازمانی و کنترل وضعیت حساب‌ها — تمامی تغییرات در ردیابی تغییرات (Audit) ثبت می‌شود.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="جستجوی کاربر..."
              className="bg-muted border border-border rounded-xl pr-9 pl-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-56"
            />
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-3.5 py-2 rounded-xl text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>کاربر جدید</span>
          </button>
        </div>
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
          <table className="w-full text-xs text-right">
            <thead>
              <tr className="bg-muted text-muted-foreground border-b border-border">
                <th className="py-3.5 px-4 font-bold">نام و نام خانوادگی</th>
                <th className="py-3.5 px-4 font-bold">نام کاربری</th>
                <th className="py-3.5 px-4 font-bold">سمت سازمانی</th>
                <th className="py-3.5 px-4 font-bold">وضعیت</th>
                <th className="py-3.5 px-4 font-bold">آخرین ورود</th>
                <th className="py-3.5 px-4 font-bold text-center">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
                    <span>در حال دریافت فهرست کاربران...</span>
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-rose-400" />
                    <span>{loadError}</span>
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    <UsersIcon className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <span>کاربری با این مشخصات یافت نشد.</span>
                  </td>
                </tr>
              ) : visible.map(u => (
                <tr key={u.username} className={`border-b border-border/60 last:border-0 hover:bg-accent/50 transition-colors ${u.isActive ? '' : 'opacity-60'}`}>
                  <td className="py-3 px-4 font-bold text-foreground">
                    <div className="flex items-center gap-2">
                      <span>{u.name}</span>
                      {isSelf(u) && <span className="text-[9px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full font-bold">شما</span>}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-muted-foreground" dir="ltr">{u.username}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                      u.role === 'admin'
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-muted text-muted-foreground border-border'
                    }`}>
                      {u.role === 'admin' && <ShieldCheck className="w-3 h-3" />}
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex w-fit items-center px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                        u.isActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                          : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800'
                      }`}>
                        {u.isActive ? 'فعال' : 'غیرفعال'}
                      </span>
                      {u.mustChangePassword && (
                        <span className="text-[9px] text-amber-700 dark:text-amber-400 font-semibold">تغییر رمز در ورود بعدی</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">{formatLastLogin(u.lastLoginAt)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-1">
                      <button type="button" title="ویرایش" onClick={() => openEdit(u)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition-colors cursor-pointer">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" title="بازنشانی کلمه عبور"
                        onClick={() => { setResetTarget(u); setResetPassword(''); setResetError(null); }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-accent transition-colors cursor-pointer">
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" title={u.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                        disabled={isSelf(u)}
                        onClick={() => setActive(u, !u.isActive)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-accent transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
                        {u.isActive ? <UserX className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                      </button>
                      <button type="button" title="حذف کامل"
                        disabled={isSelf(u)}
                        onClick={() => setDeleteTarget(u)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-accent transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && !loadError && (
          <div className="px-5 py-3 border-t border-border bg-muted/50 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>مجموع {users.length} کاربر · {activeAdmins} مدیر فعال</span>
            <span>حذف کاربر، سوابق او در Audit را پاک نمی‌کند؛ برای قطع دسترسی، غیرفعال‌سازی توصیه می‌شود.</span>
          </div>
        )}
      </div>

      {/* CREATE / EDIT */}
      <FormModal open={formOpen} onClose={() => setFormOpen(false)} size="md" labelledBy="users-form-title">
        <form onSubmit={submitForm} className="flex flex-col max-h-full">
          <div className="px-6 py-4 border-b border-border bg-muted/50">
            <h3 id="users-form-title" className="text-sm font-black text-foreground">
              {editing ? `ویرایش حساب کاربری «${editing.name}»` : 'تعریف کاربر جدید'}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
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
              <input
                id="user-name"
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="مثلاً: مریم رضایی"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="user-username" className="block text-xs font-bold text-foreground">نام کاربری</label>
              <input
                id="user-username"
                value={draft.username}
                disabled={!!editing}
                onChange={e => setDraft({ ...draft, username: e.target.value })}
                dir="ltr"
                className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground font-mono text-left focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                placeholder="m.rezaei"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="user-role" className="block text-xs font-bold text-foreground">سمت سازمانی</label>
              <select
                id="user-role"
                value={draft.role}
                onChange={e => setDraft({ ...draft, role: e.target.value as Role })}
                className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              {editing && editing.role === 'admin' && activeAdmins <= 1 && (
                <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold pt-1">
                  این تنها مدیر فعال سامانه است و سمت او قابل تغییر نیست.
                </p>
              )}
            </div>

            {!editing && (
              <div className="space-y-1">
                <label htmlFor="user-password" className="block text-xs font-bold text-foreground">
                  کلمه عبور اولیه <span className="font-normal text-muted-foreground">(اختیاری)</span>
                </label>
                <input
                  id="user-password"
                  type="text"
                  value={draft.password}
                  onChange={e => setDraft({ ...draft, password: e.target.value })}
                  dir="ltr"
                  className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground font-mono text-left focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="حداقل ۶ کاراکتر — خالی بگذارید تا پیش‌فرض استفاده شود"
                />
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-border bg-muted/50 flex items-center justify-end gap-2 shrink-0">
            <button type="button" onClick={() => setFormOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-accent transition-colors cursor-pointer">
              انصراف
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editing ? 'ذخیره تغییرات' : 'ایجاد کاربر'}
            </button>
          </div>
        </form>
      </FormModal>

      {/* RESET PASSWORD */}
      <FormModal open={!!resetTarget} onClose={() => setResetTarget(null)} size="sm" labelledBy="users-reset-title">
        {resetTarget && (
          <form onSubmit={submitReset}>
            <div className="px-6 py-4 border-b border-border bg-muted/50">
              <h3 id="users-reset-title" className="text-sm font-black text-foreground">بازنشانی کلمه عبور</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
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
              <input
                autoFocus
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                dir="ltr"
                className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground font-mono text-left focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="کلمه عبور موقت (حداقل ۶ کاراکتر)"
              />
            </div>
            <div className="px-6 py-4 border-t border-border bg-muted/50 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setResetTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-accent transition-colors cursor-pointer">
                انصراف
              </button>
              <button type="submit"
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:opacity-90 transition-opacity cursor-pointer">
                بازنشانی
              </button>
            </div>
          </form>
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
              <button type="button" onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-accent transition-colors cursor-pointer">
                انصراف
              </button>
              <button type="button" onClick={confirmDelete}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 text-white hover:opacity-90 transition-opacity cursor-pointer">
                حذف کامل
              </button>
            </div>
          </>
        )}
      </FormModal>
    </div>
  );
}
