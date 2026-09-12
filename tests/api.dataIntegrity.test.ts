import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURE, SKIP, api, db, login, profileBody, resetAll, startTestServer, stopTestServer,
} from './helpers/apiHarness';

/**
 * Four ways the stored data could disagree with itself.
 *
 * Each of these is small, and each was found by reading rather than by anyone
 * reporting it — which is the point: none of them announces itself. A source
 * shows a different score on two requests, a partner nobody may buy from is
 * attached anyway, a file larger than the ceiling is stored because the caller
 * said it was smaller. They fail on the commit that introduces them.
 */

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });
beforeEach(async () => { await resetAll(); });

test('changing a source\'s material leaves no evaluation behind', SKIP, async () => {
  // `saveVendorToDb` deletes the old vendor_materials link when the material
  // changes, but nothing deletes the evaluation keyed to it. The row survives,
  // pointing at a material the source no longer supplies.
  const token = await login('admin');
  const p = db();

  await p.material.create({
    data: { id: 'M-SECOND', name: 'ایبوپروفن', nameEn: 'Ibuprofen', cas: '15687-27-1', irc: 'N/A' },
  });

  await api(`/api/vendors/${FIXTURE.vendorId}/scores`, {
    method: 'PATCH',
    token,
    body: { scores: { commercial: 90, qa: 90, planning: 90, finance: 90 } },
  });

  await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH',
    token,
    body: profileBody({ material: 'ایبوپروفن', materialEn: 'Ibuprofen', cas: '15687-27-1', materialId: 'M-SECOND' }),
  });

  const rows = await p.evaluation.findMany({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(rows.length, 1, `expected one evaluation, found ${rows.length}`);
  assert.equal(rows[0].materialId, 'M-SECOND', 'the surviving row must be the current material');
});

test('a source reads the same score twice running', SKIP, async () => {
  /*
   * The read has no `orderBy` and the map it builds keeps the last row it
   * sees, so with more than one evaluation the answer is whatever order
   * PostgreSQL happens to return — which an UPDATE or a VACUUM can change.
   * Two evaluations are planted directly to make the ambiguity explicit.
   */
  const token = await login('admin');
  const p = db();

  await p.material.create({
    data: { id: 'M-OLD', name: 'مادهٔ قدیمی', nameEn: 'Old', cas: 'N/A', irc: 'N/A' },
  });
  await p.evaluation.create({
    data: {
      id: 'ev-old', vendorId: FIXTURE.vendorId, materialId: 'M-OLD', period: '۱۴۰۵-Q1',
      commercialScore: 12, qaScore: 12, planningScore: 12, financeScore: 12,
      totalScore: 12, grade: 'rejected',
      scores: JSON.stringify({ commercial: 12, qa: 12, planning: 12, finance: 12 }),
    },
  });
  await p.evaluation.create({
    data: {
      id: 'ev-new', vendorId: FIXTURE.vendorId, materialId: FIXTURE.materialId, period: '۱۴۰۵-Q1',
      commercialScore: 88, qaScore: 88, planningScore: 88, financeScore: 88,
      totalScore: 88, grade: 'A',
      scores: JSON.stringify({ commercial: 88, qa: 88, planning: 88, finance: 88 }),
    },
  });

  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const res = await api(`/api/vendors?limit=200`, { token });
    const list = Array.isArray(res.body) ? res.body : (res.body as any).items;
    const mine = list.find((v: any) => v.id === FIXTURE.vendorId);
    seen.add(JSON.stringify(mine?.scores ?? null));
  }
  assert.equal(seen.size, 1, `the same source answered with ${seen.size} different scores`);
});

test('a blacklisted manufacturer cannot be attached to a source', SKIP, async () => {
  // `sopSupplierViolation` refuses a blacklisted partner — `canSupplySources`
  // checks the status before it checks the SOP grade — but it is only ever
  // called with `supplierId`. The manufacturer field goes unchecked.
  const token = await login('admin');
  const p = db();

  await p.businessPartner.create({
    data: {
      id: 'BP-BANNED', name: 'تولیدکنندهٔ مردود', nameEn: 'Banned Maker',
      type: 'Manufacturer', country: 'China', status: 'Blacklisted', updatedAt: new Date(),
    },
  });

  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH',
    token,
    body: profileBody({ manufacturerId: 'BP-BANNED' }),
  });

  assert.equal(res.status, 422, 'attaching a blacklisted manufacturer must be refused');
  const stored = await p.vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.notEqual(stored?.manufacturerId, 'BP-BANNED', 'and nothing may be stored');
});

test('a claimed size no longer decides anything', SKIP, async () => {
  // The mirror of the check below, and the cheap half of it: a caller that
  // overstates the size of a small file is not refused, because the claim is
  // not what the ceiling is applied to any more.
  const token = await login('admin');
  const small = 'data:application/pdf;base64,' + 'A'.repeat(1024);

  const res = await api(`/api/materials/${FIXTURE.materialId}/specification`, {
    method: 'PUT',
    token,
    body: { fileName: 'small.pdf', fileSize: 99_000_000, fileDataUrl: small },
  });

  assert.equal(res.status, 200, 'a small file must be accepted whatever the caller claims');
});

test('the size ceiling is measured, not taken on trust', SKIP, async () => {
  /*
   * The check read `fileSize` straight out of the request body, so a caller
   * sending a small number beside a large payload walked past a limit the
   * server believed it was enforcing.
   *
   * Base64 carries three bytes in every four characters, so the payload has to
   * be about a third larger than the ceiling it is meant to breach — a detail
   * this test got wrong the first time and passed on a file that was well
   * under it. It still has to stay below the 10mb body cap, or express
   * refuses it first and the test proves nothing about this check.
   */
  const token = await login('admin');
  const CEILING = 7 * 1024 * 1024;
  const chars = Math.ceil((CEILING + 200_000) * 4 / 3);
  const oversized = 'data:application/pdf;base64,' + 'A'.repeat(chars);

  const res = await api(`/api/materials/${FIXTURE.materialId}/specification`, {
    method: 'PUT',
    token,
    body: { fileName: 'big.pdf', fileSize: 12, fileDataUrl: oversized },
  });

  assert.equal(res.status, 413, 'the ceiling must be applied to the file that actually arrived');
  const stored = await db().material.findUnique({ where: { id: FIXTURE.materialId } });
  assert.equal(stored?.specificationFileData, null, 'and nothing oversized may be stored');
});
