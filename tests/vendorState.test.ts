import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInCategoryRegister, isVendorRejected, isInBlacklistCategory, applyDerivedState, hasQcReject, adminRejectionReason, ADMIN_REJECT_PREFIX, latestScoreEvaluationLog, SCORE_EVALUATION_PREFIX, describeRejection } from '../src/utils/vendorState';

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

test('a sample filed under an ordinary category belongs to one register, not two', () => {
  /*
   * The flag and the category can disagree — `isSampleVendor` exists precisely
   * because they do — and a record carrying `isSample` while still filed under
   * «خارجی» was counted in the foreign register *and* the sample register at
   * once: on the category page, in the sidebar badge and in the spreadsheet.
   * A sample is a stage, not a category, and it has a register of its own.
   */
  const stray: any = { id: 'V1', category: 'foreign', isSample: true, status: 'new', grade: '' };

  assert.equal(isInCategoryRegister(stray, 'foreign'), false);
  assert.equal(isInCategoryRegister(stray, 'sample'), true);

  const ordinary: any = { id: 'V2', category: 'foreign', isSample: false, status: 'new', grade: '' };
  assert.equal(isInCategoryRegister(ordinary, 'foreign'), true);
  assert.equal(isInCategoryRegister(ordinary, 'sample'), false);
});

test('the reason a record is blacklisted is named, and never invented', () => {
  /*
   * Four roads reach this state and a signed document must say which. The
   * printed form said only «لیست سیاه»; the source page worked it out inline
   * and nobody else could read that. This is the shared determination.
   */

  // Nothing is on the blacklist until it is.
  assert.equal(describeRejection(source()), null);

  // An explicit decision outranks everything else, including a low score.
  const decided = source({
    status: 'rejected',
    rejectionReasons: [`${ADMIN_REJECT_PREFIX} مدیر سیستم: تخلف در مدارک`],
    scores: { commercial: 10, qa: 10, planning: 10, finance: 10 },
  });
  const byAdmin = describeRejection(decided)!;
  assert.equal(byAdmin.cause, 'admin');
  assert.match(byAdmin.reasons[0], /تخلف در مدارک/);

  // A laboratory Reject, with no sentence written anywhere.
  const lab = describeRejection(source({ status: 'rejected', analysisRecords: [reject()] }))!;
  assert.equal(lab.cause, 'lab');

  // The floor: no text, a weighted total below 40, and the scoring log names
  // who recorded it.
  const low = describeRejection(source({
    status: 'rejected',
    scores: { commercial: 20, qa: 20, planning: 20, finance: 20 },
    activityLogs: [{ action: `${SCORE_EVALUATION_PREFIX}: ثبت`, user: 'کارشناس کیفیت', date: '1405-06-06T09:56:00.000Z' }],
  }))!;
  assert.equal(low.cause, 'score');
  assert.ok(low.score !== undefined && low.score < 40);
  assert.equal(low.by, 'کارشناس کیفیت');

  // A rejection nothing accounts for says so. Claiming the score put it there
  // would be arithmetically false — the total is 70 — on the one panel whose
  // job is to explain the decision.
  const unexplained = describeRejection(source({
    status: 'rejected',
    scores: { commercial: 70, qa: 70, planning: 70, finance: 70 },
  }))!;
  assert.equal(unexplained.cause, 'unknown');
  assert.deepEqual(unexplained.reasons, []);
  assert.equal(unexplained.score, undefined);

  // A sample carries the laboratory's recorded verdict, with its own reason.
  const ruled = describeRejection(sample({
    status: 'rejected',
    activityLogs: [{ action: 'تصمیم کیفی نمونه: خارج از مشخصات', user: 'مدیر کیفیت', date: '1405-06-07T08:00:00.000Z' }],
  }))!;
  assert.equal(ruled.cause, 'sample-decision');
  assert.equal(ruled.reasons[0], 'خارج از مشخصات');
  assert.equal(ruled.by, 'مدیر کیفیت');
});

/**
 * A source disqualified by its score can be qualified again by a better one.
 *
 * `applyDerivedState` writes `status: 'rejected'` when the weighted score falls
 * below 40, and `isVendorRejected` reads that same column back as a verdict. So
 * the second call sees the stamp the first one left, returns true before
 * reaching the scoring branch, and re-stamps the record. The scores can never
 * lift it out again.
 *
 * Two records with identical scores then sit in opposite states, decided
 * entirely by their history. This is the one-way latch the project believed it
 * had already removed for `grade` — it survived through `status`.
 *
 * Note what is NOT being claimed here: a rejection somebody *recorded* must
 * still hold, and the tests above hold it to that. Only a rejection that the
 * arithmetic produced may be undone by better arithmetic.
 */
test('a score-driven rejection is reversed by a better score', () => {
  const rejected = applyDerivedState(source({
    scores: { commercial: 20, qa: 20, planning: 20, finance: 20 },
  }));
  assert.equal(isVendorRejected(rejected), true, 'below the floor, the source is out');
  assert.equal(rejected.status, 'rejected');

  // The departments correct their entries. Same record, better numbers.
  const rescored = applyDerivedState({
    ...rejected,
    scores: { commercial: 90, qa: 90, planning: 90, finance: 90 },
  });

  assert.equal(
    isVendorRejected(rescored), false,
    'a rejection the score produced must be undone when the score changes',
  );
  assert.equal(rescored.grade, 'A');
  assert.equal(rescored.status, 'approved');
});

test('two sources with the same scores reach the same verdict', () => {
  // The clearest statement of the defect: history must not decide this.
  const viaRejection = applyDerivedState(applyDerivedState(source({
    scores: { commercial: 20, qa: 20, planning: 20, finance: 20 },
  })));
  const rescored = applyDerivedState({
    ...viaRejection,
    scores: { commercial: 85, qa: 85, planning: 85, finance: 85 },
  });
  const fresh = applyDerivedState(source({
    scores: { commercial: 85, qa: 85, planning: 85, finance: 85 },
  }));

  assert.equal(rescored.grade, fresh.grade);
  assert.equal(rescored.status, fresh.status);
  assert.equal(isVendorRejected(rescored), isVendorRejected(fresh));
});
