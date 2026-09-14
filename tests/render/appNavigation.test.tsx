import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import React, { useRef } from 'react';
import { atRoute } from './helpers/session';
import { useAppNavigation } from '../../src/hooks/useAppNavigation';

/**
 * The navigation model, asserted directly rather than through a page.
 *
 * `useAppNavigation` holds the stack, the URL and the unsaved-changes guard
 * (rule 10). The guard in particular had no test at all: it was ~420 lines
 * inside `App.tsx`, and the only way to reach it was to drive a source form to
 * a dirty state through the browser — which is why moving that code out could
 * not be shown to be safe by anything except reading it. These exercise the
 * hook itself, so the next person to move it has something that fails.
 */

type Nav = ReturnType<typeof useAppNavigation>;

function mountNav() {
  const seen: { current: Nav | null } = { current: null };
  function Probe() {
    // The two refs are owned by `App` in the real tree, because the register
    // hook reads them as well (see `useVendorRegister`).
    const navGuardRef = useRef<(() => boolean) | null>(null);
    const historyRef = useRef<never[]>([]);
    seen.current = useAppNavigation({
      vendors: [], closeSidebar: () => {}, navGuardRef, historyRef: historyRef as never,
    });
    return null;
  }
  render(<Probe />);
  return seen as { current: Nav };
}

beforeEach(() => {
  atRoute('');
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe('the stack', () => {
  test('a fresh session starts on the dashboard', () => {
    const nav = mountNav();
    expect(nav.current.view).toBe('home');
    expect(nav.current.viewHistory).toHaveLength(1);
  });

  test('navigating pushes, and going back is handed to the browser', () => {
    /*
     * `goBack` does not unwind the stack itself. It calls `history.back()` and
     * lets `popstate` do it, which is the single rule that keeps the browser's
     * own Back and Forward buttons in step with the in-app stack (rule 10) —
     * and it is asserted here rather than by reading the resulting view,
     * because jsdom's `history.back()` does not deliver `popstate`
     * synchronously. The round trip itself is exercised in a real browser.
     */
    const nav = mountNav();
    act(() => nav.current.navigate('materials'));
    expect(nav.current.view).toBe('materials');

    act(() => nav.current.navigate('business-partners'));
    expect(nav.current.view).toBe('business-partners');
    expect(nav.current.viewHistory).toHaveLength(3);

    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    act(() => nav.current.goBack());
    expect(back).toHaveBeenCalledOnce();
    back.mockRestore();
  });

  test('a stack with nowhere to go back to does nothing', () => {
    const nav = mountNav();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    act(() => nav.current.goBack());
    expect(back).not.toHaveBeenCalled();
    expect(nav.current.view).toBe('home');
    back.mockRestore();
  });

  test('navigating to somewhere already on the stack unwinds to it', () => {
    // Rule 10: `navigate` behaves like switching tabs, not like drilling down —
    // a repeated destination must not stack a second copy of itself.
    const nav = mountNav();
    act(() => nav.current.navigate('materials'));
    act(() => nav.current.navigate('audit-trail'));
    const deep = nav.current.viewHistory.length;

    act(() => nav.current.navigate('materials'));
    expect(nav.current.view).toBe('materials');
    expect(nav.current.viewHistory.length).toBeLessThan(deep);
  });
});

describe('the unsaved-changes guard', () => {
  test('an armed guard defers the move instead of making it', () => {
    const nav = mountNav();
    act(() => nav.current.navigate('materials'));

    act(() => nav.current.registerNavGuard(() => true));
    act(() => nav.current.navigate('audit-trail'));

    expect(nav.current.view).toBe('materials');
    expect(nav.current.pendingNav).toBeTypeOf('function');
  });

  test('the deferred move is exactly the one that was asked for', () => {
    const nav = mountNav();
    act(() => nav.current.registerNavGuard(() => true));
    act(() => nav.current.navigate('users'));
    expect(nav.current.view).toBe('home');

    // What the confirmation dialog does when the user chooses to leave.
    const waiting = nav.current.pendingNav!;
    act(() => nav.current.registerNavGuard(null));
    act(() => { waiting(); });
    expect(nav.current.view).toBe('users');
  });

  test('a disarmed guard lets navigation through untouched', () => {
    const nav = mountNav();
    act(() => nav.current.registerNavGuard(() => false));
    act(() => nav.current.navigate('materials'));
    expect(nav.current.view).toBe('materials');
    expect(nav.current.pendingNav).toBeNull();
  });
});

describe('the address', () => {
  test('a deep link is what the stack is built from', () => {
    atRoute('#/category/foreign');
    const nav = mountNav();
    expect(nav.current.view).toBe('category');
    expect(nav.current.categoryId).toBe('foreign');
    // Home, then the category: a path, not a visit log.
    expect(nav.current.breadcrumbTrail.map(c => c.label)).toEqual(['صفحه اصلی', 'خرید خارجی']);
  });

  test('an unparseable hash starts at home rather than restoring a cached place', () => {
    atRoute('#/not-a-route/at-all');
    const nav = mountNav();
    expect(nav.current.view).toBe('home');
  });

  test('moving writes the hash', () => {
    const nav = mountNav();
    act(() => nav.current.navigate('materials'));
    expect(window.location.hash).toBe('#/materials');
  });
});
