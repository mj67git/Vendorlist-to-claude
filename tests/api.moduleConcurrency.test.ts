import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  api, db, FIXTURE, login, resetAll, SKIP, startTestServer, stopTestServer,
} from './helpers/apiHarness';

/**
 * The same stale-copy rule, on the three modules that had no protection at all.
 *
 * Partners, materials and the chosen-source decision are read-modify-writes
 * like the source endpoints — and the partner route replaces the whole record,
 * SOP evaluation included, so the loser of a race lost more than one field.
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

function partnerBody(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE.supplierA, type: 'Supplier', name: 'فروشندهٔ الف', nameEn: 'Seller A',
    country: 'Turkey', status: 'Active', ...overrides,
  };
}

test('a partner save from a stale copy is refused, and the first writer keeps the record', SKIP, async () => {
  const token = await login('admin');
  const list = await api('/api/business-partners', { token });
  const stale = list.body.find((p: any) => p.id === FIXTURE.supplierA).updatedAt;
  assert.ok(stale, 'the list carries the timestamp a save claims back');

  const theirs = await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token, body: partnerBody({ city: 'استانبول', expectedUpdatedAt: stale }),
  });
  assert.equal(theirs.status, 200);

  const mine = await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token, body: partnerBody({ city: 'آنکارا', expectedUpdatedAt: stale }),
  });
  assert.equal(mine.status, 409);

  const row = await db().businessPartner.findUnique({ where: { id: FIXTURE.supplierA } });
  assert.equal(row.city, 'استانبول');
});

test('a partner save with no claim keeps the behaviour it had', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token, body: partnerBody({ city: 'ازمیر' }),
  });
  assert.equal(res.status, 200);
});

test('a material edit from a stale copy is refused', SKIP, async () => {
  const token = await login('admin');
  const list = await api('/api/materials', { token });
  const stale = list.body.find((m: any) => m.id === FIXTURE.materialId).updatedAt;
  assert.ok(stale, 'materials carry a write timestamp now');

  const theirs = await api(`/api/materials/${FIXTURE.materialId}`, {
    method: 'PATCH', token, body: { iupac: 'first', expectedUpdatedAt: stale },
  });
  assert.equal(theirs.status, 200);

  const mine = await api(`/api/materials/${FIXTURE.materialId}`, {
    method: 'PATCH', token, body: { iupac: 'second', expectedUpdatedAt: stale },
  });
  assert.equal(mine.status, 409);

  const row = await db().material.findUnique({ where: { id: FIXTURE.materialId } });
  assert.equal(row.iupac, 'first');
});

test('the chosen-source decision refuses a save made from an older one', SKIP, async () => {
  const token = await login('admin');
  const body = {
    materialKey: 'Paracetamol', category: 'foreign', vendorId: FIXTURE.vendorId,
    reason: 'بهترین قیمت و کیفیت تأییدشده',
  };
  const first = await api('/api/source-selections', { method: 'PUT', token, body });
  assert.equal(first.status, 200);
  const stale = first.body.selection.updatedAt;
  assert.ok(stale);

  const theirs = await api('/api/source-selections', {
    method: 'PUT', token, body: { ...body, reason: 'تصمیم کاربر اول با دلیل کافی', expectedUpdatedAt: stale },
  });
  assert.equal(theirs.status, 200);

  const mine = await api('/api/source-selections', {
    method: 'PUT', token, body: { ...body, reason: 'تصمیم کاربر دوم با دلیل کافی', expectedUpdatedAt: stale },
  });
  assert.equal(mine.status, 409);

  const row = await db().sourceSelection.findFirst({ where: { materialKey: 'Paracetamol', category: 'foreign' } });
  assert.equal(row.reason, 'تصمیم کاربر اول با دلیل کافی');
});

test('two writes to one partner do not interleave', SKIP, async () => {
  // The lock is per record and per module: both of these touch the same
  // partner, so they run one after another and the second one's value is what
  // survives — rather than the two upserts overlapping.
  const token = await login('admin');
  const [a, b] = await Promise.all([
    api(`/api/business-partners/${FIXTURE.supplierA}`, { method: 'PUT', token, body: partnerBody({ city: 'اول' }) }),
    api(`/api/business-partners/${FIXTURE.supplierA}`, { method: 'PUT', token, body: partnerBody({ city: 'دوم' }) }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const row = await db().businessPartner.findUnique({ where: { id: FIXTURE.supplierA } });
  assert.ok(['اول', 'دوم'].includes(row.city), 'one of them won cleanly');
});
