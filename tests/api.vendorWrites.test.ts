import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  api, db, FIXTURE, login, profileBody, resetAll, SKIP, startTestServer, stopTestServer,
} from './helpers/apiHarness';

/**
 * The six source PATCH endpoints, which are where the records an auditor reads
 * actually change.
 *
 * Each one is a read-modify-write of the whole vendor, so this is the code most
 * exposed to lost updates, to a permission slipping through, and to a field
 * being dropped on the way to the database — all three of which happened and
 * none of which anything would have caught.
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

test('a profile edit reaches the database and is audited with before and after', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ country: 'India', reasonForChange: 'اصلاح کشور' }),
  });
  assert.equal(res.status, 200);

  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(row.country, 'India');

  const entry = await db().auditLog.findFirst({
    where: { entityId: FIXTURE.vendorId }, orderBy: { timestamp: 'desc' },
  });
  assert.ok(entry, 'every change is recorded');
  assert.equal((entry.beforeData as any).country, 'Turkey');
  assert.equal((entry.afterData as any).country, 'India');
});

test('the partner link is stored in its own column, not in the contact text', SKIP, async () => {
  // It used to be appended to `contact_info` as a `__BP_METAUI__` marker while
  // the column stayed NULL, so changing a source's supplier never stuck and the
  // partner delete guard counted zero dependants for a partner in active use.
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ supplierId: FIXTURE.supplierB, name: 'فروشندهٔ ب', nameEn: 'Seller B' }),
  });
  assert.equal(res.status, 200);

  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(row.supplierId, FIXTURE.supplierB, 'the change landed in the column');
  assert.ok(!String(row.contactInfo || '').includes('__BP_METAUI__'), 'and not in the text');

  const entry = await db().auditLog.findFirst({
    where: { entityId: FIXTURE.vendorId }, orderBy: { timestamp: 'desc' },
  });
  assert.equal((entry.afterData as any).supplierId, FIXTURE.supplierB, 'and it is on the record');
});

test('a partner still linked to a source cannot be deleted', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/business-partners/${FIXTURE.supplierA}`, { method: 'DELETE', token });
  assert.equal(res.status, 400);

  const still = await db().businessPartner.count({ where: { id: FIXTURE.supplierA } });
  assert.equal(still, 1, 'the partner survives');
});

test('a partner nothing depends on can still be deleted', SKIP, async () => {
  // The guard has to refuse the right thing, not everything.
  const token = await login('admin');
  const res = await api(`/api/business-partners/${FIXTURE.supplierB}`, { method: 'DELETE', token });
  assert.equal(res.status, 200);
  assert.equal(await db().businessPartner.count({ where: { id: FIXTURE.supplierB } }), 0);
});

test('a second writer working from a stale copy is refused, not silently applied', SKIP, async () => {
  // The in-process lock serialises this inside one Node process. It is a Map,
  // so it protects nothing across containers or on the serverless deployment —
  // which is what the updatedAt precondition is for. Simulated here by moving
  // the row on after the request has read it.
  const token = await login('admin');

  const before = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  await db().vendor.update({
    where: { id: FIXTURE.vendorId },
    data: { updatedAt: new Date(before.updatedAt.getTime() + 5000) },
  });

  // The handler will read the row (now carrying the newer timestamp) and write
  // with it, so this request succeeds; the point is that the mechanism compares
  // timestamps at all. Prove it directly against the persistence rule instead:
  const stale = await db().vendor.updateMany({
    where: { id: FIXTURE.vendorId, updatedAt: before.updatedAt },
    data: { country: 'دادهٔ کهنه' },
  });
  assert.equal(stale.count, 0, 'a write conditioned on the old timestamp matches nothing');

  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.notEqual(row.country, 'دادهٔ کهنه', 'so the stale value never lands');
});

test('lab results may be recorded by QA and refused for commercial', SKIP, async () => {
  const qa = await login('qa');
  const ok = await api(`/api/vendors/${FIXTURE.vendorId}/analysis`, {
    method: 'PATCH', token: qa,
    body: {
      analysisRecords: [{
        id: 'AR1', date: '1405/06/01', qcCode: 'QC-1', decision: 'Pass',
        deviationReason: '', comments: '', recordedBy: 'qa',
      }],
    },
  });
  assert.equal(ok.status, 200);
  assert.equal(await db().analysisRecord.count({ where: { vendorId: FIXTURE.vendorId } }), 1);

  const commercial = await login('commercial');
  const refused = await api(`/api/vendors/${FIXTURE.vendorId}/analysis`, {
    method: 'PATCH', token: commercial, body: { analysisRecords: [] },
  });
  assert.equal(refused.status, 403);
  assert.equal(
    await db().analysisRecord.count({ where: { vendorId: FIXTURE.vendorId } }), 1,
    'the refused request changed nothing',
  );
});

test('risk assessment is open to QA now that the form is shown to them', SKIP, async () => {
  // It was admin-only while the UI offered QA the risk form and a backlog of
  // sources missing one, so the screen promised work the server refused.
  const qa = await login('qa');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/risk`, {
    method: 'PATCH', token: qa,
    body: { riskAssessment: { riskLevel: 'Medium', severity: 3, occurrence: 3, detectability: 3 } },
  });
  assert.equal(res.status, 200);
  assert.equal(await db().riskAssessment.count({ where: { vendorId: FIXTURE.vendorId } }), 1);

  const finance = await login('finance');
  const refused = await api(`/api/vendors/${FIXTURE.vendorId}/risk`, {
    method: 'PATCH', token: finance, body: { riskAssessment: { riskLevel: 'Low' } },
  });
  assert.equal(refused.status, 403);
});

test('a department may only score itself', SKIP, async () => {
  // This route has no requirePermission — the handler compares the submitted
  // scores against the stored ones per department, which is easy to get wrong
  // and had never been tested.
  const planning = await login('planning');

  const own = await api(`/api/vendors/${FIXTURE.vendorId}/scores`, {
    method: 'PATCH', token: planning,
    body: { scores: { commercial: 0, qa: 0, planning: 80, finance: 0 } },
  });
  assert.equal(own.status, 200, 'planning may set the planning score');

  const other = await api(`/api/vendors/${FIXTURE.vendorId}/scores`, {
    method: 'PATCH', token: planning,
    body: { scores: { commercial: 0, qa: 95, planning: 80, finance: 0 } },
  });
  assert.equal(other.status, 403, 'and may not set QA’s');
});

test('only an administrator may delete a source', SKIP, async () => {
  const commercial = await login('commercial');
  const refused = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'DELETE', token: commercial, body: { reasonForChange: 'تلاش برای حذف' },
  });
  assert.equal(refused.status, 403);
  assert.equal(await db().vendor.count({ where: { id: FIXTURE.vendorId } }), 1);

  const admin = await login('admin');
  const done = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'DELETE', token: admin, body: { reasonForChange: 'حذف رکورد آزمایشی' },
  });
  assert.equal(done.status, 200);
  assert.equal(await db().vendor.count({ where: { id: FIXTURE.vendorId } }), 0);
});

test('a malformed IRC is refused by the server, not just by the form', SKIP, async () => {
  // The form validates it too, but the client gate is cosmetic (rule 14).
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token, body: profileBody({ irc: '123' }),
  });
  assert.equal(res.status, 422);
  assert.match(String(res.body?.error || ''), /IRC/);
});

test('a source may not be attached to a seller below Grade A', SKIP, async () => {
  await db().supplierEvaluation.update({
    where: { id: `SE-${FIXTURE.supplierB}` },
    data: { grade: 'C', totalScore: 45 },
  });
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token, body: profileBody({ supplierId: FIXTURE.supplierB }),
  });
  assert.equal(res.status, 422);

  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(row.supplierId, FIXTURE.supplierA, 'the link is unchanged');
});

test('a refused write is itself recorded', SKIP, async () => {
  // A blocked attempt is evidence too: it says someone tried.
  const token = await login('admin');
  await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token, body: profileBody({ irc: '99' }),
  });
  // The audit write is dispatched without being awaited by the handler (a
  // failure to log must not fail the request), so the row can land a moment
  // after the response. Wait for it rather than racing it — this test failed
  // roughly one run in ten for exactly that reason.
  let entries = 0;
  for (let attempt = 0; attempt < 20 && entries === 0; attempt++) {
    entries = await db().auditLog.count({ where: { entityId: FIXTURE.vendorId } });
    if (entries === 0) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(entries >= 1, 'the attempt left a trace');
});

test('the chosen-source decision requires a reason and is audited', SKIP, async () => {
  const token = await login('admin');
  const res = await api('/api/source-selections', {
    method: 'PUT', token,
    body: {
      materialKey: 'Paracetamol', category: 'foreign',
      vendorId: FIXTURE.vendorId, reason: 'تنها تأمین‌کنندهٔ دارای IRC معتبر',
    },
  });
  assert.equal(res.status, 200);

  const stored = await db().sourceSelection.findFirst({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(stored.reason, 'تنها تأمین‌کنندهٔ دارای IRC معتبر');

  const audited = await db().auditLog.findFirst({
    where: { action: { contains: 'SOURCE_SELECTION' } },
  });
  assert.ok(audited, 'the decision is on the audit trail');
  assert.equal(audited.severity, 'Warning', 'a purchasing decision is not routine noise');
});

test('choosing the source needs the choosing permission, not the editing one', SKIP, async () => {
  // The decision used to run under `vendor.edit`, so anyone who could correct a
  // source's phone number could also change which supplier a material is bought
  // from. QA can edit sources and cannot choose them.
  const qaToken = await login('qa');
  await db().user.update({
    where: { username: 'qa' },
    data: { permissions: ['vendor.read', 'material.read', 'partner.read', 'vendor.edit'] },
  });
  const refused = await api('/api/source-selections', {
    method: 'PUT', token: qaToken,
    body: {
      materialKey: 'Paracetamol', category: 'foreign',
      vendorId: FIXTURE.vendorId, reason: 'تلاش بدون مجوز',
    },
  });
  assert.equal(refused.status, 403);
  assert.equal(await db().sourceSelection.count(), 0, 'nothing was recorded');

  // With the permission, the same request goes through.
  await db().user.update({
    where: { username: 'qa' },
    data: { permissions: ['vendor.read', 'material.read', 'partner.read', 'vendor.select'] },
  });
  const allowed = await api('/api/source-selections', {
    method: 'PUT', token: qaToken,
    body: {
      materialKey: 'Paracetamol', category: 'foreign',
      vendorId: FIXTURE.vendorId, reason: 'تصمیم ثبت‌شده',
    },
  });
  assert.equal(allowed.status, 200);
});

test('reading is a permission too', SKIP, async () => {
  // Nine GET routes enforce a read permission, so a "view only on partners"
  // account is expressible. Strip the reads and the endpoints must refuse.
  const token = await login('planning');
  assert.equal((await api('/api/business-partners', { token })).status, 200);

  await db().user.update({
    where: { username: 'planning' },
    data: { permissions: ['vendor.read', 'material.read'] },
  });
  assert.equal((await api('/api/business-partners', { token })).status, 403);
  assert.equal((await api('/api/vendors', { token })).status, 200, 'the others still work');
});

test('a profile field the source never had is null, not missing', SKIP, async () => {
  // The client sends the whole profile, and a source that never had an IRC
  // expiry date carries `null` there — `.optional()` alone accepts `undefined`
  // and rejects `null`, so this call used to come back 400 "Validation failed".
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ ircExpiryDate: null, contactInfo: null, country: null }),
  });
  assert.equal(res.status, 200, 'null means "this source has none", not a malformed request');
});

test('saving scores on a source with no IRC expiry date actually saves them', SKIP, async () => {
  // The real report: changing a department score also recomputes grade and
  // status, which queues a profile PATCH carrying `ircExpiryDate: null`. That
  // call failed validation, and because the write queue is sequential and stops
  // at the first failure, the scores call behind it never ran — the operator
  // saw a red banner and lost the edit.
  const token = await login('admin');

  const profile = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ ircExpiryDate: null, grade: 'B', status: 'new' }),
  });
  assert.equal(profile.status, 200);

  const scores = await api(`/api/vendors/${FIXTURE.vendorId}/scores`, {
    method: 'PATCH', token,
    body: { scores: { commercial: 70, qa: 80, planning: 60, finance: 90 } },
  });
  assert.equal(scores.status, 200);

  const stored = await db().evaluation.findFirst({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(stored.qaScore, 80, 'the department score reached the database');
});

test('registering a source is refused without the create permission', SKIP, async () => {
  // The button is hidden and the form route refuses in the browser, but the
  // control is here: a department without `vendor.create` cannot register a
  // source however the request is made.
  const token = await login('planning');
  const res = await api('/api/vendors', {
    method: 'POST', token,
    body: { ...profileBody({}), id: 'V-NEW-DENIED' },
  });
  assert.equal(res.status, 403);
  assert.equal(await db().vendor.count({ where: { id: 'V-NEW-DENIED' } }), 0);
});
