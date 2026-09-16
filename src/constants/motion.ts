/**
 * The motion vocabulary, in one place.
 *
 * Durations and curves used to be typed at the call site — five Tailwind
 * duration literals (150/200/300/500/700) and two hand-written cubic-beziers
 * that nobody could tell apart from each other. That is the same problem the
 * text scale had before `--text-*`: a value you can only change by finding
 * every copy of it is a value nobody changes.
 *
 * This file is the JavaScript half. The CSS half lives in `index.css` under
 * `@theme` (`--ease-emphasis`, `--ease-out-quint`, `--ease-in-quint`) and
 * carries the *same* numbers, because Motion animates with inline styles and
 * cannot read a Tailwind utility. Change a curve here and change it there.
 *
 * Rules the values encode (from Apple's «Designing Fluid Interfaces»):
 *
 *   - A press must be felt immediately: PRESS is 75ms, not the 200ms that the
 *     surrounding colour transition wants.
 *   - Entrances are watched, exits are not. An entrance gets the full duration
 *     and an ease-out; an exit gets roughly half and the mirrored curve, so a
 *     reversible transition returns along the path it left by.
 *   - Overshoot belongs to motion the user's own gesture launched. Nothing in
 *     this application is drag-driven, so nothing here bounces.
 */

/** Curves. `OUT`/`IN` are mirror images — use them as a pair on a reversible transition. */
export const EASE = {
  /** Strong decelerate. The default for anything arriving on screen. */
  OUT: [0.22, 1, 0.36, 1],
  /** The mirror of OUT, for the return leg of the same transition. */
  IN: [0.64, 0, 0.78, 0],
  /** Sharper decelerate, for surfaces that need to feel deliberate (dialogs). */
  EMPHASIS: [0.16, 1, 0.3, 1],
} as const;

/** Seconds, because that is what Motion takes. `MS` below is the same ladder for CSS. */
export const DURATION = {
  /** Press feedback. Anything slower reads as lag on the finger. */
  PRESS: 0.075,
  /** Small, local changes: a chevron turning, a chip swapping colour. */
  FAST: 0.12,
  /** The default for an element entering or leaving. */
  BASE: 0.2,
  /** Panels and drawers — a larger surface may take longer to cross the screen. */
  PANEL: 0.3,
} as const;

/** The same ladder in milliseconds, for `setTimeout` and inline styles. */
export const DURATION_MS = {
  PRESS: 75,
  FAST: 120,
  BASE: 200,
  PANEL: 300,
} as const;

/** Entrance: full duration, decelerating. */
export const ENTER = { duration: DURATION.BASE, ease: EASE.OUT } as const;

/** Exit: about half, on the mirrored curve. Nobody watches an exit finish. */
export const EXIT = { duration: DURATION.FAST, ease: EASE.IN } as const;

/**
 * How long a "saved" screen stays up before the form closes itself.
 *
 * It was a second, in three forms, hard-coded in each. A second is long enough
 * to register as waiting rather than as confirmation — the tick has finished
 * its 220ms `bounce-in` and the reader has finished the sentence well before
 * the screen moves. 650ms leaves the tick fully seen and the message read
 * without the user starting to wonder whether something is stuck.
 *
 * Rule 8a of CLAUDE.md is the better answer where it applies: stay on the page
 * and confirm with a toast. This constant is for the three forms that already
 * hand control back somewhere else when they finish.
 */
export const SUCCESS_HOLD_MS = 650;
