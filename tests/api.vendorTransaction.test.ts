import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURE, SKIP, api, db, login, profileBody, resetAll, startTestServer, stopTestServer,
  waitForAuditQuiet,
} from './helpers/apiHarness';

/**
 * `PUT /api/vendors/:id` — one save, one transaction.
 *
 * What is being proved here is mostly a negative: that a save which is refused
 * part-way through leaves *nothing* behind. Under the five-request queue this
 * endpoint replaces, the parts that had already been sent were already stored,
 * and the client had no way to take them back.
 */

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });
beforeEach(async () => { await resetAll(); });

const RISK = {
  materialCriticality: 4, probability: 3, detectability: 2,
  sps: 70, riskScore: 24, sri: 30, riskLevel: 'Medium',
  date: '۱۴۰۵/۰۶/۲۰', evaluator: 'admin',
};

test('several parts are saved by one request', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT',
    token,
    body: {
      reasonForChange: 'ذخیرهٔ کامل فرم',
      sections: {
        profile: profileBody({ country: 'India' }),
        contact: { contactInfo: 'تهران، خیابان نمونه', lastAudit: '۱۴۰۵/۰۵/۰۱' },
        scores: { scores: { commercial: 88, qa: 92, planning: 90, finance: 86 } },
        risk: { riskAssessment: RISK },
      },
    },
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.parts, ['profile', 'contact', 'scores', 'risk']);

  // Read back from the database rather than trusting the response body.
  const p = db();
  const vendor = await p.vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(vendor?.country, 'India');
  assert.equal(vendor?.contactInfo, 'تهران، خیابان نمونه');
  assert.equal(vendor?.lastAudit, '۱۴۰۵/۰۵/۰۱');

  const evaluation = await p.evaluation.findFirst({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(evaluation?.qaScore, 92);

  const risk = await p.riskAssessment.findFirst({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(risk?.sri, 30);
});

test('a refused part abandons the parts that were allowed', SKIP, async () => {
  /*
   * Quality may score its own department and nothing else. The profile change
   * below is perfectly legitimate for this account — it is the score for
   * `commercial` that is not — and under the request queue the profile would
   * already be stored by the time the scores were refused.
   */
  const token = await login('qa');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT',
    token,
    body: {
      sections: {
        profile: profileBody({ country: 'China' }),
        scores: { scores: { commercial: 95, qa: 80, planning: 0, finance: 0 } },
      },
    },
  });

  assert.equal(res.status, 403, JSON.stringify(res.body));

  const vendor = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(vendor?.country, 'Turkey', 'the allowed part must not have been written');
});

test('a stale claim is refused and writes nothing', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT',
    token,
    body: {
      expectedUpdatedAt: new Date(Date.now() - 86_400_000).toISOString(),
      sections: { profile: profileBody({ country: 'Spain' }) },
    },
  });

  assert.equal(res.status, 409, JSON.stringify(res.body));
  const vendor = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(vendor?.country, 'Turkey');
});

test('the timestamp the response carries is the one the next save may claim', SKIP, async () => {
  // The queue had to thread a fresh `updatedAt` from each response into the
  // next request. One request makes one claim — and the record it answers with
  // has to be good enough to edit again straight away (rule 11a).
  const token = await login('admin');
  const first = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT', token,
    body: { sections: { contact: { contactInfo: 'اولین تماس' } } },
  });
  assert.equal(first.status, 200);

  const second = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT', token,
    body: {
      expectedUpdatedAt: first.body.vendor.updatedAt,
      sections: { contact: { contactInfo: 'دومین تماس' } },
    },
  });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const vendor = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(vendor?.contactInfo, 'دومین تماس');
});

test('a sample is still refused a departmental score, and nothing else lands', SKIP, async () => {
  // Rule 11e. The refusal has to survive the move to the unified endpoint, and
  // it has to take the rest of the save with it.
  const p = db();
  await p.vendorMaterial.updateMany({
    where: { vendorId: FIXTURE.vendorId },
    data: { isSample: true, category: 'sample' },
  });

  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT',
    token,
    body: {
      sections: {
        contact: { contactInfo: 'تماس نمونه' },
        scores: { scores: { commercial: 70, qa: 70, planning: 70, finance: 70 } },
      },
    },
  });

  assert.equal(res.status, 422, JSON.stringify(res.body));
  const vendor = await p.vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(vendor?.contactInfo, 'آدرس تماس', 'the contact part must not have landed either');
});

test('each part that changed leaves its own trail entry, and no more', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT',
    token,
    body: {
      reasonForChange: 'ویرایش دوبخشی',
      sections: {
        profile: profileBody({ country: 'Germany' }),
        risk: { riskAssessment: RISK },
      },
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  await waitForAuditQuiet();
  const rows = await db().auditLog.findMany({
    where: { entityId: FIXTURE.vendorId },
    orderBy: { timestamp: 'desc' },
  });
  const events = rows.map(r => r.event).filter(Boolean).sort();
  assert.deepEqual(events, ['risk.assessed', 'source.updated'],
    `expected one row per changed part, got ${JSON.stringify(rows.map(r => r.event))}`);
});

test('a part the payload leaves out is not touched', SKIP, async () => {
  // Absent means untouched — the same contract `persistVendorRelations` has.
  const token = await login('admin');
  await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT', token,
    body: { sections: { risk: { riskAssessment: RISK } } },
  });
  await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT', token,
    body: { sections: { contact: { contactInfo: 'تماس تازه' } } },
  });

  const risk = await db().riskAssessment.findFirst({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(risk?.sri, 30, 'the risk assessment must survive a save that says nothing about it');
});

test('a payload with no sections is refused rather than saved as nothing', SKIP, async () => {
  const token = await login('admin');
  const empty = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT', token, body: { sections: {} },
  });
  assert.equal(empty.status, 400);

  const missing = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT', token, body: { contactInfo: 'بدون بخش' },
  });
  assert.equal(missing.status, 400);
});

test('an unknown source answers 404, and an unauthorised account 403', SKIP, async () => {
  const token = await login('admin');
  const missing = await api('/api/vendors/V-NOPE', {
    method: 'PUT', token, body: { sections: { contact: { contactInfo: 'x' } } },
  });
  assert.equal(missing.status, 404);

  // `planning` may score its own department and nothing else — it holds none of
  // the editing permissions the route requires beyond that, so the whole route
  // is closed to it when it asks for a part it may not write.
  const planning = await login('planning');
  const refused = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT', token: planning,
    body: { sections: { profile: profileBody({ country: 'Italy' }) } },
  });
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  const vendor = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(vendor?.country, 'Turkey');
});
