import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { VendorDetail } from '../../src/components/vendor/VendorDetail';
import { applyDerivedState } from '../../src/utils/vendorState';
import type { User, Vendor } from '../../src/types';

/**
 * The banner follows the verdict, in both directions.
 *
 * A source disqualified by its score can be qualified again by a better one —
 * that is the whole of the latch fix — and the page has to follow it the rest
 * of the way: the red panel goes, and nothing is left on screen still calling
 * the supplier rejected.
 *
 * The record is put through `applyDerivedState` first, exactly as every load
 * does, so these are the objects the page really receives rather than ones
 * hand-stamped to suit the assertion.
 */

const BANNER = /رد صلاحیت شده/;

const admin: User = { username: 'admin', name: 'مدیر', role: 'admin' } as User;

const source = (scores: Record<string, number>, over: Partial<Vendor> = {}): Vendor =>
  applyDerivedState({
    id: 'V-BANNER',
    category: 'foreign',
    material: 'پاراستامول',
    materialEn: 'Paracetamol',
    cas: '103-90-2',
    name: 'شرکت آزمون',
    nameEn: 'Trial Co',
    country: 'India',
    status: 'new',
    grade: null,
    rejectedByDecision: false,
    scores,
    ...over,
  } as unknown as Vendor);

const show = (v: Vendor) =>
  render(
    <VendorDetail
      vendor={v}
      vendors={[v]}
      onBack={() => {}}
      onSave={() => {}}
      onDelete={() => {}}
      currentUser={admin}
    />,
  );

describe('the blacklist banner on a source page', () => {
  test('a source below the floor carries it', () => {
    show(source({ commercial: 20, qa: 20, planning: 20, finance: 20 }));
    expect(screen.getByText(BANNER)).toBeTruthy();
  });

  test('the same source, rescored, does not', () => {
    const rejected = source({ commercial: 20, qa: 20, planning: 20, finance: 20 });
    const rescored = applyDerivedState({
      ...rejected,
      scores: { commercial: 92, qa: 92, planning: 92, finance: 92 },
    }) as Vendor;

    show(rescored);
    expect(screen.queryByText(BANNER)).toBeNull();
    // And it says what it is now, rather than merely dropping the old verdict.
    expect(screen.getByText('گرید A')).toBeTruthy();
  });

  test('a rejection somebody decided is not swept away by a good score', () => {
    const decided = applyDerivedState(source(
      { commercial: 92, qa: 92, planning: 92, finance: 92 },
      { rejectedByDecision: true } as Partial<Vendor>,
    )) as Vendor;

    show(decided);
    expect(screen.getByText(BANNER)).toBeTruthy();
  });
});
