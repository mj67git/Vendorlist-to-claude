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

test('SOP grade boundary behavior remains unchanged', () => {
  assert.deepEqual(calculateGradeAndStatus(90), { grade: 'A', status: 'Approved Supplier' });
  assert.deepEqual(calculateGradeAndStatus(89), { grade: 'B', status: 'Approved with Monitoring' });
  assert.deepEqual(calculateGradeAndStatus(75), { grade: 'B', status: 'Approved with Monitoring' });
  assert.deepEqual(calculateGradeAndStatus(74), { grade: 'C', status: 'Conditional Approval' });
  assert.deepEqual(calculateGradeAndStatus(60), { grade: 'C', status: 'Conditional Approval' });
  assert.deepEqual(calculateGradeAndStatus(59), { grade: 'D', status: 'Rejected' });
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
