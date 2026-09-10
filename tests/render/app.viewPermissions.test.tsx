import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { atRoute, signIn } from './helpers/session';
import { VIEW_PERMISSIONS } from '../../src/utils/permissions';

/**
 * Every gated view, driven from the policy table rather than a hand-written
 * list.
 *
 * `VIEW_PERMISSIONS` is the single answer to "which page needs which
 * permission", and the sidebar, the command palette, the page itself and the
 * server all read it. Turning the 1,133-line render chain into a route table
 * is exactly the kind of change that drops one entry silently, so the test
 * enumerates the table: a view added there is covered the day it is added,
 * without anyone remembering to extend this file.
 */

/*
 * Matched on the title every refusal shares, not on the shared component's
 * closing sentence: `audit-trail` refuses with a hand-built panel of its own —
 * different markup, hardcoded rose colours with no dark variant, and none of
 * the shared wording. The gate is real, only the presentation diverges, and
 * unifying the nine refusal sites is a phase-2 job. Matching the title keeps
 * this test true both before and after that.
 */
const DENIED = /عدم دسترسی/;
const views = Object.keys(VIEW_PERMISSIONS);

const mount = async () => {
  const { default: App } = await import('../../src/App');
  return render(<App />);
};

beforeEach(() => {
  atRoute('');
});

describe('every view in the policy table', () => {
  test('the table is not empty, or the rest of this file proves nothing', () => {
    expect(views.length).toBeGreaterThan(0);
  });

  test.each(views)('#/%s opens for an account that holds its permission', async view => {
    signIn({ permissions: [VIEW_PERMISSIONS[view], 'vendor.read'] as any });
    atRoute(`#/${view}`);
    await mount();
    await waitFor(() => expect(screen.queryByText(DENIED)).toBeNull(), { timeout: 5000 });
    expect(window.location.hash).toBe(`#/${view}`);
  }, 15000);

  test.each(views)('#/%s is refused when that one permission is missing', async view => {
    // Everything except the permission this view needs, so the refusal can only
    // be about that one.
    const others = views
      .map(v => VIEW_PERMISSIONS[v])
      .filter(p => p !== VIEW_PERMISSIONS[view]);
    signIn({ permissions: [...others, 'vendor.read'] as any });
    atRoute(`#/${view}`);
    await mount();
    expect(await screen.findByText(DENIED, {}, { timeout: 5000 })).toBeTruthy();
  }, 15000);
});
