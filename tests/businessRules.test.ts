import assert from 'node:assert/strict';
import test from 'node:test';
import { FmeaService } from '../src/utils/fmeaService';
import {
  calculateDocScore,
  calculateGradeAndStatus,
} from '../src/utils/sopEvaluation';

test('SOP document scoring remains unchanged', () => {
  assert.equal(calculateDocScore('Approved'), 20);
  assert.equal(calculateDocScore('Permit Approval'), 10);
  assert.equal(calculateDocScore('Expired'), 5);
  assert.equal(calculateDocScore('Not Submitted'), 0);
  assert.equal(calculateDocScore(null), 0);
});

// The authoritative SOP rubric: 80 / 60 / 40 / 30, grading into
// A, B, C, Pending Review, Blacklist. An earlier version of this test asserted
// a different scale (90/75/60 into A/B/C/D) that the code never implemented,
// which left the app straddling two vocabularies; the rubric below is the one
// the business confirmed.
test('SOP grade boundaries follow the 80/60/40/30 rubric', () => {
  assert.deepEqual(calculateGradeAndStatus(100), { grade: 'A', status: 'Approved Supplier' });
  assert.deepEqual(calculateGradeAndStatus(80), { grade: 'A', status: 'Approved Supplier' });
  assert.deepEqual(calculateGradeAndStatus(79), { grade: 'B', status: 'Approved with Monitoring' });
  assert.deepEqual(calculateGradeAndStatus(60), { grade: 'B', status: 'Approved with Monitoring' });
  assert.deepEqual(calculateGradeAndStatus(59), { grade: 'C', status: 'Conditional Supplier' });
  assert.deepEqual(calculateGradeAndStatus(40), { grade: 'C', status: 'Conditional Supplier' });
  assert.deepEqual(calculateGradeAndStatus(39), { grade: 'Pending Review', status: 'Pending Review' });
  assert.deepEqual(calculateGradeAndStatus(30), { grade: 'Pending Review', status: 'Pending Review' });
  assert.deepEqual(calculateGradeAndStatus(29), { grade: 'Blacklist', status: 'Blacklist' });
  assert.deepEqual(calculateGradeAndStatus(0), { grade: 'Blacklist', status: 'Blacklist' });
});

test('an unevaluated supplier is never graded', () => {
  assert.deepEqual(calculateGradeAndStatus(0, false), { grade: 'Not Evaluated', status: 'Not Evaluated' });
  assert.deepEqual(calculateGradeAndStatus(100, false), { grade: 'Not Evaluated', status: 'Not Evaluated' });
});

test('FMEA assessment preserves RPN, SRI, and risk-level outputs', () => {
  assert.deepEqual(FmeaService.performAssessment(5, 3, 4, 70), {
    riskScore: 60,
    sri: 48,
    riskLevel: 'Medium',
  });
  assert.deepEqual(FmeaService.performAssessment(5, 5, 5, 20), {
    riskScore: 125,
    sri: 107,
    riskLevel: 'High',
  });
});
