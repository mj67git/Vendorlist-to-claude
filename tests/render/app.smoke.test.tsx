import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

/**
 * Can the application be mounted at all?
 *
 * Everything else in `tests/render` depends on the answer, so it gets its own
 * file: when the harness breaks, this fails first and alone.
 */

beforeEach(() => {
  window.location.hash = '';
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })));
});

describe('mounting the application', () => {
  test('an anonymous visitor gets the sign-in screen, not the register', async () => {
    const { default: App } = await import('../../src/App');
    render(<App />);

    // The form itself, by the label its input is bound to — the heading text
    // appears more than once on that screen.
    expect(await screen.findByLabelText('نام کاربری')).toBeTruthy();
    expect(screen.getByLabelText('کلمهٔ عبور')).toBeTruthy();
    // And nothing behind it: no sidebar, no dashboard.
    expect(screen.queryByText('دسته‌بندی‌های تامین')).toBeNull();
  });
});
