import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSampleStatus, isSampleRecord, isUntestedSample } from '../src/utils/sampleStatus';
import { describeVendorGrade } from '../src/components/GradeBadge';

/**
 * What a badge is allowed to say about a record.
 *
 * Both of these fix the same mistake, found on the source page: a chain of
 * conditions whose last branch was a verdict rather than "nothing yet". A
 * sample registered a moment ago, with no laboratory record and no decision
 * behind it, was announced as «مردود» on its own page, because everything that
 * was not approved or conditional fell through to rejected. The rule these
 * tests hold the code to is that a screen never states a verdict nobody gave.
 */

const freshSample = { isSample: true, category: 'sample', status: 'new', analysisRecords: [] };

test('a sample nobody has ruled on is untested, in both the short and the long form', () => {
  const verdict = describeSampleStatus(freshSample);
  assert.equal(verdict.decided, false);
  assert.equal(verdict.label, 'آزمایش نشده');
  assert.match(verdict.title, /آزمایش نشده/);
  assert.ok(!verdict.title.includes('مردود'), 'and it is emphatically not a rejection');
  assert.equal(isUntestedSample(freshSample), true);
});

test('a failing laboratory result is evidence, not the verdict', () => {
  // Rule 11: one Reject record no longer blacklists a sample on its own — a
  // person decides, with a reason. The badge has to agree with that.
  const tested = {
    ...freshSample,
    analysisRecords: [{ id: 'AR1', qcCode: 'QC-1', decision: 'Reject' }],
  };
  assert.equal(describeSampleStatus(tested).decided, false);
  assert.match(describeSampleStatus(tested).title, /آزمایش نشده/);
});

test('each recorded verdict gets its own sentence', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...freshSample, status: 'approved' }, /تایید شده/],
    [{ ...freshSample, status: 'conditional' }, /تایید مشروط/],
    [{ ...freshSample, status: 'rejected' }, /مردود/],
  ];
  for (const [vendor, expected] of cases) {
    const verdict = describeSampleStatus(vendor);
    assert.equal(verdict.decided, true, `${vendor.status} is a decision`);
    assert.match(verdict.title, expected);
  }
});

test('every state has a full sentence, so no caller has to invent one', () => {
  for (const status of ['new', '', 'approved', 'conditional', 'rejected', 'something-else']) {
    const verdict = describeSampleStatus({ ...freshSample, status });
    assert.ok(verdict.title.trim().length > 0, `«${status}» → عنوان خالی`);
    assert.ok(verdict.title.startsWith('نمونه:'), `«${status}» → ${verdict.title}`);
  }
});

test('a record counts as a sample by either the flag or the category', () => {
  // The two used to be read separately by different screens, so a row carrying
  // one without the other was judged differently depending on where you stood.
  assert.equal(isSampleRecord({ isSample: true }), true);
  assert.equal(isSampleRecord({ category: 'sample' }), true);
  assert.equal(isSampleRecord({ isSample: false, category: 'foreign' }), false);
});

test('only A, B and C are grades; anything else means no grade yet', () => {
  // `applyDerivedState` writes the literal 'new' into `grade` when it clears a
  // stale rejected one. The badge read every non-A, non-B value as Grade C and
  // showed a scored verdict for a source nobody had scored.
  for (const grade of ['new', null, undefined, 'unknown']) {
    const verdict = describeVendorGrade(grade as never, 'new' as never, null);
    assert.equal(verdict.label, 'جدید', `grade «${grade}» must not read as a grade`);
  }
  assert.equal(describeVendorGrade('A' as never, 'approved' as never, null).label, 'Grade A');
  assert.equal(describeVendorGrade('C' as never, 'conditional' as never, null).label, 'Grade C');
});

test('a part-scored source says so, and a rejected one stays rejected', () => {
  const partly = describeVendorGrade('new' as never, 'new' as never, {
    commercial: 80, qa: 0, planning: 0, finance: 0,
  } as never);
  assert.equal(partly.label, 'در حال ارزیابی');

  const rejected = describeVendorGrade('new' as never, 'rejected' as never, null);
  assert.equal(rejected.label, 'لیست سیاه');
  assert.equal(rejected.variant, 'gradeReject');
});
