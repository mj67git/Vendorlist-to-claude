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

/** Latin digits to Persian ones, for a value assembled from ISO parts. */
export const toPersianDigits = (s: string) => s.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * An ISO-shaped string whose year is actually Jalali, split into its parts.
 *
 * The forms write a moment as a Jalali string («۱۴۰۵/۰۶/۰۶، ۰۹:۵۶»); the server
 * normalises the digits and hands the result to `new Date`, which reads ۱۴۰۵ as
 * a *Gregorian* year, stores it, and returns it as `1405-06-06T09:56:00.000Z`.
 * The numbers are the Jalali ones the user saw, wearing a Gregorian label, so
 * reading the parts back literally is the only rendering that shows the date
 * that was actually filed — converting would move it back six centuries.
 *
 * `null` for anything else, including a genuine Gregorian instant, which the
 * callers convert normally.
 */
export function jalaliIsoParts(value: string): { y: string, m: string, d: string, hh?: string, mm?: string } | null {
  const iso = value.match(/^(\d{3,4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!iso) return null;
  const [, y, m, d, hh, mm] = iso;
  const year = Number(y);
  if (year < 1200 || year > 1600) return null;
  return { y, m, d, hh, mm };
}

/**
 * Show the timestamp on an activity-log entry.
 *
 * These reached the screen as `1405-06-06T09:56:00.000Z` — a machine timestamp
 * printed at the reader, in the banner that names who blacklisted a source and
 * in the box that records a sample's verdict.
 */
export function formatLogTimestamp(value: string | null | undefined): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  // Already Persian: whatever was typed, shown as typed.
  if (/[۰-۹]/.test(raw)) return raw;

  const parts = jalaliIsoParts(raw);
  if (parts) {
    const day = toPersianDigits(`${parts.y}/${parts.m}/${parts.d}`);
    return parts.hh ? `${day} · ${toPersianDigits(`${parts.hh}:${parts.mm}`)}` : day;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  try {
    return parsed.toLocaleString('fa-IR', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return raw;
  }
}
