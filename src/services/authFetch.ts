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
  // In local/demo mode there is no backend: resolve a non-ok response (never
  // 401/403, so no reload) so every loader falls back to its localStorage cache
  // and writes become no-ops (state is already persisted locally by the caller).
  if (isLocalMode()) {
    return Promise.resolve(new Response(null, { status: 503 }));
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
