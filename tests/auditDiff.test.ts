import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeFieldDiff, computeFieldDiffDetailed, hasRecordedValue,
} from '../src/components/AuditTrailView';

/**
 * What the audit detail panel says changed.
 *
 * The panel is read by people who did not write the schema. It used to print
 * the field names the server happens to use and to compare collections by
 * length, so a saved lab result appeared as two rows — `activityLogs ۶ → ۷
 * مورد` and `activityLogCount ۶ → ۷` — that together said only "there is one
 * more of something".
 */

test('a record added to a collection is named, not counted', () => {
  const before = { activityLogs: [{ id: 'a1', action: 'ثبت سورس', date: '۱۴۰۵/۰۶/۰۱' }] };
  const after = {
    activityLogs: [
      { id: 'a1', action: 'ثبت سورس', date: '۱۴۰۵/۰۶/۰۱' },
      { id: 'a2', action: 'ثبت نتیجهٔ آزمون', date: '۱۴۰۵/۰۶/۱۱' },
    ],
  };

  const rows = computeFieldDiff(before, after);
  assert.equal(rows.length, 1, 'one collection, one row');
  assert.equal(rows[0].label, 'سابقهٔ فعالیت');
  assert.equal(rows[0].kind, 'added');
  assert.match(rows[0].note || '', /افزوده/);
  assert.match(rows[0].to, /ثبت نتیجهٔ آزمون/, 'the row says what arrived');
  assert.doesNotMatch(rows[0].to, /مورد$/, 'and not how many there now are');
});

test('a removed record is named too, on the side it left from', () => {
  const before = { analysisRecords: [{ id: 'r1', qcCode: 'QC-4471', decision: 'تأیید' }] };
  const after = { analysisRecords: [] };

  const [row] = computeFieldDiff(before, after);
  assert.equal(row.label, 'نتایج آزمایشگاهی');
  assert.equal(row.kind, 'removed');
  assert.match(row.from, /QC-4471/);
  assert.equal(row.to, '', 'a collection row has one side, not an empty arrow');
});

test('the derived count beside a collection is not a change of its own', () => {
  const before = { activityLogs: [{ id: 'a1' }], activityLogCount: 1 };
  const after = { activityLogs: [{ id: 'a1' }, { id: 'a2' }], activityLogCount: 2 };

  const rows = computeFieldDiff(before, after);
  assert.equal(rows.length, 1);
  assert.ok(!rows.some(r => r.key.includes('activityLogCount')), 'the counter repeats the row above it');
});

test('a collection that only reordered reports nothing', () => {
  const one = { id: 'a1', action: 'ثبت' };
  const two = { id: 'a2', action: 'ویرایش' };
  assert.deepEqual(computeFieldDiff({ activityLogs: [one, two] }, { activityLogs: [two, one] }), []);
});

test('a field nobody has named is counted, not printed', () => {
  const { rows, hidden } = computeFieldDiffDetailed(
    { country: 'India', internalRevisionToken: 'x1' },
    { country: 'Turkey', internalRevisionToken: 'x2' },
  );

  assert.deepEqual(rows.map(r => r.label), ['کشور'], 'only what a person can read');
  assert.equal(hidden, 1, 'and the rest is reported as a number, so nothing vanishes silently');
});

test('an ordinary field still shows both sides', () => {
  const [row] = computeFieldDiff({ grade: 'B' }, { grade: 'A' });
  assert.equal(row.label, 'گرید');
  assert.equal(row.from, 'B');
  assert.equal(row.to, 'A');
  assert.equal(row.kind, 'changed');
  assert.equal(row.note, undefined, 'a scalar row has no collection note');
});

test('the event metadata is still kept out of the change list', () => {
  const rows = computeFieldDiff(
    { ipAddress: '10.0.0.1', userAgent: 'Firefox' },
    { ipAddress: '10.0.0.9', userAgent: 'Chrome' },
  );
  assert.deepEqual(rows, []);
});

test('a placeholder dash is not a recorded value', () => {
  assert.equal(hasRecordedValue('10.0.0.4'), true);
  assert.equal(hasRecordedValue('—'), false, 'this is what an old record shows for a column it never had');
  assert.equal(hasRecordedValue(''), false);
  assert.equal(hasRecordedValue(null), false);
  assert.equal(hasRecordedValue(undefined), false);
});

test('a permission is named the way the access dialog names it', () => {
  const [row] = computeFieldDiff(
    { permissions: ['vendor.read'] },
    { permissions: ['vendor.read', 'score.finance'] },
  );
  assert.equal(row.label, 'دسترسی‌ها');
  assert.equal(row.to, 'امتیازدهی مالی و حسابداری', 'not the stored name `score.finance`');
});
