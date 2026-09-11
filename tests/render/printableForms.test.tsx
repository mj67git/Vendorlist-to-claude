import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { PrintableEvaluationForm } from '../../src/components/PrintableForms';
import type { Vendor } from '../../src/types';

/**
 * What a filed document says about a disqualified supplier.
 *
 * The printed form said nothing at all: the rank block prints the grade the
 * departments recorded, and a source keeps that grade after it is blacklisted,
 * so a disqualified supplier could be signed and archived on a sheet reading
 * «Grade B» — while the spreadsheet exported from the same screen said
 * `Blacklist`. These hold the band, and hold it to appearing only when the
 * record is actually rejected.
 */

const BAND = /این تأمین‌کننده در لیست سیاه قرار دارد/;

const vendor = (over: Partial<Vendor> = {}): Vendor => ({
  id: 'V-PRINT-1',
  category: 'foreign',
  material: 'پاراستامول',
  materialEn: 'Paracetamol',
  cas: '103-90-2',
  name: 'شرکت الف',
  nameEn: 'Alpha Co',
  country: 'India',
  status: 'approved',
  grade: 'B',
  scores: { commercial: 70, qa: 72, planning: 68, finance: 75 },
  ...over,
} as Vendor);

const show = (v: Vendor) =>
  render(<PrintableEvaluationForm vendor={v} onBack={() => {}} partners={[]} materials={[]} />);

describe('the blacklist band on the printed form', () => {
  test('a disqualified source carries it', () => {
    show(vendor({ status: 'rejected' }));
    expect(screen.getByText(BAND)).toBeTruthy();
  });

  test('an ordinary source does not', () => {
    show(vendor());
    expect(screen.queryByText(BAND)).toBeNull();
  });

  test('the rank block says the state, not only the grade it earned', () => {
    show(vendor({ status: 'rejected' }));
    // Both: the disqualification is the headline, the assessment behind it is
    // still evidence and stays on the sheet.
    expect(screen.getAllByText('لیست سیاه').length).toBeGreaterThan(0);
    expect(screen.getByText(/گرید کسب‌شده/)).toBeTruthy();
  });

  test('the category cell reports the state rather than the stored column', () => {
    // Disqualified by decision, still filed under its original register — the
    // case the raw `category` check printed as an ordinary foreign purchase.
    show(vendor({ status: 'rejected', category: 'foreign' }));
    expect(screen.queryByText('خرید خارجی')).toBeNull();
  });
});
