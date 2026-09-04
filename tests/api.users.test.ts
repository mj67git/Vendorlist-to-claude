import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, before, beforeEach } from 'node:test';
import { api, db, login, resetAll, SKIP, startTestServer, stopTestServer } from './helpers/apiHarness';
import { effectivePermissions, roleTemplate } from '../src/utils/permissions';

/**
 * The user-administration module, end to end.
 *
 * Access is the one thing in this system that is not recoverable by looking at
 * the data: if a saved permission list does not come back the way it was saved,
 * an administrator believes an account is restricted when it is not. So these
 * drive the real endpoints and read the row back, rather than testing the
 * policy table in isolation.
 */

before(async () => { await startTestServer(); });
beforeEach(async () => { if (process.env.DATABASE_URL) await resetAll(); });
after(async () => { await stopTestServer(); });

async function listUsers(token: string) {
  const res = await api('/api/users', { token });
  assert.equal(res.status, 200);
  return res.body as any[];
}

async function savePermissions(token: string, username: string, permissions: string[]) {
  return api(`/api/users/${username}/permissions`, {
    method: 'PUT', token, body: { permissions, reasonForChange: 'تست' },
  });
}

test('a narrowed list for a finance account comes back exactly as it was saved', SKIP, async () => {
  const token = await login('admin');
  const wanted = ['vendor.read', 'material.read', 'score.finance'];

  const saved = await savePermissions(token, 'finance', wanted);
  assert.equal(saved.status, 200);

  const row = (await listUsers(token)).find(u => u.username === 'finance');
  assert.deepEqual(row.permissions, wanted, 'the stored exception is what was sent');
  assert.deepEqual(row.effectivePermissions, wanted, 'and it is what is in force');
});

test('a scoring-only account keeps no reads it was not given', SKIP, async () => {
  // The natural way to restrict finance to nothing but its own score: turn off
  // every module row and leave the scoring tick. The list has no read in it,
  // and it must stay that way.
  const token = await login('admin');
  const saved = await savePermissions(token, 'finance', ['score.finance']);
  assert.equal(saved.status, 200);

  const row = (await listUsers(token)).find(u => u.username === 'finance');
  assert.deepEqual(row.permissions, ['score.finance']);
  assert.deepEqual(row.effectivePermissions, ['score.finance'],
    'a saved list is exact — nothing is added back to it');
});

test('a restriction is enforced, not just displayed', SKIP, async () => {
  const token = await login('admin');
  await savePermissions(token, 'finance', ['score.finance']);

  const financeToken = await login('finance');
  const reading = await api('/api/vendors', { token: financeToken });
  assert.equal(reading.status, 403, 'an account with no vendor.read may not read sources');
});

test('an empty list means "follow the role", and says so in the answer', SKIP, async () => {
  const token = await login('admin');
  await savePermissions(token, 'finance', ['score.finance']);

  const cleared = await savePermissions(token, 'finance', []);
  assert.equal(cleared.status, 200);

  const row = (await listUsers(token)).find(u => u.username === 'finance');
  assert.deepEqual(row.permissions, [], 'no exception is stored');
  assert.deepEqual(row.effectivePermissions, roleTemplate('finance'), 'so the role template applies');
});

test('an older list naming only retired permissions still resolves to real access', SKIP, async () => {
  // Rows written before the permissions were split carry names that no longer
  // exist on their own. They must expand, not evaporate.
  await db().user.update({
    where: { username: 'qa' },
    data: { permissions: ['material.write', 'score.qa'] },
  });
  const token = await login('admin');
  const row = (await listUsers(token)).find(u => u.username === 'qa');

  for (const p of ['material.create', 'material.edit', 'material.delete', 'score.qa']) {
    assert.ok(row.effectivePermissions.includes(p), `${p} survives the split`);
  }
  assert.ok(!row.effectivePermissions.includes('vendor.read'),
    'and nothing is added at read time — a list means what it says');
});

test('the migration gives the pre-read lists their reads, and leaves every other row alone', SKIP, async () => {
  // The rows the old read-time heuristic existed for are fixed once, in the
  // database, by 20260903120000. This runs that exact file against rows set up
  // to cover all three cases, because the statement is the only thing standing
  // between an old account and losing the lists it reads every day.
  const sql = readFileSync(
    new URL('../prisma/migrations/20260903120000_expand_legacy_permission_reads/migration.sql', import.meta.url),
    'utf8',
  );

  await db().user.update({ where: { username: 'qa' }, data: { permissions: ['material.write', 'score.qa'] } });
  await db().user.update({ where: { username: 'finance' }, data: { permissions: ['score.finance', 'vendor.read'] } });
  await db().user.update({ where: { username: 'planning' }, data: { permissions: [] } });

  await db().$executeRawUnsafe(sql);

  const rows = Object.fromEntries(
    (await db().user.findMany({ select: { username: true, permissions: true } }))
      .map((u: any) => [u.username, u.permissions]),
  );

  assert.deepEqual(rows.qa,
    ['material.write', 'score.qa', 'vendor.read', 'material.read', 'partner.read', 'partner.files'],
    'a read-less list gets exactly what the old heuristic used to add');
  assert.deepEqual(rows.finance, ['score.finance', 'vendor.read'],
    'a list that already names a read is untouched');
  assert.deepEqual(rows.planning, [], 'an empty list still means "follow the role"');
});

test('the source-selection migration keeps everyone who could already choose', SKIP, async () => {
  // Splitting `vendor.select` out of `vendor.edit` would silently take the
  // decision away from every account whose stored list names the old
  // permission, so 20260903160000 expands those lists once.
  const sql = readFileSync(
    new URL('../prisma/migrations/20260903160000_source_selection_permission/migration.sql', import.meta.url),
    'utf8',
  );

  await db().user.update({ where: { username: 'commercial' }, data: { permissions: ['vendor.read', 'vendor.edit'] } });
  // The retired name that means create plus edit had the same access.
  await db().user.update({ where: { username: 'qa' }, data: { permissions: ['vendor.read', 'vendor.write'] } });
  await db().user.update({ where: { username: 'finance' }, data: { permissions: ['vendor.read', 'score.finance'] } });
  await db().user.update({ where: { username: 'planning' }, data: { permissions: [] } });

  await db().$executeRawUnsafe(sql);

  const rows = Object.fromEntries(
    (await db().user.findMany({ select: { username: true, permissions: true } }))
      .map((u: any) => [u.username, u.permissions]),
  );
  assert.deepEqual(rows.commercial, ['vendor.read', 'vendor.edit', 'vendor.select']);
  assert.deepEqual(rows.qa, ['vendor.read', 'vendor.write', 'vendor.select']);
  assert.deepEqual(rows.finance, ['vendor.read', 'score.finance'], 'a list that never had the edit is untouched');
  assert.deepEqual(rows.planning, [], 'an empty list still means "follow the role"');

  // Running it twice does not double the entry.
  await db().$executeRawUnsafe(sql);
  const again = await db().user.findUnique({ where: { username: 'commercial' } });
  assert.deepEqual(again.permissions, ['vendor.read', 'vendor.edit', 'vendor.select']);
});

test('changing a role clears the exceptions of the old job', SKIP, async () => {
  const token = await login('admin');
  await savePermissions(token, 'finance', ['score.finance']);

  const moved = await api('/api/users/finance', {
    method: 'PATCH', token, body: { role: 'planning', reasonForChange: 'تغییر سمت' },
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.permissionsReset, true);

  const row = (await listUsers(token)).find(u => u.username === 'finance');
  assert.deepEqual(row.permissions, []);
  assert.deepEqual(row.effectivePermissions, roleTemplate('planning'));
});

test('an unknown permission name is dropped rather than stored', SKIP, async () => {
  const token = await login('admin');
  const saved = await savePermissions(token, 'finance', ['score.finance', 'vendor.launch_rocket']);
  assert.equal(saved.status, 200);

  const row = (await listUsers(token)).find(u => u.username === 'finance');
  assert.deepEqual(row.permissions, ['score.finance']);
});

test('nobody may strip the last account that administers users', SKIP, async () => {
  const token = await login('admin');
  const res = await savePermissions(token, 'admin', ['vendor.read']);
  assert.equal(res.status, 400);

  const row = (await listUsers(token)).find(u => u.username === 'admin');
  assert.deepEqual(row.permissions, [], 'the refused change left nothing behind');
});

test('an account without the permission may not see or change accounts', SKIP, async () => {
  const financeToken = await login('finance');
  assert.equal((await api('/api/users', { token: financeToken })).status, 403);
  assert.equal(
    (await api('/api/users/qa/permissions', { method: 'PUT', token: financeToken, body: { permissions: [] } })).status,
    403,
  );
});

/**
 * The module is guarded by the permission, not by the role.
 *
 * It used to be `requireRole("admin")`, which made `users.manage` decorative:
 * granting it changed nothing, and the sidebar meanwhile showed the module to
 * whoever held it — a page the server then refused.
 */
test('the permission itself opens the module, for an account that is not an administrator', SKIP, async () => {
  const adminToken = await login('admin');
  const granted = await savePermissions(adminToken, 'commercial', [
    'vendor.read', 'material.read', 'partner.read', 'users.manage',
  ]);
  assert.equal(granted.status, 200);

  const delegateToken = await login('commercial');
  const list = await api('/api/users', { token: delegateToken });
  assert.equal(list.status, 200);
  assert.ok(list.body.length > 0);

  // And can do the work the module exists for.
  const saved = await api('/api/users/planning/permissions', {
    method: 'PUT', token: delegateToken,
    body: { permissions: ['vendor.read', 'score.planning'], reasonForChange: 'تست تفویض' },
  });
  assert.equal(saved.status, 200);
  const planning = await db().user.findUnique({ where: { username: 'planning' } });
  assert.deepEqual(planning.permissions, ['vendor.read', 'score.planning']);
});

test('taking the permission away closes the module for an administrator too', SKIP, async () => {
  const adminToken = await login('admin');
  // A second administrator, so the last-holder guard is not what refuses this.
  await api('/api/users', {
    method: 'POST', token: adminToken,
    body: { username: 'admin2', name: 'مدیر دوم', role: 'admin', password: 'secret123' },
  });
  const stripped = await savePermissions(adminToken, 'admin2', ['vendor.read']);
  assert.equal(stripped.status, 200);

  await db().user.update({ where: { username: 'admin2' }, data: { mustChangePassword: false } });
  const strippedToken = await login('admin2', 'secret123');
  assert.equal((await api('/api/users', { token: strippedToken })).status, 403);
});

test('a delegate may not mint an administrator', SKIP, async () => {
  const adminToken = await login('admin');
  await savePermissions(adminToken, 'commercial', [
    'vendor.read', 'material.read', 'partner.read', 'users.manage',
  ]);
  const delegateToken = await login('commercial');

  // Not by creating one,
  const created = await api('/api/users', {
    method: 'POST', token: delegateToken,
    body: { username: 'newadmin', name: 'حساب تازه', role: 'admin', password: 'secret123' },
  });
  assert.equal(created.status, 403);
  assert.equal(await db().user.count({ where: { username: 'newadmin' } }), 0);

  // nor by promoting one,
  const promoted = await api('/api/users/planning/role', {
    method: 'PUT', token: delegateToken, body: { role: 'admin', reasonForChange: 'تست' },
  });
  assert.equal(promoted.status, 403);

  // nor through the general edit route.
  const patched = await api('/api/users/planning', {
    method: 'PATCH', token: delegateToken, body: { role: 'admin', reasonForChange: 'تست' },
  });
  assert.equal(patched.status, 403);
  const planning = await db().user.findUnique({ where: { username: 'planning' } });
  assert.equal(planning.role, 'planning');

  // A real administrator still can.
  const byAdmin = await api('/api/users/planning/role', {
    method: 'PUT', token: adminToken, body: { role: 'admin', reasonForChange: 'تست' },
  });
  assert.equal(byAdmin.status, 200);
});

test('the permission change is written to the audit trail with before and after', SKIP, async () => {
  const token = await login('admin');
  await savePermissions(token, 'finance', ['score.finance']);

  const entry = await db().auditLog.findFirst({
    where: { entityId: 'finance', action: 'PERMISSION_CHANGE' }, orderBy: { timestamp: 'desc' },
  });
  assert.ok(entry, 'the change is recorded');
  assert.equal(entry.severity, 'Critical');
  const after = typeof entry.afterData === 'string' ? JSON.parse(entry.afterData) : entry.afterData;
  assert.deepEqual(after.permissions, ['score.finance']);
});

test('effectivePermissions agrees with what the endpoint reports', SKIP, async () => {
  const token = await login('admin');
  await savePermissions(token, 'finance', ['vendor.read', 'score.finance']);
  const row = (await listUsers(token)).find(u => u.username === 'finance');

  assert.deepEqual(
    row.effectivePermissions,
    effectivePermissions({ role: 'finance', permissions: row.permissions }),
    'the client computes the same thing the server does',
  );
});

test('a new account starts on its role template, with no exception stored', SKIP, async () => {
  const token = await login('admin');
  const made = await api('/api/users', {
    method: 'POST', token,
    body: { username: 'finance2', name: 'کاربر مالی دوم', role: 'finance', reasonForChange: 'استخدام' },
  });
  assert.equal(made.status, 200);

  const row = (await listUsers(token)).find(u => u.username === 'finance2');
  assert.deepEqual(row.permissions, []);
  assert.deepEqual(row.effectivePermissions, roleTemplate('finance'));
  assert.equal(row.mustChangePassword, true, 'the shared default password must be changed on first sign-in');
});

test('an administrator cannot lock themselves out of their own account', SKIP, async () => {
  const token = await login('admin');

  const demote = await api('/api/users/admin', {
    method: 'PATCH', token, body: { role: 'finance', reasonForChange: 'تست' },
  });
  assert.equal(demote.status, 400);

  const deactivate = await api('/api/users/admin', {
    method: 'PATCH', token, body: { isActive: false, reasonForChange: 'تست' },
  });
  assert.equal(deactivate.status, 400);

  const removal = await api('/api/users/admin', { method: 'DELETE', token });
  assert.equal(removal.status, 400);
});

test('a reset password is temporary and the default is refused as one', SKIP, async () => {
  const token = await login('admin');

  const lazy = await api('/api/users/finance/reset-password', {
    method: 'POST', token, body: { newPassword: '123456' },
  });
  assert.equal(lazy.status, 400, 'the shared default cannot be handed out as a reset');

  const reset = await api('/api/users/finance/reset-password', {
    method: 'POST', token, body: { newPassword: 'Temp-2026!', reasonForChange: 'فراموشی رمز' },
  });
  assert.equal(reset.status, 200);

  const row = await db().user.findUnique({ where: { username: 'finance' } });
  assert.equal(row.mustChangePassword, true, 'and the account must change it at the next sign-in');
});

test('a deactivated account cannot sign in, and comes back when reactivated', SKIP, async () => {
  const token = await login('admin');

  assert.equal((await api('/api/users/finance', {
    method: 'PATCH', token, body: { isActive: false, reasonForChange: 'مرخصی بلندمدت' },
  })).status, 200);

  const refused = await api('/api/auth/login', { method: 'POST', body: { username: 'finance', password: '123' } });
  assert.ok(refused.status >= 400, 'a disabled account is refused at the door');

  assert.equal((await api('/api/users/finance', {
    method: 'PATCH', token, body: { isActive: true, reasonForChange: 'بازگشت' },
  })).status, 200);
  await login('finance');
});
