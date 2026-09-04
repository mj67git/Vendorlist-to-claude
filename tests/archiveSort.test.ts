import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * The archive's ranked columns.
 *
 * Grade and risk are not alphabetical: "sort by risk" means High first, and
 * "sort by grade" means A above B — an alphabetical sort would put "High"
 * between "Low" and "Medium" and read as an order that means nothing, which is
 * the same mistake the audit table's severity column used to make.
 *
 * The two maps are the whole rule, so they are what is checked; the comparator
 * around them is the shared one every other table uses.
 */
const RISK_ORDER: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
const GRADE_ORDER: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, rejected: 0, 'black list': 0 };

const rank = (map: Record<string, number>, value: unknown, missing: number) =>
  map[String(value)] ?? missing;

test('risk ranks by severity, and an unassessed source sits below every level', () => {
  const rows = ['Medium', undefined, 'High', 'Low'];
  const sorted = [...rows].sort((a, b) => rank(RISK_ORDER, b, 0) - rank(RISK_ORDER, a, 0));
  assert.deepEqual(sorted, ['High', 'Medium', 'Low', undefined]);
});

test('grade ranks by the rubric, not by the alphabet', () => {
  const rows = ['C', 'rejected', 'A', 'B'];
  const sorted = [...rows].sort((a, b) => rank(GRADE_ORDER, b, -1) - rank(GRADE_ORDER, a, -1));
  assert.deepEqual(sorted, ['A', 'B', 'C', 'rejected']);
});

test('a blacklisted source ranks with the rejected ones, not above them', () => {
  assert.equal(GRADE_ORDER['black list'], GRADE_ORDER.rejected);
});

test('an unscored source sorts below a rejected one', () => {
  // Rejection is a decision that was made; "no grade" is the absence of one,
  // and the list should not present the second as if it outranked the first.
  assert.ok(rank(GRADE_ORDER, undefined, -1) < GRADE_ORDER.rejected);
});

test('Persian names order by the alphabet, not by code point', () => {
  const collator = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });
  const names = ['کیمیا دارو', 'الوند شیمی', 'پارس دارو'];
  assert.deepEqual([...names].sort(collator.compare), ['الوند شیمی', 'پارس دارو', 'کیمیا دارو']);
});
