const SESSION_STORAGE_KEYS = [
  'app_jwt_token',
  'app_currentUser',
  'app_viewHistory',
] as const;

export function clearAuthenticationSession(): void {
  SESSION_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
  try { localStorage.removeItem('app_local_mode'); } catch { /* ignore */ }
}

/**
 * Local/demo mode: the app runs entirely on browser localStorage with no
 * backend/database. Enabled when the user signs in via the local-demo button.
 */
export function isLocalMode(): boolean {
  try { return localStorage.getItem('app_local_mode') === 'true'; } catch { return false; }
}

/**
 * Authenticated fetch adapter used by the existing UI.
 *
 * Status handling and returned Response semantics intentionally match the
 * original App-level implementation.
 */
export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // In local/demo mode there is no backend. Resolve synthetically (never 401/403,
  // so no reload):
  //  - GET (reads): a non-ok 503 so every loader falls back to its localStorage
  //    cache instead of overwriting it with empty data.
  //  - writes (POST/PATCH/PUT/DELETE): an ok {success:true} so the caller's
  //    optimistic update is NOT rolled back (state is already persisted locally).
  if (isLocalMode()) {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return Promise.resolve(new Response(null, { status: 503 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, localMode: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }

  const token = localStorage.getItem('app_jwt_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return fetch(url, { ...options, headers }).then(response => {
    // Only 401 ends the session. 403 means the server knows who this is and is
    // refusing the action, which is a normal outcome for a role-restricted
    // endpoint — signing the user out for it logged non-admins straight back to
    // the login screen, because the dashboard asks for the admin-only audit
    // feed on load. Callers see the 403 and handle it themselves.
    if (response.status === 401) {
      clearAuthenticationSession();
      window.location.reload();
      throw new Error('Session has expired. Please log in again.');
    }
    return response;
  });
}

/** A write the server refused, carrying the reason it gave. */
export class ApiWriteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiWriteError';
  }
}

/** What to say when the server refused without a message of its own. */
function defaultMessage(status: number): string {
  if (status === 400) return 'دادهٔ ارسالی معتبر نیست و ثبت نشد.';
  if (status === 403) return 'سطح دسترسی شما اجازهٔ این تغییر را نمی‌دهد؛ تغییر ثبت نشد.';
  if (status === 404) return 'این رکورد دیگر روی سرور وجود ندارد.';
  if (status === 409) return 'این رکورد هم‌زمان توسط شخص دیگری تغییر کرده است.';
  if (status === 422) return 'این تغییر با قواعد سامانه سازگار نیست و ثبت نشد.';
  if (status >= 500) return 'سرور نتوانست تغییر را ثبت کند.';
  return 'تغییر روی سرور ثبت نشد.';
}

/**
 * Send a write and fail loudly when the server refuses.
 *
 * `fetch` resolves for 4xx and 5xx alike, so a `.catch()` on a bare
 * `authFetch` only ever sees a network error. Every source, material and
 * partner write took that shape: the UI updated optimistically, showed a
 * success toast, wrote the value into the localStorage cache, and then ignored
 * a 403, a 422 from the Grade-A rule, or a 500 entirely. The operator was left
 * looking at data the database had rejected — which in a GxP register is a
 * data-integrity defect, not a cosmetic one.
 *
 * Reads keep using `authFetch` directly: they have their own `res.ok` handling
 * and a failed read falls back to the cache on purpose.
 */
export async function authWrite(url: string, options: RequestInit = {}): Promise<any> {
  const res = await authFetch(url, options);
  if (res.ok) {
    try {
      return await res.json();
    } catch {
      return null; // a 200 with an empty body is still a success
    }
  }
  let serverMessage = '';
  try {
    const body = await res.json();
    serverMessage = body?.error || body?.message || '';
  } catch {
    /* not JSON — fall back to the status */
  }
  throw new ApiWriteError(res.status, serverMessage || defaultMessage(res.status));
}
