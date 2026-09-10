import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, X, Globe, Database, Building2, Home, Archive, History, Handshake, CornerDownLeft } from 'lucide-react';
import { EntityName } from './EntityName';
import type { Vendor, Material, BusinessPartner, Category } from '../types';
import { can, VIEW_PERMISSIONS, type PermissionSubject } from '../utils/permissions';

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  group: string;
  icon: any;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  vendors: Vendor[];
  materials: Material[];
  partners: BusinessPartner[];
  onSelectVendor: (v: Vendor) => void;
  onNavigate: (view: string, categoryId?: Category | null) => void;
  /** Who is searching, so the palette offers only what they may open. */
  currentUser?: PermissionSubject | null;
}

export function CommandPalette({ open, onClose, vendors, materials, partners, onSelectVendor, onNavigate, currentUser }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    // Each page carries the permission its own screen checks, so the palette
    // cannot offer a shortcut into a page that answers «عدم دسترسی». It used to
    // list all six for everybody — the one place in the application where the
    // sidebar hid an entry and this still handed it out.
    const pages: Array<CommandItem & { view: string | null }> = [
      { id: 'p-home', title: 'صفحه اصلی', subtitle: 'داشبورد', group: 'صفحات', icon: Home, view: null, run: () => onNavigate('home') },
      { id: 'p-archive', title: 'آرشیو کامل داده‌ها', subtitle: 'Full Archive', group: 'صفحات', icon: Archive, view: 'archive', run: () => onNavigate('archive') },
      { id: 'p-audit', title: 'ردیابی تغییرات (Audit)', subtitle: 'Audit Trail', group: 'صفحات', icon: History, view: 'audit-trail', run: () => onNavigate('audit-trail') },
      { id: 'p-partners', title: 'مخزن شرکای تجاری', subtitle: 'Business Partners', group: 'صفحات', icon: Building2, view: 'business-partners', run: () => onNavigate('business-partners') },
      { id: 'p-materials', title: 'مخزن مواد اولیه', subtitle: 'Materials Master', group: 'صفحات', icon: Database, view: 'materials', run: () => onNavigate('materials') },
      { id: 'p-360', title: 'بررسی یکپارچه تامین‌کننده', subtitle: 'Supplier 360', group: 'صفحات', icon: Handshake, view: 'supplier-audit', run: () => onNavigate('supplier-audit') },
    ];
    const openPages: CommandItem[] = pages
      .filter(p => p.view === null || can(currentUser ?? null, VIEW_PERMISSIONS[p.view]))
      .map(({ view: _view, ...item }) => item);
    // The records themselves follow the same rule. The source list is already
    // filtered by the server for this account (`readableVendors`), so what is
    // in `vendors` is what may be seen; materials and partners have their own read.
    const sourceItems: CommandItem[] = (can(currentUser ?? null, 'vendor.read') ? vendors : []).slice(0, 400).map(v => ({
      id: `v-${v.id}`, title: v.name || v.material || 'سورس', subtitle: `${v.material || ''}${v.grade ? ' · گرید ' + v.grade : ''}`,
      group: 'سورس‌ها / تامین‌کنندگان', icon: Globe, run: () => onSelectVendor(v),
    }));
    const mats: CommandItem[] = (can(currentUser ?? null, 'material.read') ? materials || [] : []).slice(0, 300).map(m => ({
      id: `m-${(m as any).id}`, title: (m as any).nameFa || (m as any).name || 'ماده', subtitle: (m as any).cas || 'ماده اولیه',
      group: 'مواد اولیه', icon: Database, run: () => onNavigate('materials'),
    }));
    const parts: CommandItem[] = (can(currentUser ?? null, 'partner.read') ? partners || [] : []).slice(0, 300).map(p => ({
      id: `bp-${p.id}`, title: p.name, subtitle: p.type === 'Manufacturer' ? 'تولیدکننده' : 'فروشنده',
      group: 'شرکای تجاری', icon: Building2, run: () => onNavigate('business-partners'),
    }));
    return [...openPages, ...sourceItems, ...mats, ...parts];
  }, [vendors, materials, partners, onNavigate, onSelectVendor, currentUser]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 40);
    return items.filter(it => (`${it.title} ${it.subtitle || ''} ${it.group}`).toLowerCase().includes(q)).slice(0, 40);
  }, [items, query]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  if (!open) return null;

  const runItem = (it?: CommandItem) => {
    if (!it) return;
    it.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(filtered[activeIndex]); }
  };

  // Group the filtered items in order, tracking a flat index for keyboard nav.
  let flatIndex = -1;
  const groups: { name: string; items: { it: CommandItem; idx: number }[] }[] = [];
  for (const it of filtered) {
    flatIndex++;
    let g = groups.find(x => x.name === it.group);
    if (!g) { g = { name: it.group, items: [] }; groups.push(g); }
    g.items.push({ it, idx: flatIndex });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-popover border border-border rounded-2xl shadow-2xl overflow-hidden fade-in" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="جستجوی سریع: سورس، ماده، شریک، صفحه..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground focus:outline-none"
          />
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-xs">موردی یافت نشد.</div>
          ) : (
            groups.map(g => (
              <div key={g.name} className="mb-1.5">
                <div className="px-2 py-1 text-2xs font-bold text-muted-foreground/70 uppercase tracking-wide">{g.name}</div>
                {g.items.map(({ it, idx }) => (
                  <button
                    key={it.id}
                    onClick={() => runItem(it)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-right transition-colors ${
                      idx === activeIndex ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${idx === activeIndex ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      <it.icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <EntityName as="div" name={it.title} lines={1} className="text-xs font-bold" />
                      {it.subtitle && <EntityName as="div" name={it.subtitle} lines={1} className="text-2xs text-muted-foreground" />}
                    </div>
                    {idx === activeIndex && <CornerDownLeft className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-border bg-muted/40 flex items-center justify-between text-2xs text-muted-foreground font-mono">
          <span>↑↓ حرکت · ↵ انتخاب · Esc بستن</span>
          <span>{filtered.length} نتیجه</span>
        </div>
      </div>
    </div>
  );
}
