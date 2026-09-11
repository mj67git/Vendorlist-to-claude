import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * One active colour for the whole navigation.
 *
 * Every destination used to carry its own active hue — blue, indigo, emerald,
 * fuchsia, amber, violet, rose, teal, cyan, near-black — so the answer to
 * «where am I?» looked different on each page and could never be learned as a
 * pattern. Worse, those eleven hues consumed the semantic palette: rose meant
 * «blacklist» in the sidebar and «danger» in a table, amber meant «packaging»
 * and «warning» at the same time.
 *
 * The pill is now the primary colour everywhere. Category identity did not
 * disappear — it moved to the icon tile, which is where a per-section accent
 * can live without competing with status colour.
 */
const ACTIVE_PILL = 'bg-primary text-primary-foreground shadow-sm shadow-primary/25';
const ACTIVE_TILE = 'bg-white/20 text-primary-foreground';
const IDLE_PILL = 'text-muted-foreground dark:text-foreground/80 hover:bg-accent/80 hover:text-foreground';

/** The section accent, carried by the icon tile of an inactive row. */
const iconTint: Record<string, string> = {
  home: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  archive: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  foreign: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  domestic: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  veterinary: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400',
  packaging: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  sample: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  blacklist: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  'supplier-audit': 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  'audit-trail': 'bg-muted text-foreground/70',
  materials: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  'business-partners': 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
};

interface AppSidebarButtonProps {
  icon: LucideIcon;
  label: string;
  badge?: string | number;
  alert?: number;
  active: boolean;
  onClick: () => void;
  variant?: string;
  collapsed?: boolean;
}

export function AppSidebarButton({
  icon: Icon,
  label,
  badge,
  alert,
  active,
  onClick,
  variant = 'home',
  collapsed = false,
}: AppSidebarButtonProps) {
  const tile = iconTint[variant] || iconTint.home;
  const hasAlert = typeof alert === 'number' && alert > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'w-full flex items-center rounded-xl text-xs font-semibold transition-all duration-200 text-right group relative cursor-pointer',
        collapsed ? 'justify-center p-2' : 'gap-2.5 px-3 py-2',
        active ? ACTIVE_PILL : cn('bg-transparent', IDLE_PILL)
      )}
    >
      <div
        className={cn(
          'w-7 h-7 rounded-lg shrink-0 flex items-center justify-center transition-all duration-200 relative',
          active ? ACTIVE_TILE : tile
        )}
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
        {collapsed && hasAlert && (
          <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 bg-rose-600 text-white text-2xs font-bold rounded-full flex items-center justify-center">{alert}</span>
        )}
      </div>

      {/* The English subtitle under every label (FOREIGN PURCHASE, MATERIALS
          MASTER, AUDIT TRAIL CENTER …) doubled the height of all twelve rows
          and pushed the nav past the viewport. The Persian label is the label. */}
      {!collapsed && (
        <span className="font-bold leading-tight truncate text-inherit flex-1 min-w-0 text-right">
          {label}
        </span>
      )}

      {!collapsed && hasAlert && (
        <span className="text-2xs font-mono font-black px-1.5 py-0.5 rounded-full shrink-0 bg-rose-600 text-white" title="نیازمند توجه">
          {alert}
        </span>
      )}

      {!collapsed && badge !== undefined && (
        <span
          className={cn(
            'text-2xs font-mono font-bold px-2 py-0.5 rounded-full shrink-0',
            active
              ? 'bg-white/25 text-white'
              : 'bg-muted text-muted-foreground dark:text-muted-foreground group-hover:bg-accent'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
