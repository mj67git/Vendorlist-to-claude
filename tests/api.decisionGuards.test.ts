import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  api, db, FIXTURE, login, profileBody, resetAll, SKIP, startTestServer, stopTestServer,
} from './helpers/apiHarness';

/**
 * The decisions, enforced by the server rather than by the screen.
 *
 * Each of these travels inside a payload that also carries ordinary edits, so
 * the rule cannot be a middleware on the route: the handler compares what was
 * sent against what is stored. These drive the real endpoints, because a rule
 * is only a control once an endpoint enforces it — hiding the button is UX
 * (rule 14).
 */

before(async () => { await startTestServer(); });
beforeEach(async () => { if (process.env.DATABASE_URL) await resetAll(); });
after(async () => { await stopTestServer(); });

async function currentVendor() {
  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  return row;
}

test('a commercial user may still edit a source', SKIP, async () => {
  // The guard must not turn an ordinary edit into a permission error. This is
  // the case that would break every day if the comparison were wrong.
  const token = await login('commercial');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token, body: profileBody({ country: 'India' }),
  });
  assert.equal(res.status, 200);
  assert.equal((await currentVendor())!.country, 'India');
});

test('disqualifying a source is refused without the source decision', SKIP, async () => {
  const token = await login('commercial');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ status: 'rejected', rejectionReasons: ['رد توسط ادمین — کیفیت'] }),
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /مجوز/);
  assert.equal((await currentVendor())!.status, 'new', 'and the record is untouched');
});

test('an administrator disqualifies the source', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ status: 'rejected', rejectionReasons: ['رد توسط ادمین — کیفیت'] }),
  });
  assert.equal(res.status, 200);
  assert.equal((await currentVendor())!.status, 'rejected');
});

test('the refusal is recorded, because a blocked write is evidence too', SKIP, async () => {
  const token = await login('commercial');
  await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ status: 'rejected', rejectionReasons: ['رد'] }),
  });
  const rows = await db().auditLog.findMany({ where: { entityId: FIXTURE.vendorId } });
  const blocked = rows.filter((r: any) => r.action === 'Update - Blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].severity, 'Critical');
});

test('the stated grounds are guarded on the scores route as well', SKIP, async () => {
  // `rejectionReasons` travels with the scores, not with the profile, so a
  // guard on the profile alone would leave the blacklist writable by anyone.
  const token = await login('commercial');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/scores`, {
    method: 'PATCH', token,
    body: { scores: { commercial: 80, qa: 0, planning: 0, finance: 0 }, rejectionReasons: ['رد دستی'] },
  });
  assert.equal(res.status, 403);
});

test('scoring a source without touching the verdict still works', SKIP, async () => {
  const token = await login('commercial');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/scores`, {
    method: 'PATCH', token,
    body: { scores: { commercial: 80, qa: 0, planning: 0, finance: 0 } },
  });
  assert.equal(res.status, 200);
});

test('quality rules on a sample, and commercial does not', SKIP, async () => {
  await db().vendorMaterial.updateMany({
    where: { vendorId: FIXTURE.vendorId }, data: { isSample: true, category: 'sample' },
  });
  // `irc` is stated because the guard compares the payload with the stored
  // record: quality may decide, but may not edit, so a payload that also blanks
  // a field is refused — which the next test checks on purpose.
  const sampleVerdict = profileBody({
    irc: 'N/A', isSample: true,
    status: 'rejected', rejectionReasons: ['رد توسط ادمین — نتایج آزمایشگاهی'],
  });

  const refused = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token: await login('commercial'), body: sampleVerdict,
  });
  assert.equal(refused.status, 403);

  const allowed = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token: await login('qa'), body: sampleVerdict,
  });
  assert.equal(allowed.status, 200);
});

test('deciding is not a way in to editing', SKIP, async () => {
  // Quality rules on the sample and nothing else. A payload that states the
  // verdict and quietly changes a field alongside it is refused, so the
  // decision permission cannot stand in for `vendor.edit`.
  await db().vendorMaterial.updateMany({
    where: { vendorId: FIXTURE.vendorId }, data: { isSample: true, category: 'sample' },
  });
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token: await login('qa'),
    body: profileBody({ irc: 'N/A', isSample: true, status: 'rejected', country: 'India' }),
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /ویرایش سورس/);
});

/** One approved document on seller A, so there is a grade to protect. */
async function seedSopDocument() {
  await db().sopDocument.create({
    data: {
      id: 'SOP-A-1', evaluationId: `SE-${FIXTURE.supplierA}`, key: 'businessLicense',
      nameFa: 'مجوز کسب‌وکار', nameEn: 'Business License', status: 'Approved', score: 20,
    },
  });
}

const APPROVED_LICENCE = {
  documents: {
    businessLicense: {
      key: 'businessLicense', nameFa: 'مجوز کسب‌وکار', nameEn: 'Business License',
      status: 'Approved', score: 20,
    },
  },
  totalScore: 100, grade: 'A', status: 'Approved',
};

async function partnerBody(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE.supplierA, name: 'فروشندهٔ الف', nameEn: 'Seller A',
    type: 'Supplier', country: 'Turkey', status: 'Active',
    ...overrides,
  };
}

test('commercial edits the partner record but does not grade it', SKIP, async () => {
  await seedSopDocument();
  const token = await login('commercial');

  // The evaluation is carried along unchanged, because a payload that omits it
  // tells the repository to delete it — which is why the guard compares it
  // either way, not only when the field is present.
  const edit = await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token,
    body: await partnerBody({ city: 'استانبول', evaluation: APPROVED_LICENCE }),
  });
  assert.equal(edit.status, 200, 'ordinary maintenance is still commercial work');

  const regrade = await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token,
    body: await partnerBody({
      evaluation: {
        ...APPROVED_LICENCE,
        documents: { businessLicense: { ...APPROVED_LICENCE.documents.businessLicense, status: 'Not Submitted' } },
      },
    }),
  });
  assert.equal(regrade.status, 403);
  const evaluation = await db().supplierEvaluation.findUnique({ where: { partnerId: FIXTURE.supplierA } });
  assert.equal(evaluation.grade, 'A', 'the grade the source depends on is untouched');
});

test('quality grades the seller, and does not switch it off', SKIP, async () => {
  const token = await login('qa');

  const regrade = await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token, body: await partnerBody({ evaluation: APPROVED_LICENCE }),
  });
  assert.equal(regrade.status, 200);

  const deactivate = await api(`/api/business-partners/${FIXTURE.supplierA}`, {
    method: 'PUT', token, body: await partnerBody({ status: 'Inactive', evaluation: APPROVED_LICENCE }),
  });
  assert.equal(deactivate.status, 403);
});

test('reading the user list is not the same right as changing one', SKIP, async () => {
  const adminToken = await login('admin');
  const granted = await api('/api/users/commercial/permissions', {
    method: 'PUT', token: adminToken,
    body: { permissions: ['vendor.read', 'users.read'], reasonForChange: 'تست' },
  });
  assert.equal(granted.status, 200);

  const token = await login('commercial');
  assert.equal((await api('/api/users', { token })).status, 200, 'the list opens');

  const write = await api('/api/users/planning/permissions', {
    method: 'PUT', token, body: { permissions: ['vendor.read'], reasonForChange: 'تست' },
  });
  assert.equal(write.status, 403, 'but handing out access does not');

  const reset = await api('/api/users/planning/reset-password', {
    method: 'POST', token, body: { newPassword: 'temp1234', reasonForChange: 'تست' },
  });
  assert.equal(reset.status, 403, 'and neither does resetting a password');
});

test('the module permission alone no longer hands out access', SKIP, async () => {
  // `users.manage` opens the module; `users.permissions` is what actually
  // grants. An account given only the first can administer accounts without
  // being able to widen anyone's access, its own included — which is only
  // expressible because a stored list is read literally rather than expanded.
  const adminToken = await login('admin');
  const narrowed = await api('/api/users/commercial/permissions', {
    method: 'PUT', token: adminToken,
    body: { permissions: ['vendor.read', 'users.read', 'users.manage'], reasonForChange: 'تست' },
  });
  assert.equal(narrowed.status, 200);

  const token = await login('commercial');
  const viaPatch = await api('/api/users/planning', {
    method: 'PATCH', token, body: { permissions: ['vendor.read', 'users.manage'], reasonForChange: 'تست' },
  });
  assert.equal(viaPatch.status, 403, 'the whole-record route is closed too');

  const rename = await api('/api/users/planning', {
    method: 'PATCH', token, body: { name: 'برنامه‌ریزی', reasonForChange: 'تست' },
  });
  assert.equal(rename.status, 200, 'while the rest of the module still works');
});
