import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALCULATION_WEIGHTS,
  GRADE_TIERS,
  calculateRoundedWeightedScore,
  calculateWeightedScore,
  rankVendor,
} from '../src/server/domain/vendorEvaluation';

function legacyWeightedScore(scores: Record<string, number | null | undefined>): number {
  return (
    ((scores.commercial || 0) * 0.2) +
    ((scores.qa || 0) * 0.4) +
    ((scores.planning || 0) * 0.1) +
    ((scores.finance || 0) * 0.3)
  );
}

test('centralized evaluation configuration preserves legacy values and ordering', () => {
  assert.deepEqual(CALCULATION_WEIGHTS, {
    commercial: 0.2,
    qa: 0.4,
    planning: 0.1,
    finance: 0.3,
  });
  assert.deepEqual(GRADE_TIERS, [
    { min: 80, grade: 'A', status: 'approved' },
    { min: 60, grade: 'B', status: 'approved' },
    { min: 40, grade: 'C', status: 'conditional' },
    { min: 0, grade: 'black list', status: 'rejected' },
  ]);
});

test('weighted score matches the legacy arithmetic for representative inputs', () => {
  const cases = [
    { commercial: 100, qa: 100, planning: 100, finance: 100 },
    { commercial: 72, qa: 81, planning: 63, finance: 94 },
    { commercial: 0, qa: 75, planning: 0, finance: 55 },
    { commercial: -1, qa: 0, planning: 40, finance: 20 },
    { commercial: undefined, qa: null, planning: 25, finance: 50 },
  ];

  for (const scores of cases) {
    const expected = legacyWeightedScore(scores);
    assert.equal(calculateWeightedScore(scores), expected);
    assert.equal(calculateRoundedWeightedScore(scores), Math.round(expected));
  }
});

test('ranking preserves sample partitioning, score rounding, and stable tie behavior', () => {
  const vendors = [
    { id: 'regular-a', scores: { commercial: 100, qa: 100, planning: 100, finance: 100 } },
    { id: 'regular-b', scores: { commercial: 80, qa: 80, planning: 80, finance: 80 } },
    { id: 'regular-c', scores: { commercial: 80, qa: 80, planning: 80, finance: 80 } },
    { id: 'sample-a', isSample: true, scores: { commercial: 10, qa: 10, planning: 10, finance: 10 } },
    { id: 'sample-b', category: 'sample', scores: { commercial: 90, qa: 90, planning: 90, finance: 90 } },
  ];

  assert.equal(rankVendor('regular-a', vendors), 1);
  assert.equal(rankVendor('regular-b', vendors), 2);
  assert.equal(rankVendor('regular-c', vendors), 3);
  assert.equal(rankVendor('sample-b', vendors), 1);
  assert.equal(rankVendor('sample-a', vendors), 2);
  assert.equal(rankVendor('missing', vendors), 0);
});
