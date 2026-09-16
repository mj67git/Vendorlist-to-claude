import React from 'react';
import { Archive, Building2, ChevronLeft, ChevronRight, Database, Handshake, History, Home, Search, Shield, ShieldAlert, UserCog, X } from 'lucide-react';
import type { Category, BusinessPartner, Material, User, Vendor } from '../../types';
import { can, categoryPermission, VIEW_PERMISSIONS } from '../../utils/permissions';
import { categoryLabels } from '../../constants/categories';
import { isInCategoryRegister } from '../../utils/vendorState';
import type { ViewState } from '../../utils/navStack';
import { AppSidebarButton as SidebarButton } from '../AppSidebarButton';
import { Button } from '../ui/button';
// @ts-expect-error — the bundler resolves this asset import; TypeScript does not.
import temadLogo from '../../assets/logo.png';

/**
 * The navigation rail: every destination this account may open, and how many
 * records are waiting in each.
 *
 * Extracted from `App.tsx` unchanged. What it is *not* is a second answer to
 * «may this account open that page» — the gate is `VIEW_PERMISSIONS` and
 * `can()`, read here exactly as the page itself and the server read it
 * (rule 14), so a hidden entry and a refused request always agree.
 */
function SidebarSection({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  if (collapsed) {
    return <div className="my-2 mx-auto w-8 border-t border-border/70" aria-hidden="true" />;
  }
  return (
    <div className="px-3 pt-4 pb-1 text-2xs font-black text-muted-foreground/70 tracking-wide">{children}</div>
  );
}

export interface AppSidebarProps {
  currentUser: User | null;
  vendors: Vendor[];
  materials: Material[];
  businessPartners: BusinessPartner[];
  view: ViewState['view'];
  categoryId: Category | null;
  selectedVendor: Vendor | null;
  navigate: (view: ViewState['view'], category?: Category | null) => void;
  criticalAuditCount: number;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCommandPalette: React.Dispatch<React.SetStateAction<boolean>>;
}

export function AppSidebar({
  currentUser, vendors, materials, businessPartners,
  view, categoryId, selectedVendor, navigate, criticalAuditCount,
  sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed,
  setShowCommandPalette,
}: AppSidebarProps) {
  return (
    /* The drawer used to open on `ease-in-out`, which spends its first frames
       barely moving — precisely the frames the user is watching after tapping
       the menu. `ease-out-quint` (the `--ease-out-quint` token, spelled out
       here because Tailwind's arbitrary-value syntax cannot take a bare `var()`
       in an `ease-` utility) leaves immediately and settles softly, which is
       the shape of a real thing being pushed.

       `transition-all` became the two properties that actually change: the
       transform for the mobile drawer and the width for the desktop collapse.
       Everything else it was animating — colour, shadow, border — changed only
       with the theme, where a 300ms crossfade of the whole sidebar was never
       the intent. The width is still a layout animation and still reflows the
       content beside it each frame; making that a transform would mean the
       main column no longer shares the layout, which is a bigger change than a
       motion pass should make. */
    <aside className={`
      fixed top-0 bottom-0 right-0 z-30 w-[272px] ${sidebarCollapsed ? 'md:w-[76px]' : 'md:w-[272px]'} bg-card/95 backdrop-blur-md border-l border-border/80
      transform transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:translate-x-0 fade-in print:hidden
      ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'}
      flex flex-col shadow-xs
    `}>
      {/* BRAND BLOCK — the Persian name is the name of the system; the
          English one is a subtitle. It used to be the other way round: a
          three-line English headline at 14px above a 10px Persian line in
          a mono face, in an application whose entire interface is Persian. */}
      {/* The mark sits above the name, both centred, rather than in a row
          beside it: the two controls that used to share this row pushed the
          brand off-centre and squeezed the name into a 15px line that read
          as small print at the top of the screen. Those controls are pinned
          to the corner now, so the brand owns the full width. */}
      <div className={`relative py-4 border-b border-border/80 ${sidebarCollapsed ? 'md:px-2 px-5' : 'px-5'}`}>
        <div className="flex flex-col items-center gap-2 text-center">
          {/* Dark navy mark on a dark card is all but invisible, so it gets
              a light plate in dark mode — same fix as the login screen. */}
          <span className="flex items-center justify-center shrink-0 dark:bg-white dark:rounded-lg dark:p-1">
            <img
              src={temadLogo}
              alt="تماد"
              className={`w-auto object-contain ${sidebarCollapsed ? 'h-10 md:h-9' : 'h-12'}`}
            />
          </span>
          <div className={`flex-col items-center min-w-0 ${sidebarCollapsed ? 'flex md:hidden' : 'flex'}`}>
            <span className="font-extrabold text-foreground text-base leading-snug tracking-tight">سامانهٔ ارزیابی تامین‌کنندگان</span>
            <span className="text-muted-foreground text-xs mt-0.5 tracking-widest" dir="ltr">VLSE</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="md:hidden text-muted-foreground absolute left-3 top-3"
          onClick={() => setSidebarOpen(false)}
        >
          <X />
        </Button>
        {/* Desktop collapse toggle */}
        <Button
          variant="outline"
          size="icon-sm"
          className={`hidden md:inline-flex text-muted-foreground absolute left-3 top-3 ${sidebarCollapsed ? 'md:hidden' : ''}`}
          onClick={() => setSidebarCollapsed(true)}
          title="جمع کردن نوار کناری"
        >
          <ChevronRight />
        </Button>
      </div>

      {/* Collapsed: search + expand controls */}
      {sidebarCollapsed && (
        <div className="hidden md:flex flex-col items-center gap-1.5 py-2 border-b border-border/80">
          <Button variant="outline" size="icon-sm" onClick={() => setShowCommandPalette(true)} title="جستجو (⌘K)" className="text-muted-foreground hover:text-primary">
            <Search />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setSidebarCollapsed(false)} title="باز کردن نوار کناری" className="text-muted-foreground">
            <ChevronLeft />
          </Button>
        </div>
      )}

      {/* Expanded: quick search launcher */}
      {!sidebarCollapsed && (
        <div className="px-3 pt-3">
          <button
            onClick={() => setShowCommandPalette(true)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-border bg-muted/40 hover:bg-accent text-muted-foreground transition-colors text-xs"
          >
            <span className="flex items-center gap-2"><Search className="w-3.5 h-3.5" /> جستجوی سریع...</span>
            <kbd className="font-mono text-2xs bg-background border border-border rounded px-1.5 py-0.5">⌘K</kbd>
          </button>
        </div>
      )}

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        <SidebarButton collapsed={sidebarCollapsed}
          icon={Home} label="صفحه اصلی" 
          variant="home"
          active={view === 'home' && !selectedVendor} 
          onClick={() => navigate('home')} 
        />

        {can(currentUser, 'vendor.read') && (
        <SidebarSection collapsed={sidebarCollapsed}>دسته‌بندی‌ها</SidebarSection>
        )}
        {can(currentUser, 'vendor.read') && (Object.entries(categoryLabels) as [Category, any][])
          // Two of the categories are their own read since the granular
          // split, and the server serves fewer rows without them — an entry
          // that leads to a page the account is not sent data for is worse
          // than no entry.
          .filter(([id]) => can(currentUser, categoryPermission(id)))
          .map(([id, meta]) => {
          const count = vendors.filter(v => isInCategoryRegister(v, id)).length;
          return (
            <SidebarButton collapsed={sidebarCollapsed}
              key={id}
              variant={id}
              badge={count}
              icon={meta.icon} label={meta.fa}
              active={view === 'category' && categoryId === id} 
              onClick={() => navigate('category', id)} 
            />
          );
        })}

        {(can(currentUser, 'partner.read') || can(currentUser, 'material.read')) && (
        <SidebarSection collapsed={sidebarCollapsed}>مدیریت پایگاه داده</SidebarSection>
        )}
        {can(currentUser, 'partner.read') && (
          <SidebarButton collapsed={sidebarCollapsed}
            icon={Building2} label="مخزن شرکای تجاری"
            badge={businessPartners?.length || 0}
            variant="business-partners"
            active={view === 'business-partners'}
            onClick={() => navigate('business-partners')}
          />
        )}
        {can(currentUser, 'material.read') && (
          <SidebarButton collapsed={sidebarCollapsed}
            icon={Database} label="مخزن مواد اولیه"
            badge={materials?.length || 0}
            variant="materials"
            active={view === 'materials'}
            onClick={() => navigate('materials')}
          />
        )}

        {(can(currentUser, 'archive.read') || can(currentUser, 'audit.read')
          || can(currentUser, 'users.read') || can(currentUser, 'supplier-audit.read')) && (
        <SidebarSection collapsed={sidebarCollapsed}>کیفیت و نظارت</SidebarSection>
        )}
        {/* Each entry is gated by the permission its page and endpoints
            actually check, not by `role === 'admin'`. A raw role test here
            diverged from the pages themselves: someone holding the
            `users.manage` exception was allowed by the page but never saw
            the link, and the archive was hidden from everyone but admins even
            though nothing restricted it (rule 14: one policy table, both
            sides). */}
        {can(currentUser, VIEW_PERMISSIONS.archive) && (
          <SidebarButton collapsed={sidebarCollapsed}
            icon={Archive} label="آرشیو کامل داده‌ها"
            badge={vendors.length}
            variant="archive"
            active={view === 'archive'}
            onClick={() => navigate('archive')}
          />
        )}
        {can(currentUser, 'audit.read') && (
          <SidebarButton collapsed={sidebarCollapsed}
            icon={History} label="ردیابی تغییرات"
            alert={criticalAuditCount}
            variant="audit-trail"
            active={view === 'audit-trail'}
            onClick={() => navigate('audit-trail')}
          />
        )}
        {can(currentUser, VIEW_PERMISSIONS.users) && (
          <SidebarButton collapsed={sidebarCollapsed}
            icon={UserCog} label="مدیریت کاربران"
            variant="audit-trail"
            active={view === 'users'}
            onClick={() => navigate('users')}
          />
        )}
        {can(currentUser, VIEW_PERMISSIONS['supplier-audit']) && (
          <SidebarButton collapsed={sidebarCollapsed}
            icon={Handshake} label="بررسی یکپارچه تامین‌کننده"
            variant="supplier-audit"
            active={view === 'supplier-audit'}
            onClick={() => navigate('supplier-audit')}
          />
        )}
      </nav>

    </aside>
  );
}
