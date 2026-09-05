import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeVendorRank } from '../src/utils/vendorRank';
import { applyDerivedState } from '../src/utils/vendorState';

const scored = (over: any = {}) => ({
  id: 'V1', isSample: false, category: 'foreign',
  status: 'approved', grade: 'B',
  scores: { commercial: 70, qa: 70, planning: 70, finance: 70 },
  analysisRecords: [], rejectionReasons: null, ...over,
});

test('a rejected source still reports the rank it earned', () => {
  // The reject stamps `grade: 'rejected'`, so the stored column can no longer
  // answer «رتبه نهایی» — the scores can.
  const v = applyDerivedState(scored({ rejectionReasons: ['رد توسط مدیر کیفیت — تصمیم دستی'] }));
  assert.equal(v.grade, 'rejected');
  const rank = describeVendorRank(v);
  assert.equal(rank.evaluated, true);
  assert.equal(rank.grade, 'B');
});

test('a rejected source that was never scored reports no rank rather than a made-up one', () => {
  const v = applyDerivedState(scored({
    scores: { commercial: 0, qa: 0, planning: 0, finance: 0 },
    rejectionReasons: ['رد توسط مدیر کیفیت — تصمیم دستی'],
  }));
  assert.equal(describeVendorRank(v).evaluated, false);
});
