import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLogTimestamp, jalaliIsoParts, toJalaliDisplay } from '../src/utils/dateDisplay';

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

/**
 * Activity-log stamps.
 *
 * The blacklist banner and the sample-decision box print who filed a decision
 * and when. The stored value arrives as `1405-06-06T09:56:00.000Z`, which was
 * being shown to the reader exactly like that.
 */
test('a log stamp whose ISO year is really Jalali keeps its own numbers', () => {
  // Converting would read 1405 as Gregorian and answer a date six centuries
  // earlier, so the parts are read literally.
  assert.equal(formatLogTimestamp('1405-06-06T09:56:00.000Z'), '۱۴۰۵/۰۶/۰۶ · ۰۹:۵۶');
  assert.equal(formatLogTimestamp('1405-06-06'), '۱۴۰۵/۰۶/۰۶');
});

test('a genuine Gregorian stamp is converted to the calendar in use', () => {
  const shown = formatLogTimestamp('2026-09-08T09:56:00.000Z') || '';
  assert.ok(shown.startsWith('۱۴۰۵'), `expected a Jalali year, got ${shown}`);
});

test('a stamp already written in Persian, and an empty one', () => {
  assert.equal(formatLogTimestamp('۱۴۰۵/۰۶/۰۶، ۰۹:۵۶'), '۱۴۰۵/۰۶/۰۶، ۰۹:۵۶');
  assert.equal(formatLogTimestamp(''), null);
  assert.equal(formatLogTimestamp(null), null);
});

test('the Jalali-in-ISO rule answers only for a Jalali year', () => {
  assert.deepEqual(jalaliIsoParts('1405-06-06T09:56:00.000Z'),
    { y: '1405', m: '06', d: '06', hh: '09', mm: '56' });
  assert.equal(jalaliIsoParts('2026-09-08T09:56:00.000Z'), null);
  assert.equal(jalaliIsoParts('۱۴۰۵/۰۶/۰۶'), null);
});
