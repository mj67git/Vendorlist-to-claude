/**
 * Show a stored date in the calendar the rest of the interface uses.
 *
 * Dates on a source are stored as text, and two writers disagree about the
 * calendar: the forms write Jalali (`۱۴۰۵/۰۶/۱۷`), while the server's fallback
 * for a record saved without one wrote a Gregorian ISO day (`2026-09-08`). A
 * record created through a script, an import, or any save that omitted the
 * field therefore printed a different calendar from the record beside it.
 *
 * The server no longer writes the Gregorian default, but rows already stored
 * that way are still in the database, so the reading side converts as well as
 * the writing side. Anything already Persian is left exactly as entered — it is
 * what somebody typed, and re-parsing it would risk changing their meaning.
 *
 * This lived inside `PrintableForms.tsx` and fixed the problem on paper only;
 * the screen kept showing the raw value.
 */
export function toJalaliDisplay(value: string | null | undefined, fallback = 'ثبت‌نشده'): string {
  const raw = (value || '').trim();
  if (!raw) return fallback;
  // Already Persian (Persian digits or a Jalali-looking year) — leave it alone.
  if (/[۰-۹]/.test(raw) || /^1[34]\d{2}[/-]/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    return d.toLocaleDateString('fa-IR');
  } catch {
    return raw;
  }
}
