import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useIsOverflowing } from '../hooks/useIsOverflowing';
import { cn } from '../lib/utils';

/**
 * The single place an entity name (source, material, business partner) is
 * rendered.
 *
 * Names in this system are long — Persian company names cluster at 20-30
 * characters and Latin ones reach 40 ("Zhejiang Tianyu Pharmaceutical Co.,
 * Ltd.") — and they were being clipped in a way that gave the reader no signal
 * that anything was missing. A half-shown supplier name in a GxP record is
 * worse than a wrapped one.
 *
 * Two things this component does that hand-written `truncate` did not:
 *
 *  - It clamps with `line-clamp`, not `truncate`. `truncate` forces
 *    `white-space: nowrap`, so a two-word name can never use a second line even
 *    when one is available. `line-clamp` lets the text wrap and then caps it.
 *  - The clamp lands on the text element itself. `truncate` on a flex container
 *    does not pass `text-overflow` down to its children, so the text is hard-cut
 *    with no ellipsis at all — the clip becomes invisible.
 *
 * The tooltip is attached only when the text is genuinely clipped, so names
 * that already read in full do not sprout a pointless hover.
 *
 * Pick `lines` by what the surrounding box can afford:
 *   0 — nothing is clipped; use wherever the layout can grow (preferred).
 *   1 — one line, ellipsis; for fixed-height rows and chips.
 *   2 — up to two lines; for cards and table cells that can take the height.
 */

interface EntityNameProps extends React.HTMLAttributes<HTMLElement> {
  name: string;
  /** Line cap. 0 means never clamp. Defaults to 1. */
  lines?: 0 | 1 | 2;
  className?: string;
  dir?: 'rtl' | 'ltr';
  /** Rendered element. Defaults to a span so it can sit inline in a flex row. */
  as?: 'span' | 'div';
}

export const EntityName: React.FC<EntityNameProps> = ({
  name,
  lines = 1,
  className,
  dir,
  as: Tag = 'span',
  ...rest
}) => {
  const { ref, isOverflowing } = useIsOverflowing<HTMLElement>(name);

  // `break-words` rather than `break-all`: Persian text broken mid-word is
  // harder to read than text that overflows to the next line.
  const clamp =
    lines === 0 ? 'break-words' : lines === 1 ? 'line-clamp-1 break-words' : 'line-clamp-2 break-words';

  const content = (
    <Tag
      {...rest}
      ref={ref as unknown as React.Ref<HTMLSpanElement & HTMLDivElement>}
      dir={dir}
      className={cn('min-w-0', clamp, className)}
      style={dir === 'ltr' ? { textAlign: 'right', ...rest.style } : rest.style}
    >
      {name}
    </Tag>
  );

  if (!isOverflowing) return content;

  return (
    <Tooltip>
      {/* asChild keeps the trigger from wrapping the text in an extra button,
          which would break the flex sizing the clamp depends on. */}
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="top" dir="rtl">
        {name}
      </TooltipContent>
    </Tooltip>
  );
};
