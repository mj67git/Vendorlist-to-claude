import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVendorRejected, isInBlacklistCategory, applyDerivedState, hasQcReject } from '../src/utils/vendorState';

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

test('a sample is blacklisted by a single Reject result', () => {
  const v = applyDerivedState(sample({ analysisRecords: [reject()] }));
  assert.equal(isVendorRejected(v), true);
  assert.equal(v.status, 'rejected');
  assert.equal(v.grade, 'rejected');
});

test('deleting the Reject result clears the blacklist everywhere (the reported bug)', () => {
  let v: any = applyDerivedState(sample({ analysisRecords: [reject()] }));
  assert.equal(isVendorRejected(v), true, 'precondition: rejected');

  // user deletes that lab result
  v = applyDerivedState({ ...v, analysisRecords: [], rejectionReasons: null });

  assert.equal(isVendorRejected(v), false, 'must no longer count as rejected');
  assert.notEqual(v.grade, 'rejected', 'grade must not stay latched at rejected');
  assert.notEqual(v.status, 'rejected');
});

test('a Pass result never blacklists a sample', () => {
  const v = applyDerivedState(sample({ analysisRecords: [pass()] }));
  assert.equal(isVendorRejected(v), false);
});

test('removing only one of two Reject results keeps the sample blacklisted', () => {
  let v: any = applyDerivedState(sample({ analysisRecords: [reject('A'), reject('B')] }));
  v = applyDerivedState({ ...v, analysisRecords: [reject('B')] });
  assert.equal(isVendorRejected(v), true);
});

test('a restored sample returns to conditional when it started conditional', () => {
  let v: any = applyDerivedState(sample({ initialSampleStatus: 'conditional', analysisRecords: [reject()] }));
  v = applyDerivedState({ ...v, analysisRecords: [], rejectionReasons: null });
  assert.equal(v.status, 'conditional');
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
  for (const base of [sample({ analysisRecords: [reject()] }), source({ scores: { commercial: 90, qa: 90, planning: 90, finance: 90 } }), sample()]) {
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

test('a stale QC reason left without its record does not keep a sample blacklisted', () => {
  // Self-healing: the record is gone (e.g. an older cached copy), so the
  // QC-derived reason must not hold the sample in the blacklist by itself.
  const v = applyDerivedState({
    id: 'S1', isSample: true, category: 'sample',
    status: 'rejected', grade: 'rejected',
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
