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

/**
 * An account of this file's own, for the must-change-password tests.
 *
 * The login limiter allows eight attempts per username per fifteen minutes and
 * holds that count in process memory, where `resetAll()` cannot reach it. The
 * shared `qa` account is signed in by several tests above, so by the time these
 * run its allowance is spent and they fail at the door having proved nothing
 * about the guard.
 *
 * A username nobody else uses has no history with the limiter. It is created
 * with the same credential `seedUsers` gives the others, so it signs in with
 * the same password, and re-created after each reset because `resetAll()`
 * clears the table.
 */
const PENDING_USER = 'pendingpassword';

async function makePendingUser(): Promise<string> {
  const { generateSalt, hashPassword } = await import('../src/server/security/passwordService');
  const salt = generateSalt();
  await db().user.upsert({
    where: { username: PENDING_USER },
    update: { mustChangePassword: true, isActive: true },
    create: {
      username: PENDING_USER,
      name: 'حساب در انتظار تغییر رمز',
      role: 'qa',
      passwordHash: hashPassword('123', salt),
      passwordSalt: salt,
      mustChangePassword: true,
      isActive: true,
    },
  });
  return login(PENDING_USER);
}

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

/**
 * An account that has been told to change its password cannot work until it does.
 *
 * The sign-in handler returns `mustChangePassword: true` — and a fully valid
 * token beside it. Nothing on the server looks at that flag again: the only
 * thing standing between such an account and the whole API is an early return
 * in `App.tsx`, which is a screen, not a control.
 *
 * That matters because a fresh installation provisions five accounts with known
 * passwords. Anyone who can reach the sign-in page can take a token, skip the
 * browser entirely, and write.
 */
test('a must-change-password session cannot read', SKIP, async () => {
  const token = await makePendingUser();
  const res = await api('/api/vendors', { token });

  assert.equal(res.status, 403, 'the session must be refused until the password is changed');
});

test('a must-change-password session cannot write', SKIP, async () => {
  const token = await makePendingUser();
  const res = await api('/api/materials', {
    method: 'POST',
    token,
    body: { id: 'M-MUST-CHANGE', name: 'ماده آزمایشی', nameEn: 'Probe', cas: 'N/A', irc: 'N/A' },
  });

  assert.equal(res.status, 403, 'writing must be refused before the password is changed');
  const stored = await db().material.findUnique({ where: { id: 'M-MUST-CHANGE' } });
  assert.equal(stored, null, 'nothing may be written by such a session');
});

test('such a session can still reach the two routes it needs', SKIP, async () => {
  // The refusal must not lock the account out of fixing itself.
  const token = await makePendingUser();
  const me = await api('/api/auth/me', { token });
  assert.equal(me.status, 200, '/api/auth/me must stay reachable');

  const changed = await api('/api/auth/change-password', {
    method: 'POST',
    token,
    body: { currentPassword: '123', newPassword: 'a-much-longer-password-1' },
  });
  assert.ok(changed.status < 400, `change-password must stay reachable, got ${changed.status}`);

  // And once it is changed, the account works normally again.
  const after = await api('/api/vendors', { token });
  assert.equal(after.status, 200, 'a changed password restores normal access');
});
