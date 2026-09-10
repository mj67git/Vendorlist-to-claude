import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeVendorRank, SOURCE_GRADE_RANGE_FA } from '../src/utils/vendorRank';
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

test('the Persian bands and the printed ones describe the same thresholds', () => {
  /*
   * Two maps of one rule drift. The Latin map feeds `VendorRank.range` on the
   * printed evaluation form, where the legend is bilingual; the Persian one is
   * for captions on screen, where a Latin numeral is the only one on the page.
   * Neither may quietly say a different number from the other, so the bands are
   * read back out of both and compared.
   */
  const digits = (s: string) => s.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .match(/\d+/g)?.join('-') ?? '';

  for (const grade of ['A', 'B', 'C', 'D'] as const) {
    const fa = digits(SOURCE_GRADE_RANGE_FA[grade]);
    // The Latin map is private, so it is read through the value it produces.
    const latin = digits(describeVendorRank({
      scores: null,
      grade,
    } as any).range);
    assert.equal(fa, latin, `band ${grade} disagrees between the two maps`);
  }
});
