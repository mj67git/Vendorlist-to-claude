import * as React from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { cn } from "../../lib/utils"

/**
 * A sortable column header, shared by the four tables that have one.
 *
 * There were four copies of this — materials, business partners, users and
 * the audit trail — identical apart from a couple of pixels of padding, the
 * hover colour, and whether the prop was called `sortOrder` or
 * `sortDirection`. They drifted, so a column could announce `aria-sort` in one
 * table and not the next.
 *
 * It is generic over the field name so each table keeps its own union type and
 * a typo in a column key is still a compile error.
 *
 * A button inside the `<th>`, not a clickable `<th>`: the column has to be
 * reachable from the keyboard and announce itself as a control.
 */
export function SortHeader<F extends string>({
  field,
  label,
  sortField,
  sortOrder,
  onSort,
  center,
  width,
  className,
}: {
  field: F
  label: string
  sortField: F
  sortOrder: "asc" | "desc"
  onSort: (field: F) => void
  /** Centre the label, for narrow columns whose cells are centred too. */
  center?: boolean
  /** Fixed column width, when the table pins its columns. */
  width?: string
  className?: string
}) {
  const active = sortField === field
  const Icon = !active ? ArrowUpDown : sortOrder === "asc" ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn("font-bold p-0", active && "text-foreground", className)}
      aria-sort={active ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        title={`مرتب‌سازی بر اساس ${label}`}
        className={cn(
          "w-full py-3.5 px-4 flex items-center gap-1.5 hover:bg-accent hover:text-foreground transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:-outline-offset-2",
          center && "justify-center"
        )}
      >
        <span>{label}</span>
        <Icon className={cn("w-3 h-3 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
      </button>
    </th>
  )
}
