import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  api, db, FIXTURE, login, resetAll, SKIP, startTestServer, stopTestServer,
} from './helpers/apiHarness';

/**
 * The two read-only views now load their own rows.
 *
 * The archive and the supplier directory used to render from the shared store,
 * with their permission checked in the browser — and a browser check is UX
 * only, because `currentUser` comes from localStorage (rule 14). They read
 * `GET /api/vendors?view=<view>` instead, so what they draw is whatever came
 * back from a request the server was free to refuse. These exercise that route
 * the way the hook does: paged, and told apart from a failure by its status.
 */

before(async () => { await startTestServer(); });
beforeEach(async () => { if (process.env.DATABASE_URL) await resetAll(); });
after(async () => { await stopTestServer(); });

async function restrictTo(permissions: string[]) {
  const adminToken = await login('admin');
  const saved = await api('/api/users/planning/permissions', {
    method: 'PUT', token: adminToken, body: { permissions, reasonForChange: 'تست' },
  });
  assert.equal(saved.status, 200);
  return login('planning');
}

test('the guarded route answers the view with the same envelope the loader pages through', SKIP, async () => {
  const res = await api('/api/vendors?view=archive&page=1&limit=200', { token: await login('admin') });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.items), 'items');
  assert.equal(typeof res.body.pages, 'number', 'pages, which is what ends the loop');
  assert.deepEqual(res.body.items.map((v: any) => v.id), [FIXTURE.vendorId]);
});

test('a refusal is a 403 on the first page, so the view closes instead of emptying', SKIP, async () => {
  // The distinction matters: an empty archive looks like an empty register, and
  // an error looks like the administrator restricted the account. Only 403 may
  // read as "you may not open this".
  const token = await restrictTo(['vendor.read', 'score.planning']);
  const res = await api('/api/vendors?view=archive&page=1&limit=200', { token });
  assert.equal(res.status, 403);
});

test('the rows this account may not see are missing from its view load too', SKIP, async () => {
  // The gated route is the same list endpoint, so `readableVendors` applies:
  // the archive of an account without the blacklist read has no blacklisted
  // rows in it, and that is enforced here rather than by the page.
  await db().vendor.create({
    data: {
      // A source is disqualified by a recorded decision now, not by the
      // `status` column alone: `status` is written by the scoring rules, so
      // using it as the verdict is what let a bad score latch a source into the
      // blacklist permanently. A row inserted straight into the database has to
      // say which of the two it means.
      id: 'V-BLACK', name: 'سورس مردود', nameEn: 'Rejected Co', country: 'China',
      status: 'rejected', grade: 'rejected', rejectedByDecision: true,
    },
  });
  await db().vendorMaterial.create({
    data: {
      id: 'VM-BLACK', vendorId: 'V-BLACK', materialId: FIXTURE.materialId,
      isSample: false, category: 'foreign',
    },
  });

  const wide = await api('/api/vendors?view=archive', { token: await login('admin') });
  assert.deepEqual((wide.body as any[]).map(v => v.id).sort(), ['V-BLACK', FIXTURE.vendorId].sort());

  const token = await restrictTo([
    'vendor.read', 'sample.read', 'archive.read', 'score.planning',
  ]);
  const narrow = await api('/api/vendors?view=archive', { token });
  assert.equal(narrow.status, 200);
  assert.deepEqual((narrow.body as any[]).map(v => v.id), [FIXTURE.vendorId]);
});

test('one view being open does not open the other', SKIP, async () => {
  const token = await restrictTo(['vendor.read', 'archive.read', 'score.planning']);
  assert.equal((await api('/api/vendors?view=archive', { token })).status, 200);
  assert.equal((await api('/api/vendors?view=supplier-audit', { token })).status, 403);
});
