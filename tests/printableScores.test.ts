import assert from 'node:assert/strict';
import test from 'node:test';
import {
  criterionCell, criterionScore, departmentNote, departmentState, earnedCell,
} from '../src/utils/printableScores';
import type { Vendor } from '../src/types';

/**
 * What the printed evaluation form may say about a score.
 *
 * It used to print 5 — full marks — for any criterion with nothing recorded,
 * so an unevaluated source came out of the printer with a perfect scorecard,
 * and the weighted column was computed from those fives. On a document that
 * goes into a regulatory file, a number nobody entered is worse than a blank.
 */

const vendor = (over: Partial<Vendor> = {}): Vendor => ({
  id: 'V1', name: 'شرکت الفا', nameEn: 'Alpha', material: 'پاراستامول', materialEn: 'Paracetamol',
  cas: '103-90-2', irc: 'N/A', country: 'India', category: 'foreign', status: 'new', grade: 'B',
  scores: null, lastAudit: null, rejectionReasons: null, ...over,
} as Vendor);

test('a criterion nobody scored prints a dash, not full marks', () => {
  const v = vendor();
  assert.equal(criterionScore(v, 'commercial', 'delivery'), null);
  assert.equal(criterionCell(v, 'commercial', 'delivery'), '—');
  assert.equal(earnedCell(v, 'commercial', 'delivery', 40), '—');
});

test('a recorded criterion prints what was recorded, weighted', () => {
  const v = vendor({ rawScores: { commercial: { delivery: 4 } } } as any);
  assert.equal(criterionCell(v, 'commercial', 'delivery'), '4');
  assert.equal(earnedCell(v, 'commercial', 'delivery', 40), '32');
});

test('raw scores stored as JSON text are read the same way', () => {
  const v = vendor({ rawScores: JSON.stringify({ qa: { quality: 3 } }) } as any);
  assert.equal(criterionCell(v, 'qa', 'quality'), '3');
});

test('a department total is never spread back over its criteria', () => {
  // 80/100 for the unit does not mean 4 of 5 on every criterion; printing that
  // estimate in the criterion column makes a guess look like data.
  const v = vendor({ scores: { commercial: 80, qa: 0, planning: 0, finance: 0 } } as any);
  assert.equal(criterionCell(v, 'commercial', 'delivery'), '—');
  assert.equal(earnedCell(v, 'commercial', 'delivery', 40), '—');
  assert.equal(departmentState(v, 'commercial'), 'total-only');
  assert.match(departmentNote(v, 'commercial')!, /تفکیک معیارها/);
});

test('a unit that recorded nothing says so', () => {
  const v = vendor();
  assert.equal(departmentState(v, 'qa'), 'unscored');
  assert.match(departmentNote(v, 'qa')!, /ثبت نشده/);
});

test('a fully recorded unit carries no note', () => {
  const v = vendor({
    rawScores: { finance: { price: 5, payment: 4 } },
    scores: { commercial: 0, qa: 0, planning: 0, finance: 90 },
  } as any);
  assert.equal(departmentState(v, 'finance'), 'detailed');
  assert.equal(departmentNote(v, 'finance'), null);
});

test('a zero recorded on purpose is a score, not an absence', () => {
  const v = vendor({ rawScores: { qa: { ncr: 0 } } } as any);
  assert.equal(criterionCell(v, 'qa', 'ncr'), '0');
  assert.equal(earnedCell(v, 'qa', 'ncr', 25), '0');
  assert.equal(departmentState(v, 'qa'), 'detailed');
});
