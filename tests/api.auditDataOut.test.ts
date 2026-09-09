import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { api, db, login, resetAll, SKIP, startTestServer, stopTestServer } from './helpers/apiHarness';

/**
 * The one door the browser has into the audit trail.
 *
 * Exports and prints happen entirely in the page — the rows are already there
 * and no request produces the file — so the browser has to report them or the
 * only act that carries regulated data out of the company leaves no trace.
 * That concession is worth exactly three event names and nothing more, which is
 * what these hold it to: `POST /api/audit-logs` used to accept any record at
 * all from any signed-in client, and it is not coming back through this route.
 */

async function waitForRow(where: any) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const row = await db().auditLog.findFirst({ where, orderBy: { timestamp: 'desc' } });
    if (row) return row;
    await new Promise(r => setTimeout(r, 25));
  }
  return null;
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

test('an export is recorded with what left and how much of it', SKIP, async () => {
  const token = await login('admin');
  const res = await api('/api/audit/events', {
    method: 'POST', token,
    body: { event: 'data.exported', label: 'شرکای تجاری', rows: 42 },
  });
  assert.equal(res.status, 200);

  const row = await waitForRow({ event: 'data.exported' });
  assert.ok(row, 'the export is on the trail');
  assert.equal(row.userId, 'admin', 'attributed to whoever took the file');
  assert.match(row.description, /شرکای تجاری/);
  assert.match(row.description, /42/);
});

test('the client cannot author anything but a data-out event', SKIP, async () => {
  const token = await login('admin');
  for (const event of ['source.deleted', 'user.permissions_changed', 'auth.login', 'nonsense']) {
    const res = await api('/api/audit/events', {
      method: 'POST', token, body: { event, label: 'تلاش' },
    });
    assert.equal(res.status, 400, `${event} must be refused`);
  }
  assert.equal(await db().auditLog.count({ where: { entityName: 'تلاش' } }), 0);
});

test('the caller supplies a label and a count, not a record', SKIP, async () => {
  // Severity, module, action and the sentence all come from the vocabulary, so
  // a caller cannot file its export as an Information-level login.
  const token = await login('admin');
  await api('/api/audit/events', {
    method: 'POST', token,
    body: {
      event: 'data.exported', label: 'آرشیو', rows: 'همه',
      severity: 'Information', module: 'احراز هویت', description: 'ورود به سامانه',
      userId: 'someone-else', beforeData: { secret: 1 },
    },
  });

  const row = await waitForRow({ event: 'data.exported' });
  assert.equal(row.severity, 'Warning');
  assert.equal(row.module, 'Data Export');
  assert.equal(row.userId, 'admin');
  assert.equal(row.beforeData, null);
  assert.equal(row.description, 'خروجی اکسل «آرشیو»', 'a non-numeric count is dropped, not printed');
});

test('a signed-out caller cannot report anything', SKIP, async () => {
  const res = await api('/api/audit/events', {
    method: 'POST', body: { event: 'data.exported', label: 'بدون ورود' },
  });
  assert.equal(res.status, 401);
});
