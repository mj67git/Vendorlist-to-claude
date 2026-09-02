import * as React from "react"
import { cn } from "../../lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * The look of a form field, exported so the native `<select>` elements in the
 * forms can wear it too.
 *
 * They cannot use `ui/select.tsx`: that one is Radix, it is driven by
 * `onValueChange` rather than a change event, and swapping ~37 dropdowns onto
 * it would be a behavioural rewrite, not a restyle. Sharing the class string
 * keeps one definition of the field look without a second select component.
 */
export const inputBaseClass =
  "flex h-9.5 w-full rounded-xl border border-input bg-background px-3 py-1.5 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50"

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          inputBaseClass,
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
