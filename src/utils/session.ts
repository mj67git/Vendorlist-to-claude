/**
 * Session helpers for what the user menu shows.
 *
 * The expiry is read out of the token's payload without verifying it. That is
 * fine here and only here: this drives a label, never a decision. The server
 * verifies the signature on every request, and nothing in the UI may treat a
 * token as valid because this said so — a tampered token would simply display
 * a wrong time and still be rejected on the next call.
 */

/** Milliseconds left before the stored token expires, or null if unreadable. */
export function sessionRemainingMs(token?: string | null): number | null {
  const raw = token ?? (() => {
    try { return localStorage.getItem('app_jwt_token'); } catch { return null; }
  })();
  if (!raw) return null;

  const parts = raw.split('.');
  if (parts.length !== 3) return null;

  try {
    // base64url -> base64, then decode as UTF-8 safe.
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '='))
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    const exp = JSON.parse(json)?.exp;
    if (typeof exp !== 'number') return null;
    return exp * 1000 - Date.now();
  } catch {
    return null;
  }
}

/** "۳ روز و ۴ ساعت" style remaining-time label, or null when unknown/expired. */
export function formatRemaining(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms <= 0) return 'منقضی شده';

  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days > 0) return hours > 0 ? `${days} روز و ${hours} ساعت` : `${days} روز`;
  if (hours > 0) return mins > 0 ? `${hours} ساعت و ${mins} دقیقه` : `${hours} ساعت`;
  return `${Math.max(mins, 1)} دقیقه`;
}

/** Absolute Persian date-time, used for "last login". */
export function formatDateTime(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}
