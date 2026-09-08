import * as React from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/**
 * An explanation that is one hover — or one Tab — away, instead of on screen.
 *
 * Written for the permission matrix, where the notes were longer than the thing
 * they explained: thirteen rows carried 2,700 characters of prose, the tallest
 * row was six times the shortest, and a 1366×768 laptop could see two rows of a
 * thirteen-row table. The text was worth having and worth reading once; it was
 * not worth eighty per cent of the dialog every time somebody ticks a box.
 *
 * A real `<button>`, not a bare icon: Radix opens the tooltip on focus as well
 * as hover, so the note is reachable from the keyboard, and `aria-label` names
 * it for a screen reader rather than leaving an unlabelled graphic.
 */
export function InfoHint({ text, label = 'توضیح' }: { text: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          // A note is not an action: clicking it must not submit the form it
          // sits inside, and it must not steal the row's own click.
          onClick={e => e.preventDefault()}
          className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground/70 hover:text-primary focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors cursor-help"
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[42ch] leading-relaxed text-right font-medium">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
