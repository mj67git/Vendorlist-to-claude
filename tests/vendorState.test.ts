import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVendorRejected, isInBlacklistCategory, applyDerivedState, hasQcReject, adminRejectionReason, ADMIN_REJECT_PREFIX, latestScoreEvaluationLog, SCORE_EVALUATION_PREFIX } from '../src/utils/vendorState';

const sample = (over: any = {}) => ({
  id: 'S1', isSample: true, category: 'sample',
  status: 'approved', grade: 'A',
  analysisRecords: [], rejectionReasons: null, scores: null, ...over,
});
const source = (over: any = {}) => ({
  id: 'V1', isSample: false, category: 'foreign',
  status: 'approved', grade: 'B',
  analysisRecords: [], rejectionReasons: null, scores: null, ...over,
});
const reject = (qc = 'QC-1') => ({ id: 'r-' + qc, qcCode: qc, decision: 'Reject', date: '1404/01/01' });
const pass = (qc = 'QC-2') => ({ id: 'r-' + qc, qcCode: qc, decision: 'Pass', date: '1404/01/01' });

test('a Reject result no longer blacklists a sample on its own', () => {
  // The lab record is evidence. The verdict is a decision somebody records,
  // exactly as it already worked for sources.
  const v = applyDerivedState(sample({ analysisRecords: [reject()] }));
  assert.equal(isVendorRejected(v), false);
  assert.equal(hasQcReject(v), true, 'the evidence itself is still readable');
  assert.notEqual(v.status, 'rejected');
});

test('a sample with no recorded verdict is «آزمایش نشده», not approved', () => {
  const v = applyDerivedState(sample({ status: 'new', initialSampleStatus: undefined }));
  assert.equal(v.status, 'new');
  assert.equal(isVendorRejected(v), false);
});

test('a recorded rejection of a sample takes effect and can be reversed', () => {
  let v: any = applyDerivedState(sample({
    status: 'rejected',
    rejectionReasons: ['رد توسط مدیر کیفیت بر اساس نتایج آزمایشگاهی — ناخالصی'],
    analysisRecords: [reject()],
  }));
  assert.equal(isVendorRejected(v), true);

  // The decision box records an approval instead; the old reason goes with it.
  v = applyDerivedState({ ...v, status: 'approved', rejectionReasons: null });
  assert.equal(isVendorRejected(v), false);
  assert.equal(v.status, 'approved');
  assert.notEqual(v.grade, 'rejected');
});

test('deleting a lab result does not quietly clear a recorded rejection', () => {
  // A sample rejected under the old automatic rule keeps its verdict: the
  // stored status is what says so, not the record that triggered it.
  let v: any = applyDerivedState(sample({ status: 'rejected', analysisRecords: [reject()] }));
  assert.equal(isVendorRejected(v), true, 'precondition: rejected');

  v = applyDerivedState({ ...v, analysisRecords: [] });
  assert.equal(isVendorRejected(v), true, 'only a recorded decision reverses a verdict');
});

test('a Pass result never blacklists a sample', () => {
  const v = applyDerivedState(sample({ analysisRecords: [pass()] }));
  assert.equal(isVendorRejected(v), false);
});

test('an explicit rejection reason still blacklists a sample without any lab record', () => {
  const v = applyDerivedState(sample({ rejectionReasons: ['رد توسط مدیر کیفیت — تصمیم دستی'] }));
  assert.equal(isVendorRejected(v), true);
});

test('a stored rejected status is the verdict and is not derived away', () => {
  // Whether it was written by the decision box or by the old automatic rule,
  // the only thing that reverses it is another recorded decision.
  const v = applyDerivedState(sample({ status: 'rejected', rejectionReasons: null }));
  assert.equal(isVendorRejected(v), true);
  assert.equal(v.status, 'rejected');
});

test('a sample created today carries no verdict at all', () => {
  // The form no longer asks for one, so nothing may invent «تأیید شده».
  const v = applyDerivedState(sample({ status: 'new', grade: null, initialSampleStatus: undefined }));
  assert.equal(v.status, 'new');
  assert.equal(isVendorRejected(v), false);
});

test('a source is NOT auto-blacklisted by a failing lab result', () => {
  const v = applyDerivedState(source({ analysisRecords: [reject()] }));
  assert.equal(isVendorRejected(v), false, 'sources need an explicit admin decision');
  assert.equal(hasQcReject(v), true);
});

test('an admin rejection of a source, and its restore, both take effect', () => {
  let v: any = applyDerivedState(source({ status: 'rejected', rejectionReasons: ['رد توسط ادمین — دلیل'] }));
  assert.equal(isVendorRejected(v), true);
  assert.equal(v.grade, 'rejected');

  v = applyDerivedState({ ...v, status: 'approved', rejectionReasons: null });
  assert.equal(isVendorRejected(v), false);
  assert.notEqual(v.grade, 'rejected', 'restore must clear the grade latch too');
});

test('grade never resurrects a cleared status (the old one-way latch)', () => {
  // A record that still carries the stale stamp from before the fix.
  const stale = source({ status: 'approved', grade: 'rejected', rejectionReasons: null });
  const v = applyDerivedState(stale);
  assert.equal(isVendorRejected(v), false);
  assert.notEqual(v.status, 'rejected', 'stale grade must not drag status back');
});

test('applying the derivation twice changes nothing (idempotent)', () => {
  for (const base of [sample({ status: 'rejected', analysisRecords: [reject()] }), source({ scores: { commercial: 90, qa: 90, planning: 90, finance: 90 } }), sample()]) {
    const once = applyDerivedState(base);
    const twice = applyDerivedState(once);
    assert.deepEqual(twice, once);
  }
});

test('scored sources still get their score-derived grade', () => {
  const v = applyDerivedState(source({ scores: { commercial: 90, qa: 90, planning: 90, finance: 90 } }));
  assert.equal(v.grade, 'A');
  assert.equal(v.status, 'approved');
});

test('blacklist category excludes samples', () => {
  const s = applyDerivedState(sample({ analysisRecords: [reject()] }));
  const v = applyDerivedState(source({ status: 'rejected', rejectionReasons: ['رد توسط ادمین'] }));
  assert.equal(isInBlacklistCategory(s), false, 'samples live in their own list');
  assert.equal(isInBlacklistCategory(v), true);
});

test('a QC-derived reason alone never blacklists a sample', () => {
  // Reasons written from a laboratory record are a projection of that record,
  // not a decision. Without a recorded verdict in `status` they hold nothing.
  const v = applyDerivedState({
    id: 'S1', isSample: true, category: 'sample',
    status: 'new', grade: null,
    analysisRecords: [],
    rejectionReasons: ['مردود در آزمون QC [کد: QC-1 | تاریخ: 1404/01/01]'],
    scores: null,
  });
  assert.equal(isVendorRejected(v), false);
  assert.notEqual(v.grade, 'rejected');
});

test('a manual admin reason still keeps a sample blacklisted', () => {
  const v = applyDerivedState({
    id: 'S1', isSample: true, category: 'sample',
    status: 'rejected', grade: 'rejected',
    analysisRecords: [], rejectionReasons: ['رد توسط مدیر کیفیت — تصمیم دستی'], scores: null,
  });
  assert.equal(isVendorRejected(v), true);
});

test('the recorded rejection decision is readable back, so the box can show it', () => {
  const line = `${ADMIN_REJECT_PREFIX} مدیر کیفیت بر اساس نتایج آزمایشگاهی — ناخالصی بالاتر از حد فارماکوپه`;
  const v = source({ status: 'rejected', rejectionReasons: ['مردود در آزمون QC (QC-9)', line] });
  assert.equal(adminRejectionReason(v), line);
});

test('a blacklisting that came only from lab results has no decision line to show', () => {
  const v = source({ status: 'rejected', rejectionReasons: ['مردود در آزمون QC (QC-9)'] });
  assert.equal(adminRejectionReason(v), null);
  assert.equal(adminRejectionReason(source()), null);
});

test('a score-driven blacklisting has no stated reason, only a scoring entry', () => {
  // The banner has to say something on this path: the derivation puts the
  // source on the blacklist and nobody types a sentence, so an empty reason
  // list is the normal case rather than a data fault.
  const v = applyDerivedState(source({
    scores: { commercial: 20, qa: 20, planning: 20, finance: 20 },
    activityLogs: [
      { id: 'l1', action: 'ویرایش اطلاعات', date: '۱۴۰۵/۰۶/۱۰', user: 'کاربر الف' },
      { id: 'l2', action: `${SCORE_EVALUATION_PREFIX} "پاراستامول" — گرید نهایی: [Grade rejected]`, date: '۱۴۰۵/۰۶/۱۶', user: 'کارشناس کیفیت' },
    ],
  }));
  assert.equal(isVendorRejected(v), true);
  assert.equal((v.rejectionReasons || []).length, 0, 'nothing was written by hand');

  const log = latestScoreEvaluationLog(v);
  assert.equal(log?.user, 'کارشناس کیفیت');
  assert.equal(log?.date, '۱۴۰۵/۰۶/۱۶');
});

test('a source with no scoring entry reports none rather than the wrong one', () => {
  const v = source({ activityLogs: [{ id: 'l1', action: 'ویرایش اطلاعات', date: 'x', user: 'y' }] });
  assert.equal(latestScoreEvaluationLog(v), null);
  assert.equal(latestScoreEvaluationLog(source()), null);
});
