import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "../../lib/utils"

/**
 * The "nothing to show" row inside a table body.
 *
 * Every list had its own: same icon-over-message-over-action shape, but with
 * `py-12` in one table and `py-14` in the next, and the icon at half opacity
 * in three of them and full strength in the fourth.
 *
 * `message` says what is missing, `action` is the way out of the situation
 * (clear the filters, add the first record) and `note` is the quiet line under
 * it — either why the reader cannot act, or what would put data here. An empty
 * list with no way forward is where a person gets stuck, so callers are meant
 * to pass an action whenever one exists.
 *
 * "Nothing at all" and "nothing matching your filters" stay separate calls:
 * offering to clear filters that are not set only confuses.
 */
export function TableEmptyRow({
  colSpan,
  icon: Icon,
  message,
  action,
  note,
  iconClassName,
}: {
  colSpan: number
  icon: LucideIcon
  message: React.ReactNode
  action?: React.ReactNode
  note?: React.ReactNode
  /** For an error state, which wants a red icon rather than a muted one. */
  iconClassName?: string
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <Icon className={cn("w-8 h-8 text-muted-foreground/50", iconClassName)} />
          <span>{message}</span>
          {action}
          {note && <span className="text-2xs text-muted-foreground">{note}</span>}
        </div>
      </td>
    </tr>
  )
}
