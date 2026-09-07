import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOP_DOCUMENTS_DEF,
  computeSupplierEvaluation,
  reconcileSupplierEvaluation,
  getDefaultSupplierEvaluation,
  calculateGradeAndStatus,
  describeGrade,
} from '../src/utils/sopEvaluation';

const docsWith = (statuses: Record<string, any>) => {
  const d: any = {};
  SOP_DOCUMENTS_DEF.forEach(def => {
    d[def.key] = { ...def, status: statuses[def.key] ?? null, score: 0 };
  });
  return d;
};
const allApproved = () => docsWith(Object.fromEntries(SOP_DOCUMENTS_DEF.map(d => [d.key, 'Approved'])));

test('evaluation is derived from the documents', () => {
  const ev = computeSupplierEvaluation(allApproved());
  assert.equal(ev.totalScore, 100);
  assert.equal(ev.grade, 'A');
});

test('a stored evaluation that disagrees with its documents is re-derived on load', () => {
  const docs = allApproved();
  docs.legalization.status = 'Not Submitted';
  // Stored copy still claims the old perfect score.
  const partner: any = {
    id: 'BP1', type: 'Supplier',
    evaluation: { documents: docs, totalScore: 100, grade: 'A', status: 'Approved Supplier', updatedAt: '2020-01-01T00:00:00.000Z', updatedBy: 'qa' },
  };
  const fixed = reconcileSupplierEvaluation(partner);
  assert.equal(fixed.evaluation.totalScore, 80, 'score must follow the documents');
  assert.equal(fixed.evaluation.updatedAt, '2020-01-01T00:00:00.000Z', 'must not look like a fresh evaluation');
  assert.equal(fixed.evaluation.updatedBy, 'qa');
});

test('reconciling an already-consistent evaluation changes nothing', () => {
  const ev = computeSupplierEvaluation(allApproved());
  const partner: any = { id: 'BP1', type: 'Supplier', evaluation: ev };
  assert.equal(reconcileSupplierEvaluation(partner), partner, 'should return the same object');
});

test('reconcile is idempotent', () => {
  const docs = allApproved();
  docs.businessLicense.status = 'Expired';
  const partner: any = { id: 'BP1', type: 'Supplier', evaluation: { documents: docs, totalScore: 999, grade: 'A', status: 'Approved Supplier' } };
  const once = reconcileSupplierEvaluation(partner);
  const twice = reconcileSupplierEvaluation(once);
  assert.deepEqual(twice, once);
});

test('a partner with no evaluation is left alone', () => {
  const p: any = { id: 'BP2', type: 'Manufacturer' };
  assert.equal(reconcileSupplierEvaluation(p), p);
});

test('an unevaluated supplier stays Not Evaluated', () => {
  const ev = getDefaultSupplierEvaluation();
  assert.equal(ev.grade, 'Not Evaluated');
  assert.equal(computeSupplierEvaluation(ev.documents).grade, 'Not Evaluated');
});

test('every uniform document status lands on a grade the rubric defines', () => {
  // The app briefly carried a second vocabulary (a 'D' grade) that the scoring
  // rules could never produce; this keeps the two from diverging again.
  const defined = new Set(['A', 'B', 'C', 'Blacklist', 'Not Evaluated']);
  const cases: Record<string, string> = {
    'Approved': 'A',          // 5 x 20 = 100
    'Permit Approval': 'B',   // 5 x 10 = 50 -> C
    'Expired': 'Blacklist',   // 5 x 5 = 25, below the 40 boundary
    'Not Submitted': 'Blacklist',
  };
  for (const status of Object.keys(cases)) {
    const grade = computeSupplierEvaluation(docsWith(Object.fromEntries(SOP_DOCUMENTS_DEF.map(d => [d.key, status])))).grade;
    assert.ok(defined.has(grade), `unexpected grade ${grade} for all-${status}`);
  }
});

test('the retired Pending Review band now falls to the blacklist', () => {
  // 30-39 used to be its own grade. The boundary it left behind is the one
  // place a regression would be silent, so it is asserted by score.
  for (const score of [39, 35, 30]) {
    assert.equal(calculateGradeAndStatus(score).grade, 'Blacklist', `score ${score}`);
  }
  assert.equal(calculateGradeAndStatus(40).grade, 'C', 'the C boundary itself is unchanged');
});

test('a supplier stored under the retired grade still renders a readable label', () => {
  // Nothing produces it any more, but rows written before the change do carry
  // it until they are reconciled, and an unlabelled badge helps nobody.
  const label = describeGrade('Pending Review');
  assert.ok(label.fa && label.fa.length > 0);
  assert.ok(label.en && label.en.length > 0);
});
