/**
 * Reading numbers out of a query string.
 *
 * A query parameter is whatever the caller typed. `parseInt` alone answers
 * `NaN` for "abc", `Infinity` never survives a round-trip through it, and both
 * reach Prisma as a `skip` or `take` it will refuse — served to the client as a
 * 500 for what is really a typo in a URL. Clamping instead means the request is
 * always answerable, and an unbounded `take` cannot be asked for at all.
 */
export function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * How many sources one page carries.
 *
 * Large enough that a normal installation is one or two requests, small enough
 * that the first page paints quickly on a slow internal network. It is a limit
 * on the response, not on what exists — a caller wanting everything asks for
 * the next page.
 */
export const DEFAULT_PAGE_SIZE = 200;
export const MAX_PAGE_SIZE = 500;
