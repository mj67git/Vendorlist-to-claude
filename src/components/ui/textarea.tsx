import * as React from "react"
import { cn } from "../../lib/utils"
import { inputBaseClass } from "./input"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        // Built from the input's own class string rather than a second copy of
        // it: a text field and a comment box that disagree about their focus
        // ring are the thing this was supposed to stop. Only the height rules
        // differ, and `cn` lets the later ones win.
        className={cn(
          inputBaseClass,
          "h-auto min-h-[80px] py-2",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
