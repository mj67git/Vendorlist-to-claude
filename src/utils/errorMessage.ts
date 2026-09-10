/**
 * What to tell the user when something threw.
 *
 * Handlers used to type the caught value as `any` and read `.message` off it.
 * That compiles for anything — including a rejected promise carrying a string,
 * a `Response`, or `undefined` — and prints `undefined` on screen when the
 * throw was not an `Error`. TypeScript types a caught value as `unknown` for
 * this reason; this is the one place that narrows it.
 *
 * `ApiWriteError` needs no special case here: it extends `Error`, so its
 * server-supplied message is what comes back. Call sites that want to
 * distinguish a refusal from a dropped connection still test for it directly.
 */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}
