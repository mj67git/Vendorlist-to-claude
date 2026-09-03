import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  api, db, FIXTURE, login, profileBody, resetAll, SKIP, startTestServer, stopTestServer,
} from './helpers/apiHarness';

/**
 * `GET /api/vendors/changes` — what a second operator's browser polls so it
 * sees the first one's work without a page reload.
 *
 * The answer has to be right about three things or the client either misses a
 * change or refreshes for nothing: the window is the server's clock, an edit
 * shows up inside it, and a deletion — which leaves no timestamp behind — is
 * still visible through the count.
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

test('a change made after the cursor is reported, and one made before it is not', SKIP, async () => {
  const token = await login('admin');

  const first = await api('/api/vendors/changes', { token });
  assert.equal(first.status, 200);
  assert.ok(typeof first.body.serverTime === 'string', 'the cursor for the next poll comes from the server');
  assert.equal(first.body.total, 1);

  // Nothing has happened since that cursor.
  const quiet = await api(`/api/vendors/changes?since=${encodeURIComponent(first.body.serverTime)}`, { token });
  assert.deepEqual(quiet.body.changed, []);

  const edit = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token, body: profileBody({ country: 'India', reasonForChange: 'تست همگام‌سازی' }),
  });
  assert.equal(edit.status, 200);

  const after = await api(`/api/vendors/changes?since=${encodeURIComponent(first.body.serverTime)}`, { token });
  assert.equal(after.status, 200);
  assert.deepEqual(after.body.changed.map((c: any) => c.id), [FIXTURE.vendorId]);

  // And the same question asked from the newer cursor is quiet again, which is
  // what stops a poll from replaying the same change every thirty seconds.
  const settled = await api(`/api/vendors/changes?since=${encodeURIComponent(after.body.serverTime)}`, { token });
  assert.deepEqual(settled.body.changed, []);
});

test('a deletion is visible through the count, since it leaves no timestamp', SKIP, async () => {
  const token = await login('admin');
  const before = await api('/api/vendors/changes', { token });
  assert.equal(before.body.total, 1);

  const removed = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'DELETE', token, body: { reasonForChange: 'تست حذف' },
  });
  assert.equal(removed.status, 200);

  const after = await api(`/api/vendors/changes?since=${encodeURIComponent(before.body.serverTime)}`, { token });
  assert.equal(after.body.total, 0, 'the register shrank, which is the only trace a delete leaves');
  assert.deepEqual(after.body.changed, [], 'and the deleted row cannot report a timestamp');
});

test('a junk cursor answers with the count instead of failing', SKIP, async () => {
  const token = await login('admin');
  const res = await api('/api/vendors/changes?since=not-a-date', { token });
  assert.equal(res.status, 200, 'a bad clock must self-correct on the next poll, not break the loop');
  assert.deepEqual(res.body.changed, []);
  assert.equal(res.body.total, 1);
});

test('polling needs a session like every other source read', SKIP, async () => {
  const res = await api('/api/vendors/changes');
  assert.equal(res.status, 401);
});
