import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOP_DOCUMENTS_DEF,
  computeSupplierEvaluation,
  reconcileSupplierEvaluation,
  getDefaultSupplierEvaluation,
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

test('the rubric never produces grade D, though the UI maps one', () => {
  // Guards the vocabulary mismatch documented in STATUS.md: gradeApprovalLabel
  // has a 'D' case that the scoring rules cannot reach.
  const reachable = new Set<string>();
  for (const s of ['Approved', 'Permit Approval', 'Expired', 'Not Submitted']) {
    reachable.add(computeSupplierEvaluation(docsWith(Object.fromEntries(SOP_DOCUMENTS_DEF.map(d => [d.key, s])))).grade);
  }
  assert.ok(!reachable.has('D' as any), 'no uniform document status yields D');
});
