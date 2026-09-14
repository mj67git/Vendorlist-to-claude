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

/**
 * The badge takes the record, not three loose fields.
 *
 * `describeVendorGrade` used to be handed `(grade, status, scores)` and decide
 * the verdict from a hand-written comparison — the pair rule 11 forbids. It now
 * asks `isVendorRejected`, so these cases pass the record they describe. The
 * records below carry no decision column, which is how an object older than
 * that column reads: the retired `status === 'rejected'` still answers for it.
 */
const record = (grade: unknown, status: unknown, scores: unknown = null) =>
  ({ isSample: false, category: 'foreign', grade, status, scores }) as never;

test('only A, B and C are grades; anything else means no grade yet', () => {
  // `applyDerivedState` writes the literal 'new' into `grade` when it clears a
  // stale rejected one. The badge read every non-A, non-B value as Grade C and
  // showed a scored verdict for a source nobody had scored.
  for (const grade of ['new', null, undefined, 'unknown']) {
    const verdict = describeVendorGrade(record(grade, 'new'));
    assert.equal(verdict.label, 'ارزیابی‌نشده', `grade «${grade}» must not read as a grade`);
    assert.equal(verdict.variant, 'stage', 'no grade yet is a process step, not a verdict');
  }
  assert.equal(describeVendorGrade(record('A', 'approved')).label, 'گرید A');
  assert.equal(describeVendorGrade(record('C', 'conditional')).label, 'گرید C');
});

/**
 * A grade is a judgement; «not evaluated» is the absence of one.
 *
 * They used to share colours: blue carried both «Grade B» and «جدید», amber
 * both «Grade C» and «در حال ارزیابی». In the one column a quality reviewer
 * scans to decide whether a source may be bought from, an unassessed record
 * looked exactly like a passing one.
 */
test('a process step never borrows a grade colour', () => {
  const stages = [
    describeVendorGrade(record('new', 'new')),
    describeVendorGrade(record('new', 'new', { commercial: 80, qa: 0, planning: 0, finance: 0 })),
  ];
  for (const stage of stages) {
    assert.equal(stage.variant, 'stage');
    assert.equal(stage.dotColor, null, 'a step carries no colour of its own');
  }
  const grades = ['A', 'B', 'C'].map(g => describeVendorGrade(record(g, 'approved')));
  for (const grade of grades) {
    assert.ok(grade.dotColor, 'a grade is a judgement and keeps its colour');
    assert.notEqual(grade.variant, 'stage');
  }
});

test('a part-scored source says so, and a rejected one stays rejected', () => {
  const partly = describeVendorGrade(record('new', 'new', { commercial: 80, qa: 0, planning: 0, finance: 0 }));
  assert.equal(partly.label, 'در حال ارزیابی');
  assert.equal(partly.variant, 'stage');

  const rejected = describeVendorGrade(record('new', 'rejected'));
  assert.equal(rejected.label, 'لیست سیاه');
  assert.equal(rejected.variant, 'gradeReject');
});
