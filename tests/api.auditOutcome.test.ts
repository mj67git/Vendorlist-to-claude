import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { api, db, FIXTURE, login, profileBody, resetAll, SKIP, startTestServer, stopTestServer } from './helpers/apiHarness';
import { resultFor } from '../src/utils/auditService';

/**
 * Whether the recorded action actually happened, and which sign-in it came from.
 *
 * The trail recorded refusals, but said so only inside the free text of the
 * action column — "Delete - Blocked", "FAILED_LOGIN". A reviewer looking for
 * refused attempts had to know that convention and spell it exactly, and every
 * new handler was free to word it differently. `result` is that answer as a
 * column, derived in one place.
 */

/** Wait for a fire-and-forget audit write to land. */
async function waitForAudit(where: any, min = 1): Promise<any[]> {
  const deadline = Date.now() + 2000;
  let rows: any[] = [];
  while (Date.now() < deadline) {
    rows = await db().auditLog.findMany({ where, orderBy: { timestamp: 'desc' } });
    if (rows.length >= min) break;
    await new Promise(r => setTimeout(r, 25));
  }
  return rows;
}

before(async () => {
  await startTestServer();
});
beforeEach(async () => {
  if (process.env.DATABASE_URL) await resetAll();
});
after(async () => {
  await stopTestServer();
});

test('the outcome is derived from the vocabulary the action is written in', () => {
  assert.equal(resultFor('Update'), 'Success');
  assert.equal(resultFor('Delete'), 'Success');
  assert.equal(resultFor('Delete - Blocked'), 'Blocked');
  assert.equal(resultFor('Create - Blocked'), 'Blocked');
  assert.equal(resultFor('FAILED_LOGIN'), 'Failed');
  // A QC rejection is an action that succeeded and whose subject is a
  // rejection. Calling it a failed action would file the laboratory's own
  // decisions next to refused sign-ins.
  assert.equal(resultFor('Reject'), 'Success');
  // An explicit answer always wins over the guess.
  assert.equal(resultFor('Update', 'Failed'), 'Failed');
});

test('a change that went through is recorded as a success', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token, body: profileBody({ country: 'India', reasonForChange: 'اصلاح کشور' }),
  });
  assert.equal(res.status, 200);
  const rows = await waitForAudit({ entityId: FIXTURE.vendorId });
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r: any) => r.result === 'Success'));
});

test('a refused change is recorded as blocked, and the refusal names what was refused', SKIP, async () => {
  const token = await login('admin');
  const res = await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token, body: profileBody({ irc: '99' }),
  });
  assert.equal(res.status, 422);

  const rows = await waitForAudit({ entityId: FIXTURE.vendorId });
  assert.equal(rows[0].result, 'Blocked');
  // Not "Delete - Blocked": nobody tried to delete anything here.
  assert.equal(rows[0].action, 'Update - Blocked');
});

test('a refused sign-in is recorded as failed', SKIP, async () => {
  await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
  const rows = await waitForAudit({ action: 'FAILED_LOGIN' });
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].result, 'Failed');
});

test('refusals can be filtered for without knowing how they were worded', SKIP, async () => {
  const token = await login('admin');
  await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token, body: profileBody({ irc: '99' }),
  });
  await waitForAudit({ entityId: FIXTURE.vendorId });

  const blocked = await api('/api/audit-logs?result=Blocked', { token });
  assert.equal(blocked.status, 200);
  assert.ok(blocked.body.total >= 1);
  assert.ok(blocked.body.data.every((r: any) => r.result === 'Blocked'));

  const succeeded = await api('/api/audit-logs?result=Success', { token });
  assert.ok(succeeded.body.data.every((r: any) => r.result !== 'Blocked'));
});

test('a record names the sign-in it came from, and two sign-ins differ', SKIP, async () => {
  const first = await login('admin');
  await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token: first, body: profileBody({ country: 'India' }),
  });
  const afterFirst = await waitForAudit({ entityId: FIXTURE.vendorId });
  const sessionOne = afterFirst[0].sessionId;
  assert.ok(sessionOne, 'the change carries a session id');

  const second = await login('admin');
  await api(`/api/vendors/${FIXTURE.vendorId}/profile`, {
    method: 'PATCH', token: second, body: profileBody({ country: 'China' }),
  });
  const rows = await waitForAudit({ entityId: FIXTURE.vendorId }, afterFirst.length + 1);
  const sessionTwo = rows[0].sessionId;
  assert.ok(sessionTwo);
  assert.notEqual(sessionTwo, sessionOne);
});

test('a request with no sign-in leaves the session unattributed rather than invented', SKIP, async () => {
  await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
  const rows = await waitForAudit({ action: 'FAILED_LOGIN' });
  assert.equal(rows[0].sessionId, null);
});
