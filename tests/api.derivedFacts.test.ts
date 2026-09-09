import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { api, db, FIXTURE, login, resetAll, SKIP, startTestServer, stopTestServer, waitForAudit, waitForAuditQuiet } from './helpers/apiHarness';
import { SOP_DOCUMENTS_DEF } from '../src/utils/sopEvaluation';

/**
 * Three things the server used to take on trust, and one row it used to invent.
 *
 * Found on a 700-source load run. None of them broke a screen, which is why
 * they survived: each one wrote something plausible into the database that no
 * reader could tell from a fact.
 */

before(async () => {
  await startTestServer();
});
beforeEach(async () => {
  if (process.env.DATABASE_URL) await resetAll();
});
after(async () => {
  await stopTestServer();
});

const documents = (status: string) => Object.fromEntries(
  SOP_DOCUMENTS_DEF.map(def => [
    def.key,
    { key: def.key, nameFa: def.nameFa, nameEn: def.nameEn, status, score: 20 },
  ]),
);

const partnerBody = (overrides: Record<string, unknown> = {}) => ({
  id: FIXTURE.supplierA, name: 'فروشندهٔ الف', nameEn: 'Seller A',
  type: 'Supplier', country: 'Turkey', status: 'Active',
  ...overrides,
});

test('the seller grade is derived from the documents, not taken from the payload', SKIP, async () => {
  // A caller states an A on documents that earn a D. The rubric decides.
  const token = await login('admin');
  const res = await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token,
    body: partnerBody({
      evaluation: { documents: documents('Not Submitted'), totalScore: 100, grade: 'A', status: 'Approved' },
      reasonForChange: 'ارزیابی مدارک',
    }),
  });
  assert.equal(res.status, 200);

  const stored = await db().supplierEvaluation.findUnique({ where: { partnerId: FIXTURE.supplierA } });
  assert.equal(stored.totalScore, 0, 'documents nobody submitted score nothing');
  assert.equal(stored.grade, 'D', 'and the stored grade says so, whatever the payload claimed');
});

test('an approved set of documents earns the grade it is worth', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token,
    body: partnerBody({
      // The reverse direction: the payload understates, and is corrected upward.
      evaluation: { documents: documents('Approved'), totalScore: 0, grade: 'D', status: 'Rejected' },
      reasonForChange: 'ارزیابی مدارک',
    }),
  });
  assert.equal(res.status, 200);

  const stored = await db().supplierEvaluation.findUnique({ where: { partnerId: FIXTURE.supplierA } });
  assert.equal(stored.totalScore, 100);
  assert.equal(stored.grade, 'A');

  const docs = await db().sopDocument.findMany({ where: { evaluationId: stored.id } });
  assert.equal(docs.length, SOP_DOCUMENTS_DEF.length);
  assert.ok(docs.every((d: any) => d.score === 20), 'each document is scored by its own status too');
});

test('a save that did not switch the partner writes no status row', SKIP, async () => {
  /*
   * `partner.status_changed` was marked `alwaysRecord`, and the endpoint raises
   * it on every save because it replaces the whole record. On the load run that
   * produced 22 rows reading «وضعیت شریک «…»: تغییر کرد» with an empty payload,
   * for 22 saves that changed no status — the inert row the audit rewrite
   * exists to prevent.
   */
  const token = await login('admin');
  await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token,
    body: partnerBody({ city: 'استانبول', reasonForChange: 'اصلاح نشانی' }),
  });

  // Absence, so waiting for a row that never comes proves nothing: drain what
  // is in flight first, then assert none of it was a status change.
  await waitForAuditQuiet();
  const rows = await db().auditLog.findMany({ where: { event: 'partner.status_changed' } });
  assert.equal(rows.length, 0, 'a rename is not a status change');

  const switched = await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token,
    body: partnerBody({ status: 'Inactive', reasonForChange: 'تعلیق همکاری' }),
  });
  assert.equal(switched.status, 200);

  const after = await waitForAudit({ event: 'partner.status_changed' });
  assert.equal(after.length, 1, 'and a real switch still writes exactly one');
  assert.match(after[0].description, /Active ← Inactive/);
});

test('a sample is refused a departmental score', SKIP, async () => {
  /*
   * A sample is decided by the laboratory. No view gives one a grade and the
   * evaluation form is not offered on one, but the endpoint stored the numbers
   * anyway and answered 200 — a scoring on the record that never happened and
   * that nothing reads back.
   */
  await db().vendorMaterial.updateMany({
    where: { vendorId: FIXTURE.vendorId }, data: { isSample: true, category: 'sample' },
  });
  const token = await login('admin');

  const res = await api(`/api/vendors/${FIXTURE.vendorId}/scores`, {
    method: 'PATCH', token,
    body: { scores: { commercial: 90, qa: 90, planning: 90, finance: 90 }, reasonForChange: 'امتیازدهی' },
  });
  assert.equal(res.status, 422);

  const evaluation = await db().evaluation.findFirst({ where: { vendorId: FIXTURE.vendorId } });
  assert.ok(!evaluation || Number(evaluation.commercial) === 0, 'and nothing was written');

  const [refusal] = await waitForAudit({ entityId: FIXTURE.vendorId, event: 'access.denied' });
  assert.ok(refusal, 'the refusal is on the trail, not only in the response');
});

test('a sample still records the grounds of its own verdict', SKIP, async () => {
  // The same endpoint carries `rejectionReasons`, which a sample does use. The
  // refusal must not take that with it.
  await db().vendorMaterial.updateMany({
    where: { vendorId: FIXTURE.vendorId }, data: { isSample: true, category: 'sample' },
  });
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/scores`, {
    method: 'PATCH', token: await login('admin'),
    body: {
      scores: { commercial: 0, qa: 0, planning: 0, finance: 0 },
      rejectionReasons: ['مردود در آزمون QC'],
      reasonForChange: 'ثبت دلیل',
    },
  });
  assert.equal(res.status, 200, 'zeros are not a scoring, so this is an ordinary save');
});
