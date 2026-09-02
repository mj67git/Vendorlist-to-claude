import * as React from "react"

/**
 * Placeholder rows shown while the first fetch is in flight.
 *
 * Four tables had their own copy of this, and the copies had drifted: three
 * marked the rows `aria-hidden`, the users table did not, so a screen reader
 * read out five rows of fake data as if they were accounts.
 *
 * Grey bars rather than a spinner on an empty page, because a bar is the height
 * of a real row and the layout does not jump when the data lands.
 *
 * `width` stays a per-table callback on purpose: each table has its own idea of
 * which column is the wide name and which is the narrow badge, and flattening
 * that into one rule would change how four screens look for no reason. It takes
 * the row index too, because one table staggers the widths down the rows.
 *
 * No row border here: three of the four tables separate rows with `divide-y` on
 * the `<tbody>`, so a border on the row itself would double up. The one that
 * borders each row passes `rowClassName`.
 */
export function TableSkeletonRows({
  rows,
  columns,
  width,
  barClassName = "h-3.5",
  rowClassName,
}: {
  rows: number
  columns: number
  /** Bar width in column `col` of row `row`, e.g. `c => (c === 0 ? "80%" : "60%")`. */
  width?: (col: number, row: number) => string
  /** Bar height, for tables whose rows are tighter than the default. */
  barClassName?: string
  rowClassName?: string
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={`skeleton-${r}`} aria-hidden="true" className={rowClassName}>
          {Array.from({ length: columns }).map((__, c) => (
            <td key={c} className="py-3.5 px-4">
              <div
                className={`${barClassName} rounded bg-muted animate-pulse`}
                style={{ width: width ? width(c, r) : "60%" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
