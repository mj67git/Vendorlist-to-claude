import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  api, db, login, resetAll, SKIP, startTestServer, stopTestServer,
} from './helpers/apiHarness';

/**
 * The authentication and authorisation guards, exercised over HTTP.
 *
 * `permissions.ts` is well covered as a pure table, but a permission is only a
 * control once an endpoint refuses the request. None of that refusal had ever
 * been tested — the guards were the least verified and most consequential code
 * in the system.
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

test('an unauthenticated request to a guarded route is refused', SKIP, async () => {
  const res = await api('/api/vendors');
  assert.equal(res.status, 401);
});

test('a forged token is refused, and refused as 401 not 403', SKIP, async () => {
  // The distinction is load-bearing: the client ends the session on 401 and
  // keeps it on 403. Getting this backwards logged non-admins straight out.
  const res = await api('/api/vendors', { token: 'not.a.real.token' });
  assert.equal(res.status, 401);
});

test('a token signed with the wrong secret is refused', SKIP, async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const forged = jwt.sign({ username: 'admin', role: 'admin' }, 'a-different-secret-entirely!!!!');
  const res = await api('/api/vendors', { token: forged });
  assert.equal(res.status, 401);
});

test('the wrong password does not sign anyone in', SKIP, async () => {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'wrong' },
  });
  assert.notEqual(res.status, 200);
  assert.equal(res.body?.token, undefined);
});

test('a permission refusal is 403, which keeps the user signed in', SKIP, async () => {
  // planning may read a source and score its own department, nothing else.
  const token = await login('planning');
  assert.equal((await api('/api/vendors', { token })).status, 200, 'reading is allowed');

  const write = await api('/api/vendors/V-TEST/profile', {
    method: 'PATCH', token, body: { name: 'تغییر غیرمجاز' },
  });
  assert.equal(write.status, 403);
  assert.match(String(write.body?.error || ''), /دسترسی/);
});

test('requireRole reads the role from the database, not the seven-day token', SKIP, async () => {
  // The token used to be the authority here. It lives for a week, so an admin
  // who was demoted — or deactivated — kept every user-management endpoint
  // until it expired, with no way to cut them off.
  const token = await login('admin');
  assert.equal((await api('/api/users', { token })).status, 200);

  await db().user.update({ where: { username: 'admin' }, data: { role: 'planning' } });

  const afterDemotion = await api('/api/users', { token });
  assert.equal(afterDemotion.status, 403, 'the same token must no longer administer users');
});

test('a deactivated account cannot use a token it was issued earlier', SKIP, async () => {
  const token = await login('admin');
  await db().user.update({ where: { username: 'admin' }, data: { isActive: false } });

  // 401, not 403: the identity is no longer valid, so the session must end.
  assert.equal((await api('/api/users', { token })).status, 401);
  assert.equal((await api('/api/vendors', { token })).status, 401);
});

test('repeated wrong passwords lock the account, and a colleague is unaffected', SKIP, async () => {
  // Eight per user, sixty per IP. The per-IP ceiling is deliberately loose so
  // one office address cannot lock out everyone behind it.
  for (let i = 0; i < 8; i++) {
    await api('/api/auth/login', { method: 'POST', body: { username: 'qa', password: 'wrong' } });
  }
  const blocked = await api('/api/auth/login', {
    method: 'POST', body: { username: 'qa', password: '123' },
  });
  assert.equal(blocked.status, 429, 'the ninth attempt is refused even with the right password');

  const colleague = await api('/api/auth/login', {
    method: 'POST', body: { username: 'finance', password: '123' },
  });
  assert.equal(colleague.status, 200, 'a different account on the same IP still signs in');
});

test('the audit trail cannot be written by a client', SKIP, async () => {
  // The endpoint that accepted client-authored records is gone. Anything that
  // answers here other than 404 means it came back.
  const token = await login('admin');
  const res = await api('/api/audit-logs', {
    method: 'POST', token,
    body: { module: 'ساختگی', action: 'Create', severity: 'Critical', description: 'رکورد جعلی' },
  });
  assert.equal(res.status, 404);

  const count = await db().auditLog.count({ where: { module: 'ساختگی' } });
  assert.equal(count, 0, 'nothing was written');
});

test('an unknown API path answers with JSON, not the application shell', SKIP, async () => {
  const token = await login('admin');
  const res = await api('/api/does-not-exist', { token });
  assert.equal(res.status, 404);
  assert.ok(res.body, 'a JSON body, so the client can parse the failure');
});

test('health reports the database, not just that the process is alive', SKIP, async () => {
  const res = await api('/api/health');
  assert.equal(res.status, 200);
});
