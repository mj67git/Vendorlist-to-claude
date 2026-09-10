import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { atRoute, signIn } from './helpers/session';

/**
 * The toast: it appears, it says what happened, and it goes away on its own.
 *
 * Sixteen places set the toast with a bare `setTimeout` and ten go through
 * `notify()`; the cleanup exists in one of those two paths only. Unifying them
 * is a phase-1 change, and this locks the behaviour a user can see so the
 * unification cannot quietly alter it.
 *
 * The backup download is the path under test because it is one of the sixteen,
 * and because it is reachable in two clicks without a server.
 */

beforeEach(() => {
  atRoute('');
  // jsdom implements neither, and the download builds a blob URL.
  (URL as any).createObjectURL = vi.fn(() => 'blob:test');
  (URL as any).revokeObjectURL = vi.fn();
});

const mount = async () => {
  const { default: App } = await import('../../src/App');
  return render(<App />);
};

describe('the toast', () => {
  test('says what happened, then clears itself', async () => {
    const user = userEvent.setup();
    signIn();
    await mount();

    await user.click(await screen.findByLabelText(/منوی حساب کاربری/));
    await user.click(await screen.findByText('پشتیبان‌گیری کامل'));

    const toast = await screen.findByText(/بانک اطلاعاتی لوکال با موفقیت دانلود شد/);
    expect(toast).toBeTruthy();

    // It leaves without anyone dismissing it. Three seconds is the current
    // life of a success toast; the wait is longer so a slow machine is not a
    // failure.
    await waitFor(
      () => expect(screen.queryByText(/بانک اطلاعاتی لوکال با موفقیت دانلود شد/)).toBeNull(),
      { timeout: 6000 },
    );
  }, 15000);
});
