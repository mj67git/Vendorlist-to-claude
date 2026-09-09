import assert from 'node:assert/strict';
import test from 'node:test';
import { TASK_META, buildWorklist } from '../src/components/views/WorklistView';
import { TASK_KEYS } from '../src/utils/navRoutes';

/**
 * What each backlog is allowed to contain.
 *
 * `buildWorklist` is the single definition behind both the dashboard counters
 * and the worklist rows, so a mistake here is a number the user is told twice
 * and cannot check. It had no test at all until the laboratory tab arrived.
 */

const vendor = (over: Record<string, unknown> = {}) => ({
  id: 'V1', name: 'شرکت الف', material: 'پاراستامول', category: 'foreign',
  status: 'new', analysisRecords: [], ...over,
} as any);

const passed = [{ decision: 'Pass' }];

test('every tab in the address list has an entry in the tab table', () => {
  assert.deepEqual(Object.keys(TASK_META).sort(), [...TASK_KEYS].sort());
});

test('the laboratory backlog holds the records with no result on file', () => {
  const rows = buildWorklist('lab', [
    vendor({ id: 'V1' }),
    vendor({ id: 'V2', analysisRecords: passed }),
  ], []);
  assert.deepEqual(rows.map(r => r.id), ['V1'], 'a record with a result is finished work');
});

test('a rejected record is not waiting on the laboratory', () => {
  // Rejected is a verdict already given, so it is nobody's outstanding task —
  // the same exclusion the evaluation and risk backlogs make.
  const rows = buildWorklist('lab', [vendor({ id: 'V1', status: 'rejected' })], []);
  assert.equal(rows.length, 0);
});

test('samples are counted here, and stand above the sources', () => {
  /*
   * The one backlog that includes them: a sample exists in order to be tested,
   * so a sample with no result is the most overdue row the list can hold. The
   * other tabs drop samples, and this test is what keeps that from being
   * copied into this one by habit.
   */
  const rows = buildWorklist('lab', [
    vendor({ id: 'V-source' }),
    vendor({ id: 'V-sample', isSample: true, category: 'sample' }),
  ], []);
  assert.deepEqual(rows.map(r => r.id), ['V-sample', 'V-source']);
  assert.equal(rows[0].note, 'نمونه', 'and the row says which kind it is');
  assert.equal(rows[1].note, 'خرید خارجی');
});

test('the other backlogs still leave samples out', () => {
  const sample = vendor({ id: 'V-sample', isSample: true, category: 'sample' });
  assert.equal(buildWorklist('eval', [sample], []).length, 0);
  assert.equal(buildWorklist('risk', [sample], []).length, 0);
});
