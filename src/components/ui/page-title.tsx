import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "../../lib/utils"

/**
 * The title block at the top of a page: what this screen is, and one line on
 * what it is for.
 *
 * Only the text block, deliberately. The surrounding card or rule and the
 * toolbar on the other side differ per page and stay with the caller — this
 * fixes the part that was actually inconsistent: the four repository screens
 * used `h1` three times and `h2` once, at three font weights, so a screen
 * reader heard a different document outline depending on which page it landed
 * on.
 *
 * Two shapes exist, and both are here because both are already in use:
 * `eyebrow` is the small Latin caption above the Persian title (materials,
 * business partners) and `icon` is the tinted tile beside it (users, audit
 * trail).
 */
export function PageTitle({
  title,
  subtitle,
  icon: Icon,
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  className,
}: {
  title: string
  subtitle?: React.ReactNode
  /** Tinted icon tile to the side of the title. */
  icon?: LucideIcon
  /** Latin caption above the title, e.g. "Material Master Registry". */
  eyebrow?: string
  eyebrowIcon?: LucideIcon
  className?: string
}) {
  const heading = (
    <h1 className="text-xl font-black text-foreground tracking-tight">{title}</h1>
  )
  return (
    <div className={cn("space-y-1", className)}>
      {eyebrow && (
        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-mono text-xs uppercase tracking-wider">
          {EyebrowIcon && <EyebrowIcon className="w-4 h-4" />}
          <span>{eyebrow}</span>
        </div>
      )}
      {Icon ? (
        <div className="flex items-center gap-2.5">
          <div className="bg-primary/10 border border-primary/20 p-2.5 rounded-xl shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-1 min-w-0">
            {heading}
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      ) : (
        <>
          {heading}
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </>
      )}
    </div>
  )
}
