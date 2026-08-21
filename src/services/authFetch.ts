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
    if (response.status === 401 || response.status === 403) {
      clearAuthenticationSession();
      window.location.reload();
      throw new Error('Session has expired. Please log in again.');
    }
    return response;
  });
}
