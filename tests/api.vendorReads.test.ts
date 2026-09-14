import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  api, db, FIXTURE, login, resetAll, SKIP, startTestServer, stopTestServer,
} from './helpers/apiHarness';

/**
 * What an account is served, rather than what it is shown.
 *
 * Samples and the blacklist are categories of source, not separate tables, so
 * "may read the samples" can only be a per-row answer — and it has to be given
 * on the server. A list that arrives complete and is merely not drawn is a
 * screen decision, and rule 14 says the screen decides nothing.
 */

before(async () => { await startTestServer(); });
beforeEach(async () => { if (process.env.DATABASE_URL) await resetAll(); });
after(async () => { await stopTestServer(); });

/** A sample and a blacklisted source, alongside the fixture's ordinary one. */
async function seedCategories() {
  const p = db();
  await p.vendor.create({
    data: {
      id: 'V-SAMPLE', name: 'نمونهٔ الف', nameEn: 'Sample A', country: 'India',
      status: 'new', grade: 'B',
    },
  });
  await p.vendorMaterial.create({
    data: {
      id: 'VM-SAMPLE', vendorId: 'V-SAMPLE', materialId: FIXTURE.materialId,
      isSample: true, category: 'sample',
    },
  });
  await p.vendor.create({
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
  await p.vendorMaterial.create({
    data: {
      id: 'VM-BLACK', vendorId: 'V-BLACK', materialId: FIXTURE.materialId,
      isSample: false, category: 'foreign',
    },
  });
}

/** An account restricted to the plain source list, by a stored exception list. */
async function restrictedToken(permissions: string[]) {
  const adminToken = await login('admin');
  const saved = await api('/api/users/planning/permissions', {
    method: 'PUT', token: adminToken, body: { permissions, reasonForChange: 'تست' },
  });
  assert.equal(saved.status, 200);
  return login('planning');
}

async function idsFrom(token: string, query = '') {
  const res = await api(`/api/vendors${query}`, { token });
  assert.equal(res.status, 200);
  const rows = Array.isArray(res.body) ? res.body : res.body.items;
  return { ids: rows.map((v: any) => v.id).sort(), body: res.body };
}

test('an account holding every read is served every row', SKIP, async () => {
  await seedCategories();
  const { ids } = await idsFrom(await login('admin'));
  assert.deepEqual(ids, ['V-BLACK', 'V-SAMPLE', FIXTURE.vendorId].sort());
});

test('without the sample read, the sample rows never leave the server', SKIP, async () => {
  await seedCategories();
  const token = await restrictedToken(['vendor.read', 'blacklist.read', 'score.planning']);
  const { ids } = await idsFrom(token);
  assert.deepEqual(ids, ['V-BLACK', FIXTURE.vendorId].sort());
});

test('without the blacklist read, the rejected rows do not either', SKIP, async () => {
  await seedCategories();
  const token = await restrictedToken(['vendor.read', 'sample.read', 'score.planning']);
  const { ids } = await idsFrom(token);
  assert.deepEqual(ids, ['V-SAMPLE', FIXTURE.vendorId].sort());
});

test('the paged answer counts what this account can see, not what exists', SKIP, async () => {
  // A count taken before the filter would hand out short pages and a total that
  // disagrees with them, and the client pages until it has `total` rows.
  await seedCategories();
  const token = await restrictedToken(['vendor.read', 'score.planning']);
  const { ids, body } = await idsFrom(token, '?page=1&limit=50');
  assert.deepEqual(ids, [FIXTURE.vendorId]);
  assert.equal(body.total, 1);
  assert.equal(body.pages, 1);
});

test('the change poll agrees with the list the same account is given', SKIP, async () => {
  // The client reads a deletion off the total, so a count including rows this
  // account is never sent would make somebody else's sample write look like one.
  await seedCategories();
  const token = await restrictedToken(['vendor.read', 'score.planning']);
  const res = await api('/api/vendors/changes', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 1);
});

test('the archive and the directory are their own permission to open', SKIP, async () => {
  const token = await restrictedToken(['vendor.read', 'archive.read', 'score.planning']);

  const archive = await api('/api/vendors?view=archive', { token });
  assert.equal(archive.status, 200);

  const directory = await api('/api/vendors?view=supplier-audit', { token });
  assert.equal(directory.status, 403);

  // …and the plain list is unaffected by either.
  assert.equal((await api('/api/vendors', { token })).status, 200);
});

test('a view nobody defined is a bad request, not a silent full list', SKIP, async () => {
  const res = await api('/api/vendors?view=whatever', { token: await login('admin') });
  assert.equal(res.status, 400);
});

/**
 * Reading back only what moved.
 *
 * The background poll knows which ids changed and used to spend them on a
 * complete re-read of the register — about nine megabytes on ten thousand
 * sources, every thirty seconds while somebody else kept saving. Naming ids is
 * a shortcut past the paging, so the first thing to prove is that it is not a
 * shortcut past the row filter as well.
 */
test('a named handful comes back, and only the named ones', SKIP, async () => {
  await seedCategories();
  const token = await login('admin');
  const res = await api(`/api/vendors?ids=${FIXTURE.vendorId},V-SAMPLE`, { token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((v: any) => v.id).sort(), [FIXTURE.vendorId, 'V-SAMPLE'].sort());
  // The whole record, relations included — this replaces a full re-read.
  assert.ok(Object.prototype.hasOwnProperty.call(res.body[0], 'activityLogs'));
});

test('naming an id grants nothing that listing would not', SKIP, async () => {
  await seedCategories();
  const token = await restrictedToken(['vendor.read', 'score.planning']);
  const res = await api(`/api/vendors?ids=${FIXTURE.vendorId},V-SAMPLE,V-BLACK`, { token });
  assert.equal(res.status, 200);
  // Same account, same filter as the list: the sample and the blacklisted row
  // are refused by `readableVendors` whether they are asked for by name or not.
  assert.deepEqual(res.body.map((v: any) => v.id), [FIXTURE.vendorId]);
});

test('an unknown id is simply absent, and an empty list is an empty answer', SKIP, async () => {
  const token = await login('admin');
  const missing = await api('/api/vendors?ids=V-NOPE', { token });
  assert.equal(missing.status, 200);
  assert.deepEqual(missing.body, []);

  const empty = await api('/api/vendors?ids=', { token });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, []);
});
