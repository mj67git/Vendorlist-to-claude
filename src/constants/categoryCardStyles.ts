// Per-category hover/accent styling for the dashboard category cards.
// Extracted from App.tsx; values unchanged.

export const categoryCardStyles: Record<string, {
  hoverBg: string;
  hoverBorder: string;
  hoverShadow: string;
  iconBg: string;
  iconBorder: string;
  iconText: string;
  statText: string;
  accentGlow: string;
}> = {
  foreign: {
    hoverBg: 'hover:bg-indigo-50/20',
    hoverBorder: 'hover:border-indigo-500/40',
    hoverShadow: 'hover:shadow-[0_12px_30px_rgba(79,70,229,0.20)]',
    iconBg: 'bg-indigo-600/10',
    iconBorder: 'border-indigo-500/25',
    iconText: 'text-indigo-600',
    statText: 'text-indigo-600',
    accentGlow: 'group-hover:shadow-[0_0_20px_rgba(79,70,229,0.30)]'
  },
  domestic: {
    hoverBg: 'hover:bg-emerald-50/20',
    hoverBorder: 'hover:border-emerald-500/40',
    hoverShadow: 'hover:shadow-[0_12px_30px_rgba(5,150,105,0.20)]',
    iconBg: 'bg-emerald-600/10',
    iconBorder: 'border-emerald-500/25',
    iconText: 'text-emerald-600',
    statText: 'text-emerald-600',
    accentGlow: 'group-hover:shadow-[0_0_20px_rgba(5,150,105,0.30)]'
  },
  veterinary: {
    hoverBg: 'hover:bg-fuchsia-50/20',
    hoverBorder: 'hover:border-fuchsia-500/40',
    hoverShadow: 'hover:shadow-[0_12px_30px_rgba(192,38,211,0.20)]',
    iconBg: 'bg-fuchsia-600/10',
    iconBorder: 'border-fuchsia-500/25',
    iconText: 'text-fuchsia-600',
    statText: 'text-fuchsia-600',
    accentGlow: 'group-hover:shadow-[0_0_20px_rgba(192,38,211,0.30)]'
  },
  packaging: {
    hoverBg: 'hover:bg-amber-50/20',
    hoverBorder: 'hover:border-amber-500/40',
    hoverShadow: 'hover:shadow-[0_12px_30px_rgba(217,119,6,0.20)]',
    iconBg: 'bg-amber-600/10',
    iconBorder: 'border-amber-500/25',
    iconText: 'text-amber-600',
    statText: 'text-amber-600',
    accentGlow: 'group-hover:shadow-[0_0_20px_rgba(217,119,6,0.30)]'
  },
  sample: {
    hoverBg: 'hover:bg-violet-50/20',
    hoverBorder: 'hover:border-violet-500/40',
    hoverShadow: 'hover:shadow-[0_12px_30px_rgba(124,58,237,0.20)]',
    iconBg: 'bg-violet-600/10',
    iconBorder: 'border-violet-500/25',
    iconText: 'text-violet-600',
    statText: 'text-violet-600',
    accentGlow: 'group-hover:shadow-[0_0_20px_rgba(124,58,237,0.30)]'
  }
};
