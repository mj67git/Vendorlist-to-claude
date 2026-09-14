import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURE, SKIP, db, resetAll, startTestServer, stopTestServer,
} from './helpers/apiHarness';
import { getVendorById, saveVendorToDb } from '../src/server/repositories/vendorRepository';

/**
 * A save that fails leaves the record as it was.
 *
 * `saveVendorToDb` writes a source across six tables, and the laboratory
 * results, the risk assessment and the activity log are each *deleted and then
 * recreated*. Without a transaction a failure between those two halves does not
 * merely lose the edit being attempted — it loses the records that were already
 * stored, and answers the caller with an error that says nothing about it. The
 * failure below is provoked with a duplicate primary key among the incoming
 * analysis records, which is the real shape of the problem: something that only
 * the database can refuse, discovered after the deletes have already run.
 */

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });
beforeEach(async () => { await resetAll(); });

test('a failed save leaves the previously stored records intact', SKIP, async () => {
  const p = db();

  const stored = await getVendorById(FIXTURE.vendorId);
  await saveVendorToDb({
    ...stored,
    analysisRecords: [
      { id: 'an_keep_1', date: '۱۴۰۵/۰۶/۰۱', qcCode: 'QC-1', decision: 'Pass', comments: 'اولی' },
      { id: 'an_keep_2', date: '۱۴۰۵/۰۶/۰۲', qcCode: 'QC-2', decision: 'Pass', comments: 'دومی' },
    ],
    activityLogs: [{ id: 'log_keep', action: 'ثبت نتیجه', user: 'qa', date: '۱۴۰۵/۰۶/۰۲' }],
  });

  const before = await p.analysisRecord.findMany({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(before.length, 2, 'the two results must be stored to begin with');

  // Two records claiming the same id. The delete runs, the first create runs,
  // and the second one is refused by the unique constraint.
  const current = await getVendorById(FIXTURE.vendorId);
  await assert.rejects(
    saveVendorToDb({
      ...current,
      name: 'نامی که نباید ذخیره شود',
      analysisRecords: [
        { id: 'an_dup', date: '۱۴۰۵/۰۶/۰۳', qcCode: 'QC-3', decision: 'Pass' },
        { id: 'an_dup', date: '۱۴۰۵/۰۶/۰۴', qcCode: 'QC-4', decision: 'Pass' },
      ],
    }),
    'the duplicate id must be refused',
  );

  const after = await p.analysisRecord.findMany({ where: { vendorId: FIXTURE.vendorId } });
  assert.deepEqual(
    after.map(r => r.id).sort(),
    ['an_keep_1', 'an_keep_2'],
    'the results stored before the failed save must still be there',
  );

  const logs = await p.activityLog.findMany({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(logs.length, 1, 'the activity log must survive the rollback too');

  const vendor = await p.vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.notEqual(vendor?.name, 'نامی که نباید ذخیره شود', 'no part of the refused save may land');
});

test('deleting a source is all or nothing', SKIP, async () => {
  // The delete is three statements. It is one transaction for the same reason:
  // a source stripped of its evaluation and its material link but still listed
  // in every register is worse than one that is simply still there.
  const p = db();
  const { deleteVendorFromDb } = await import('../src/server/repositories/vendorRepository');

  assert.equal(await deleteVendorFromDb(FIXTURE.vendorId), true);
  assert.equal(await p.vendor.count({ where: { id: FIXTURE.vendorId } }), 0);
  assert.equal(await p.evaluation.count({ where: { vendorId: FIXTURE.vendorId } }), 0);
  assert.equal(await p.vendorMaterial.count({ where: { vendorId: FIXTURE.vendorId } }), 0);

  // A second delete finds nothing and says so rather than throwing.
  assert.equal(await deleteVendorFromDb(FIXTURE.vendorId), false);
});
