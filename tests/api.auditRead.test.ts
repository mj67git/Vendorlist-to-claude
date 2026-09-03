import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, resetDatabase, api, login, db, SKIP } from './helpers/apiHarness';

/**
 * The read path of the change trail.
 *
 * These exist because the list, the search, the counters and the filter
 * options were four different code paths over the same table, and three of
 * them read the whole table to answer a small question. The behaviour they
 * must keep is: the same filters mean the same thing everywhere, and `total`
 * is the number of matching records rather than the size of some internal cap.
 */

const ROWS = 240;

async function seedLogs() {
  const p = db();
  const rows = Array.from({ length: ROWS }, (_, i) => ({
    auditId: `AUD-${i}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    userId: i % 2 === 0 ? 'u-even' : 'u-odd',
    userName: i % 2 === 0 ? 'کاربر زوج' : 'کاربر فرد',
    role: 'admin',
    module: i % 3 === 0 ? 'Laboratory' : 'Source Management',
    entityId: `E-${i % 5}`,
    entityName: i === 7 ? 'ماده نشانه‌دار' : `رکورد ${i}`,
    action: i % 3 === 0 ? 'Delete' : 'Update',
    severity: i % 10 === 0 ? 'Critical' : i % 5 === 0 ? 'Warning' : 'Information',
    result: i % 20 === 0 ? 'Blocked' : i % 30 === 0 ? 'Failed' : 'Success',
    description: i === 7 ? 'یک توضیح یکتا برای جست‌وجو' : 'توضیح عادی',
  }));
  await p.auditLog.createMany({ data: rows });
}

/*
 * One login for the file, taken before the fixture is laid down.
 *
 * Logging in writes a record of its own, so a login inside a test would leave
 * an extra row in the table the test is counting. The token outlives the
 * truncation — it is a signature, not a session row — so the trail each test
 * reads holds exactly the records it seeded.
 */
let token = '';

before(async () => {
  if (!SKIP) {
    await startTestServer();
    token = await login('admin');
    // The login handler writes its own record without awaiting it. Wait for it
    // to land here, otherwise it can arrive *after* the truncation below and
    // add a row to the trail a test is counting.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && (await db().auditLog.count()) === 0) {
      await new Promise(r => setTimeout(r, 25));
    }
  }
});
after(async () => {
  if (!SKIP) await stopTestServer();
});
beforeEach(async () => {
  if (!SKIP) {
    await resetDatabase();
    await seedLogs();
  }
});

test('the list pages in SQL and reports the full count', SKIP, async () => {
  const first = await api(`/api/audit-logs?page=1&limit=20`, { token });
  assert.equal(first.status, 200);
  assert.equal(first.body.total, ROWS);
  assert.equal(first.body.data.length, 20);

  const second = await api(`/api/audit-logs?page=2&limit=20`, { token });
  assert.equal(second.body.data.length, 20);
  // Distinct pages, not the same page twice.
  const overlap = second.body.data.filter((r: any) =>
    first.body.data.some((f: any) => f.id === r.id),
  );
  assert.equal(overlap.length, 0);
});

test('a search reports how many records matched, not an internal cap', SKIP, async () => {
  // `توضیح` appears in every seeded description, so the match count is larger
  // than the 100-row cap the old search path applied before paging in memory.
  const res = await api(`/api/audit-logs?query=${encodeURIComponent('توضیح')}&page=1&limit=20`, { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, ROWS);
  assert.equal(res.body.data.length, 20);

  // And it can reach a page that lies beyond that old cap.
  const deep = await api(`/api/audit-logs?query=${encodeURIComponent('توضیح')}&page=8&limit=20`, { token });
  assert.equal(deep.body.data.length, 20);
});

test('a search narrows to the matching record', SKIP, async () => {
  const res = await api(`/api/audit-logs?query=${encodeURIComponent('یکتا')}`, { token });
  assert.equal(res.body.total, 1);
  assert.equal(res.body.data[0].entityName, 'ماده نشانه‌دار');
});

test('a search and a filter both apply, rather than the search widening the filter', SKIP, async () => {
  const res = await api(
    `/api/audit-logs?query=${encodeURIComponent('توضیح')}&severity=Critical`,
    { token },
  );
  assert.equal(res.body.total, 24);
  assert.ok(res.body.data.every((r: any) => r.severity === 'Critical'));
});

test('a search respects the date range', SKIP, async () => {
  const res = await api(
    `/api/audit-logs?query=${encodeURIComponent('توضیح')}` +
      `&startDate=${encodeURIComponent(new Date(Date.UTC(2026, 0, 1, 0, 0, 200)).toISOString())}`,
    { token },
  );
  assert.equal(res.body.total, 40);
});

test('the counters are computed over the whole table', SKIP, async () => {
  const res = await api('/api/audit-logs/stats', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, ROWS);
  assert.equal(res.body.critical, 24);
  assert.equal(res.body.warning, 24);
  // Exactly the two distinct actors seeded.
  assert.equal(res.body.activeUsers, 2);
});

test('the overview counts refusals and today separately from severity', SKIP, async () => {
  const res = await api('/api/audit-logs/stats', { token });
  // Severity and result answer different questions, and the counts prove it:
  // these rows are not the same rows as the critical ones.
  assert.equal(res.body.blocked, 12);
  assert.equal(res.body.failed, 4);
  // Everything seeded is dated 1 January 2026, so nothing lands in today.
  assert.equal(res.body.today, 0);
});

test('today counts what was written today, not what was written at all', SKIP, async () => {
  await db().auditLog.create({
    data: {
      auditId: 'AUD-TODAY', module: 'System', action: 'Update',
      severity: 'Information', result: 'Success', timestamp: new Date(),
    },
  });
  const res = await api('/api/audit-logs/stats', { token });
  assert.equal(res.body.today, 1);
  assert.equal(res.body.total, ROWS + 1);
});

test('the filter options list every distinct value once', SKIP, async () => {
  const res = await api('/api/audit-logs/filters', { token });
  assert.equal(res.status, 200);
  assert.ok(res.body.uniqueUsers.includes('کاربر زوج'));
  assert.ok(res.body.uniqueUsers.includes('کاربر فرد'));
  assert.equal(new Set(res.body.uniqueUsers).size, res.body.uniqueUsers.length);
  assert.ok(res.body.uniqueModules.includes('Laboratory'));
  assert.ok(res.body.uniqueModules.includes('Source Management'));
  assert.equal(new Set(res.body.uniqueModules).size, res.body.uniqueModules.length);
});

test('reading the trail requires the audit permission', SKIP, async () => {
  const anon = await api('/api/audit-logs');
  assert.equal(anon.status, 401);
});
