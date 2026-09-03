import assert from 'node:assert/strict';
import test from 'node:test';
import { formatGroupDate } from '../src/components/views/MaterialsComparisonSection';

/**
 * The "last recorded evaluation" line under the material comparison.
 *
 * Activity-log dates are written by several code paths and arrive in three
 * shapes. The panel used to print the raw winner of a string sort, so a Jalali
 * date that had been serialised into ISO punctuation reached the screen as
 * `1405-06-12T09:54:00.000Z`.
 */

test('a Jalali date already written in Persian is printed as it stands', () => {
  assert.equal(formatGroupDate('۱۴۰۵/۰۶/۱۲'), '۱۴۰۵/۰۶/۱۲');
  assert.equal(formatGroupDate('1405/06/12'), '1405/06/12');
});

test('a Jalali date wearing ISO punctuation keeps its numbers', () => {
  // Converting it would read 1405 as a Gregorian year and answer ۷۸۴ — a date
  // six centuries off, printed with full confidence.
  assert.equal(formatGroupDate('1405-06-12T09:54:00.000Z'), '1405/06/12');
  assert.equal(formatGroupDate('1404-12-29'), '1404/12/29');
});

test('a real Gregorian instant is converted, not printed raw', () => {
  const out = formatGroupDate('2026-09-03T10:00:00.000Z');
  assert.ok(out && !out.includes('T'), 'no timestamp reaches the screen');
  assert.ok(out && /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(out.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))),
    'and it comes back as a plain date');
});

test('nothing recorded stays nothing', () => {
  assert.equal(formatGroupDate(null), null);
});
