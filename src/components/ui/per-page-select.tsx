import React from 'react';

/**
 * How many rows a paged list shows at once.
 *
 * Four modules had grown their own copy of this label-plus-select, and they had
 * already drifted: two offered 10/25/50/100 and one offered 20/50/100/200, so
 * "how many rows can I see" had a different answer depending on which module the
 * user was standing in — and two other paged modules (دسته‌بندی‌ها، بررسی
 * یکپارچه) offered no answer at all, being fixed at 20. One control, one list of
 * sizes, six modules.
 *
 * The list keeps both former defaults (10 and 20) so no module's starting page
 * size had to change to adopt it.
 */
export const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;

interface PerPageSelectProps {
  value: number;
  /** Callers reset to page 1 themselves; the current page is not this control's business. */
  onChange: (value: number) => void;
  options?: readonly number[];
}

export const PerPageSelect: React.FC<PerPageSelectProps> = ({
  value,
  onChange,
  options = PER_PAGE_OPTIONS,
}) => (
  <label className="flex items-center gap-2 text-2xs font-bold text-muted-foreground shrink-0">
    <span>تعداد در هر صفحه</span>
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="bg-card border border-border rounded-lg px-2 py-1 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {options.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  </label>
);
