import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { api, db, FIXTURE, login, profileBody, resetAll, SKIP, startTestServer, stopTestServer } from './helpers/apiHarness';

/**
 * The source's licence dates survive the save.
 *
 * They did not. `irc_expiry_date` had a column and was read back on every load,
 * `PATCH /contact` computed it, audited the change and answered 200 — and
 * `saveVendorToDb` never wrote it. `last_audit` had no column at all. So a
 * person typed the expiry date into the source form, the application confirmed
 * the save, and the value was gone on the next read.
 *
 * Nothing complained, because everything downstream reads the stored value and
 * a stored NULL simply means "no licence recorded": the dashboard's expiring-
 * licence tile counted zero, the banner on the source page never appeared, the
 * IRC worklist was permanently empty and the valid/expired badge never drew.
 * Measured on a 700-source load run, all 700 rows came back NULL.
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

const read = async (id: string) => {
  const res = await api(`/api/vendors?page=1&limit=200`, { token: await login('admin') });
  return (res.body.items || []).find((v: any) => v.id === id);
};

test('a source registered with licence dates keeps them', SKIP, async () => {
  const token = await login('admin');
  const res = await api('/api/vendors', {
    method: 'POST', token,
    body: {
      ...profileBody({ id: 'V-LIC', irc: '1234567890123456' }),
      id: 'V-LIC',
      materialId: FIXTURE.materialId,
      category: 'foreign',
      ircExpiryDate: '1406/03/15',
      lastAudit: '1404/12/01',
      reasonForChange: 'ثبت سورس با تاریخ مجوز',
    },
  });
  assert.equal(res.status, 200);

  const stored = await db().vendor.findUnique({ where: { id: 'V-LIC' } });
  assert.equal(stored.ircExpiryDate, '1406/03/15', 'the expiry date reaches the database');
  assert.equal(stored.lastAudit, '1404/12/01', 'and so does the issue date');

  const served = await read('V-LIC');
  assert.equal(served.ircExpiryDate, '1406/03/15', 'and comes back out again');
  assert.equal(served.lastAudit, '1404/12/01');
});

test('the contact endpoint can set and change the licence dates', SKIP, async () => {
  const token = await login('admin');
  const first = await api(`/api/vendors/${FIXTURE.vendorId}/contact`, {
    method: 'PATCH', token,
    body: { contactInfo: 'تماس', ircExpiryDate: '1405/07/10', lastAudit: '1404/01/01', reasonForChange: 'ثبت تاریخ مجوز' },
  });
  assert.equal(first.status, 200);
  let v = await read(FIXTURE.vendorId);
  assert.equal(v.ircExpiryDate, '1405/07/10');
  assert.equal(v.lastAudit, '1404/01/01');

  const renewed = await api(`/api/vendors/${FIXTURE.vendorId}/contact`, {
    method: 'PATCH', token,
    body: { contactInfo: 'تماس', ircExpiryDate: '1407/07/10', reasonForChange: 'تمدید مجوز' },
  });
  assert.equal(renewed.status, 200);
  v = await read(FIXTURE.vendorId);
  assert.equal(v.ircExpiryDate, '1407/07/10', 'a renewal replaces the date');
  assert.equal(v.lastAudit, '1404/01/01', 'and leaves the issue date alone');
});

test('another endpoint saving the same source does not wipe the dates', SKIP, async () => {
  // Every PATCH rebuilds the whole vendor from the stored one and writes it
  // back (rule 12), so a field the endpoint knows nothing about still travels
  // through it. That is exactly how a value gets lost.
  const token = await login('admin');
  await api(`/api/vendors/${FIXTURE.vendorId}/contact`, {
    method: 'PATCH', token,
    body: { contactInfo: 'تماس', ircExpiryDate: '1406/05/05', lastAudit: '1404/02/02', reasonForChange: 'ثبت' },
  });

  await api(`/api/vendors/${FIXTURE.vendorId}/scores`, {
    method: 'PATCH', token,
    body: { scores: { commercial: 80, qa: 80, planning: 80, finance: 80 }, reasonForChange: 'امتیازدهی' },
  });
  await api(`/api/vendors/${FIXTURE.vendorId}/risk`, {
    method: 'PATCH', token,
    body: { riskAssessment: { riskLevel: 'Low', materialCriticality: 2, probability: 2, detectability: 2 }, reasonForChange: 'ریسک' },
  });

  const v = await read(FIXTURE.vendorId);
  assert.equal(v.ircExpiryDate, '1406/05/05', 'scoring did not wipe the expiry date');
  assert.equal(v.lastAudit, '1404/02/02', 'nor the issue date');
});

test('the change of a licence date is on the audit trail', SKIP, async () => {
  const token = await login('admin');
  await api(`/api/vendors/${FIXTURE.vendorId}/contact`, {
    method: 'PATCH', token,
    body: { contactInfo: 'تماس', ircExpiryDate: '1406/09/09', reasonForChange: 'ثبت تاریخ انقضا' },
  });

  const deadline = Date.now() + 2000;
  let row: any = null;
  while (Date.now() < deadline && !row) {
    row = await db().auditLog.findFirst({
      where: { entityId: FIXTURE.vendorId, event: 'source.updated' },
      orderBy: { timestamp: 'desc' },
    });
    if (!row) await new Promise(r => setTimeout(r, 25));
  }
  assert.ok(row, 'the edit is recorded');
  const changed = (row.afterData as any).changes.find((c: any) => c.field === 'ircExpiryDate');
  assert.ok(changed, 'and the recorded change names the licence date');
  assert.equal(changed.to, '1406/09/09');
});
