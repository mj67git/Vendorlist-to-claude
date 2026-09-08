import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJalaliDisplay } from '../src/utils/dateDisplay';

test('a Gregorian ISO date stored on a record is shown in Jalali', () => {
  // The server used to stamp this shape when a record was saved without a
  // registration date, so it sits in the database next to Jalali values.
  const shown = toJalaliDisplay('2026-09-08');
  assert.ok(/[۰-۹]/.test(shown), `expected Persian digits, got ${shown}`);
  assert.ok(shown.startsWith('۱۴۰۵'), `expected a Jalali year, got ${shown}`);
});

test('a date already written in Persian is left exactly as it was typed', () => {
  // Re-parsing what somebody typed risks changing what they meant.
  assert.equal(toJalaliDisplay('۱۴۰۵/۰۶/۱۷'), '۱۴۰۵/۰۶/۱۷');
  assert.equal(toJalaliDisplay('1403/05/12'), '1403/05/12');
});

test('an empty or unparseable value says so rather than inventing a date', () => {
  assert.equal(toJalaliDisplay(''), 'ثبت‌نشده');
  assert.equal(toJalaliDisplay(null), 'ثبت‌نشده');
  assert.equal(toJalaliDisplay(undefined, 'ثبت نشده'), 'ثبت نشده');
  assert.equal(toJalaliDisplay('نامشخص'), 'نامشخص');
});
