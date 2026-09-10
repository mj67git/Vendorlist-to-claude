import { vi } from 'vitest';
import type { User } from '../../../src/types';

/**
 * A signed-in browser, without a server.
 *
 * `app_local_mode` makes `authFetch` answer every read with 503 and every write
 * with success, entirely from the browser — which is exactly the shape a render
 * test wants: no network, no database, and the same code paths the application
 * takes when the backend is unreachable. Tests that need a *failing* write turn
 * local mode off and stub `fetch` themselves.
 */
export function signIn(overrides: Partial<User> = {}): User {
  const user = {
    username: 'admin',
    name: 'مدیر سیستم',
    role: 'admin',
    isActive: true,
    mustChangePassword: false,
    ...overrides,
  } as User;
  localStorage.setItem('app_currentUser', JSON.stringify(user));
  localStorage.setItem('app_local_mode', 'true');
  localStorage.setItem('auth_token', 'test-token');
  return user;
}

/** Land the page on a route before it mounts, the way a shared link does. */
export function atRoute(hash: string) {
  window.location.hash = hash;
}

/** A fetch that never reaches a network, for the tests that leave local mode. */
export function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    return handler(url, init);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
