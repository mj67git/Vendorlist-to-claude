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

// The authoritative SOP rubric: 80 / 60 / 40, grading into A, B, C, Blacklist.
// The rubric the business states: A ۹۰–۱۰۰, B ۷۵–۸۹, C ۶۰–۷۴, D below ۶۰.
// It replaces the 80/60/40 scale, and the failing grade is `D (Rejected)`
// rather than `Blacklist`; both retired values stay readable on stored rows.
test('SOP grade boundaries follow the 90/75/60 rubric', () => {
  assert.deepEqual(calculateGradeAndStatus(100), { grade: 'A', status: 'Approved Supplier' });
  assert.deepEqual(calculateGradeAndStatus(90), { grade: 'A', status: 'Approved Supplier' });
  assert.deepEqual(calculateGradeAndStatus(89), { grade: 'B', status: 'Pending Approval' });
  assert.deepEqual(calculateGradeAndStatus(75), { grade: 'B', status: 'Pending Approval' });
  assert.deepEqual(calculateGradeAndStatus(74), { grade: 'C', status: 'Conditional Approval' });
  assert.deepEqual(calculateGradeAndStatus(60), { grade: 'C', status: 'Conditional Approval' });
  assert.deepEqual(calculateGradeAndStatus(59), { grade: 'D', status: 'Rejected' });
  assert.deepEqual(calculateGradeAndStatus(40), { grade: 'D', status: 'Rejected' });
  assert.deepEqual(calculateGradeAndStatus(0), { grade: 'D', status: 'Rejected' });
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
