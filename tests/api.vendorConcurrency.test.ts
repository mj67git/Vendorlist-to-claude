import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  api, db, FIXTURE, login, profileBody, resetAll, SKIP, startTestServer, stopTestServer,
} from './helpers/apiHarness';

/**
 * The stale-copy precondition on the source endpoints.
 *
 * The lock and the per-request timestamp only close the window between one
 * handler's read and its own write — the race between two requests in flight
 * together. They say nothing about the ordinary case: a form opened before
 * lunch and saved after it, over edits made in between. The handler re-reads
 * the row and merges, so the stale form used to win silently for every field
 * it carried.
 *
 * The client now sends back the `updatedAt` it read. These tests hold the
 * three behaviours that depend on: the claim is checked, a wrong claim changes
 * nothing, and a caller that makes no claim is unaffected.
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

async function currentStamp(): Promise<string> {
  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  return row.updatedAt.toISOString();
}

test('a save claiming the current copy is applied', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ country: 'India', reasonForChange: 'ویرایش عادی', expectedUpdatedAt: await currentStamp() }),
  });
  assert.equal(res.status, 200);
  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(row.country, 'India');
});

test('a save claiming an older copy is refused, and changes nothing', SKIP, async () => {
  const token = await login('admin');
  const stale = await currentStamp();

  // Somebody else saves first.
  const theirs = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ country: 'Germany', reasonForChange: 'ویرایش کاربر اول', expectedUpdatedAt: stale }),
  });
  assert.equal(theirs.status, 200);

  // The second operator saves the form they opened before that.
  const mine = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ country: 'Spain', reasonForChange: 'فرم کهنه', expectedUpdatedAt: stale }),
  });
  assert.equal(mine.status, 409);

  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(row.country, 'Germany', 'the first writer keeps the field');
});

test('the claim is threaded through a multi-part save', SKIP, async () => {
  // One save can send several PATCHes, and each moves the row's timestamp. The
  // client claims what the previous answer returned, which is what keeps the
  // second part of its own save from being refused.
  const token = await login('admin');

  const first = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ country: 'India', reasonForChange: 'بخش اول', expectedUpdatedAt: await currentStamp() }),
  });
  assert.equal(first.status, 200);
  assert.ok(typeof first.body.vendor.updatedAt === 'string', 'the answer carries the new timestamp');

  const second = await api(`/api/vendors/${FIXTURE.vendorId}/contact`, {
    method: 'PATCH', token,
    body: {
      contactInfo: 'info@example.com', lastAudit: '', ircExpiryDate: '',
      reasonForChange: 'بخش دوم', expectedUpdatedAt: first.body.vendor.updatedAt,
    },
  });
  assert.equal(second.status, 200, 'the second part claims what the first one returned');

  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(row.country, 'India');
  assert.equal(row.contactInfo, 'info@example.com');
});

test('a caller that makes no claim keeps the behaviour it had', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token, body: profileBody({ country: 'Italy', reasonForChange: 'بدون ادعا' }),
  });
  assert.equal(res.status, 200);
  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.equal(row.country, 'Italy');
});

test('an unparseable claim does not make the record unwritable', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ country: 'Japan', reasonForChange: 'ساعت خراب', expectedUpdatedAt: 'not-a-date' }),
  });
  assert.equal(res.status, 200);
});

test('a delete from a stale copy is refused too', SKIP, async () => {
  const token = await login('admin');
  const stale = await currentStamp();
  const theirs = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token,
    body: profileBody({ country: 'Germany', reasonForChange: 'ویرایش کاربر اول', expectedUpdatedAt: stale }),
  });
  assert.equal(theirs.status, 200);

  const removed = await api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'DELETE', token, body: { reasonForChange: 'حذف از روی نسخهٔ کهنه', expectedUpdatedAt: stale },
  });
  assert.equal(removed.status, 409);
  const row = await db().vendor.findUnique({ where: { id: FIXTURE.vendorId } });
  assert.ok(row, 'the record someone else had just edited is still there');
});
