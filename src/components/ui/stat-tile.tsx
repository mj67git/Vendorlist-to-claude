import React from 'react';

/**
 * The overview counter every repository screen opens with.
 *
 * Four modules had grown four of these — different corner radius, different
 * gap, some with an icon, some with a Latin caption, one printing its number in
 * Latin digits while its neighbours printed Persian ones, and each with its own
 * idea of what "still loading" looks like. That is the same drift that split
 * the table primitives into four copies, so the shape lives here once.
 *
 * A tile with `onClick` renders as a real button: the audit trail's tiles are
 * quick filters, not just counters, and a tile that acts must not look exactly
 * like a tile that only reports.
 */
export interface StatTileProps {
  /** Persian label, the first line. */
  label: string;
  /** The figure. Numbers are always rendered with Persian digits. */
  value: number | string;
  /** The third line: a Latin caption, or a sentence of context. */
  hint?: string;
  /** `ltr` for a Latin caption, so it is not laid out right-to-left. */
  hintDir?: 'rtl' | 'ltr';
  icon?: React.ComponentType<{ className?: string }>;
  /** Icon-tile colours, e.g. `bg-rose-50 text-rose-600 border-rose-100 …`. */
  tone?: string;
  /** Colour override for the number itself, for a severity figure. */
  valueClassName?: string;
  /** Show a skeleton instead of the figure. */
  loading?: boolean;
  /** Makes the tile a button; `active` reflects the state it applies. */
  onClick?: () => void;
  active?: boolean;
}

export const StatTile: React.FC<StatTileProps> = ({
  label, value, hint, hintDir = 'rtl', icon: Icon, tone, valueClassName, loading = false, onClick, active = false,
}) => {
  const body = (
    <>
      {Icon && (
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${tone || 'bg-muted text-foreground border-border'}`}>
          <Icon className="w-5 h-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-bold text-muted-foreground truncate">{label}</div>
        {loading ? (
          <div className="h-6 w-10 bg-muted rounded animate-pulse mt-1" />
        ) : (
          <div className={`text-xl font-black font-mono leading-tight mt-0.5 ${valueClassName || 'text-foreground'}`}>
            {typeof value === 'number' ? value.toLocaleString('fa-IR') : value}
          </div>
        )}
        {hint && (
          <div className="text-2xs text-muted-foreground/80 truncate" dir={hintDir}>{hint}</div>
        )}
      </div>
    </>
  );

  const shell = 'p-3 sm:p-4 rounded-xl border shadow-xs flex items-center gap-3 text-right transition-all';

  if (!onClick) {
    return <div className={`${shell} bg-card border-border hover:shadow-sm`}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${shell} w-full ${active ? 'bg-accent border-foreground/30' : 'bg-card border-border hover:bg-accent/60 hover:shadow-sm'}`}
    >
      {body}
    </button>
  );
};
