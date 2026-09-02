import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface VariantStyle {
  activeClass: string;
  hoverClass: string;
  iconActiveClass: string;
  iconHoverClass: string;
  indicatorColor: string;
}

const variantStyles: Record<string, VariantStyle> = {
  home: {
    activeClass: 'bg-blue-600 text-white shadow-sm shadow-blue-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-blue-600 dark:hover:text-blue-400',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-blue-600 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/40',
    indicatorColor: 'bg-blue-500',
  },
  archive: {
    activeClass: 'bg-blue-600 text-white shadow-sm shadow-blue-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-blue-600',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-blue-600 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/40',
    indicatorColor: 'bg-blue-500',
  },
  foreign: {
    activeClass: 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-indigo-600',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-indigo-600 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-950/40',
    indicatorColor: 'bg-indigo-500',
  },
  domestic: {
    activeClass: 'bg-emerald-600 text-white shadow-sm shadow-emerald-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-emerald-600',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-emerald-600 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-950/40',
    indicatorColor: 'bg-emerald-500',
  },
  veterinary: {
    activeClass: 'bg-fuchsia-600 text-white shadow-sm shadow-fuchsia-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-fuchsia-600',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-fuchsia-600 group-hover:bg-fuchsia-50 dark:group-hover:bg-fuchsia-950/40',
    indicatorColor: 'bg-fuchsia-500',
  },
  packaging: {
    activeClass: 'bg-amber-600 text-white shadow-sm shadow-amber-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-amber-600',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-amber-600 group-hover:bg-amber-50 dark:group-hover:bg-amber-950/40',
    indicatorColor: 'bg-amber-500',
  },
  sample: {
    activeClass: 'bg-violet-600 text-white shadow-sm shadow-violet-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-violet-600',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-violet-600 group-hover:bg-violet-50 dark:group-hover:bg-violet-950/40',
    indicatorColor: 'bg-violet-500',
  },
  blacklist: {
    activeClass: 'bg-rose-600 text-white shadow-sm shadow-rose-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-rose-600',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-rose-600 group-hover:bg-rose-50 dark:group-hover:bg-rose-950/40',
    indicatorColor: 'bg-rose-500',
  },
  'supplier-audit': {
    activeClass: 'bg-teal-600 text-white shadow-sm shadow-teal-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-teal-600',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-teal-600 group-hover:bg-teal-50 dark:group-hover:bg-teal-950/40',
    indicatorColor: 'bg-teal-500',
  },
  'audit-trail': {
    activeClass: 'bg-slate-800 text-white shadow-sm shadow-slate-700/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-foreground dark:hover:text-white',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-foreground group-hover:bg-slate-200 dark:group-hover:bg-slate-700',
    indicatorColor: 'bg-slate-600',
  },
  materials: {
    activeClass: 'bg-cyan-600 text-white shadow-sm shadow-cyan-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-cyan-600',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-cyan-600 group-hover:bg-cyan-50 dark:group-hover:bg-cyan-950/40',
    indicatorColor: 'bg-cyan-500',
  },
  'business-partners': {
    activeClass: 'bg-blue-600 text-white shadow-sm shadow-blue-500/25',
    hoverClass: 'text-muted-foreground dark:text-slate-300 hover:bg-accent/80 dark:hover:bg-slate-800/60 hover:text-blue-600',
    iconActiveClass: 'bg-white/20 text-white',
    iconHoverClass: 'bg-muted dark:bg-slate-800 text-muted-foreground group-hover:text-blue-600 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/40',
    indicatorColor: 'bg-blue-500',
  },
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
  const currentStyle = variantStyles[variant] || variantStyles.home;
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
        active
          ? currentStyle.activeClass
          : cn('bg-transparent', currentStyle.hoverClass)
      )}
    >
      <div
        className={cn(
          'w-7 h-7 rounded-lg shrink-0 flex items-center justify-center transition-all duration-200 relative',
          active
            ? currentStyle.iconActiveClass
            : currentStyle.iconHoverClass
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
              : 'bg-muted dark:bg-slate-800 text-muted-foreground dark:text-muted-foreground group-hover:bg-slate-200 dark:group-hover:bg-slate-700'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
