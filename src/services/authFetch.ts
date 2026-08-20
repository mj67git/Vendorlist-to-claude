const SESSION_STORAGE_KEYS = [
  'app_jwt_token',
  'app_currentUser',
  'app_viewHistory',
] as const;

export function clearAuthenticationSession(): void {
  SESSION_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
}

/**
 * Authenticated fetch adapter used by the existing UI.
 *
 * Status handling and returned Response semantics intentionally match the
 * original App-level implementation.
 */
export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
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
