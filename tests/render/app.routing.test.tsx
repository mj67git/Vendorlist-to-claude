import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { atRoute, signIn } from './helpers/session';

/**
 * What a URL opens, and for whom.
 *
 * These are the behaviours the router rework has to preserve: the hash decides
 * the page, and the account decides whether that page is served at all. Both
 * currently live in a 1,133-line `renderContent` chain, and both are exactly
 * what a chain like that gets wrong when it is rewritten as a table.
 *
 * The refusal is matched by the sentence every `AccessDenied` carries, not by
 * a per-module title, so the tests keep passing when the wording is unified.
 */

const DENIED = /عدم دسترسی/;

const mount = async () => {
  const { default: App } = await import('../../src/App');
  return render(<App />);
};

beforeEach(() => {
  atRoute('');
});

describe('the hash decides the page', () => {
  test('the dashboard is what an administrator lands on', async () => {
    signIn();
    await mount();
    expect(await screen.findByText('دسته‌بندی‌های تامین')).toBeTruthy();
  });

  test('a deep link opens its own page, not the dashboard', async () => {
    signIn();
    atRoute('#/materials');
    await mount();

    // The materials repository is lazily imported, so this waits for the chunk.
    await waitFor(() => expect(screen.queryByText('دسته‌بندی‌های تامین')).toBeNull(), { timeout: 4000 });
    expect(window.location.hash).toBe('#/materials');
  });

  test('an unparseable hash lands on the dashboard rather than nowhere', async () => {
    signIn();
    atRoute('#/this-view-does-not-exist');
    await mount();
    expect(await screen.findByText('دسته‌بندی‌های تامین')).toBeTruthy();
  });
});

describe('the account decides whether the page is served', () => {
  test('a planning account still reads the materials repository', async () => {
    /*
     * Every working role carries all seven reads — that was the point of the
     * granular split, and this is the half of it that is easy to break by
     * accident. The first draft of this test asserted a refusal and failed:
     * the test was wrong, not the policy.
     */
    signIn({ username: 'planning', role: 'planning', name: 'کارشناس برنامه‌ریزی' });
    atRoute('#/materials');
    await mount();
    await waitFor(() => expect(screen.queryByText(DENIED)).toBeNull(), { timeout: 4000 });
  });

  test('a planning account is refused the user administration page', async () => {
    signIn({ username: 'planning', role: 'planning', name: 'کارشناس برنامه‌ریزی' });
    atRoute('#/users');
    await mount();
    expect(await screen.findByText(DENIED, {}, { timeout: 4000 })).toBeTruthy();
  });

  test('an administrator is refused nothing', async () => {
    signIn();
    atRoute('#/users');
    await mount();
    await waitFor(() => expect(screen.queryByText(DENIED)).toBeNull(), { timeout: 4000 });
  });

  test('a stored permission list replaces the role, and the page follows it', async () => {
    // The exception is per user: an administrator whose stored list omits the
    // materials read must be refused, whatever the role says.
    signIn({ permissions: ['vendor.read', 'partner.read'] as any });
    atRoute('#/materials');
    await mount();
    expect(await screen.findByText(DENIED, {}, { timeout: 4000 })).toBeTruthy();
  });
});
