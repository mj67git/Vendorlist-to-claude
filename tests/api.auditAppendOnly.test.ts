import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { db, resetAll, SKIP, startTestServer, stopTestServer } from './helpers/apiHarness';
import { recordEvent } from '../src/utils/auditEvents';

/**
 * The two promises the audit table now makes to the database.
 *
 * First, every row written through `recordEvent` names its event in a column of
 * its own, so the trail can be filtered by what happened rather than by the
 * spelling of a hand-written sentence. Second, a row that exists cannot be
 * changed or removed — the guarantee an audit trail is for, and one the table
 * did not make until the append-only trigger: the application role had both
 * UPDATE and DELETE on it.
 */

/** A request as the middleware would have prepared it. */
const asAdmin = {
  user: { username: 'admin', name: 'مدیر سیستم', role: 'admin' },
  headers: {},
  socket: {},
};

before(async () => {
  await startTestServer();
});
beforeEach(async () => {
  if (process.env.DATABASE_URL) await resetAll();
});
after(async () => {
  await stopTestServer();
});

test('a recorded event stores its own name', SKIP, async () => {
  await recordEvent(asAdmin, { event: 'auth.login', entity: { id: 'admin', name: 'مدیر سیستم' } });

  const rows = await db().auditLog.findMany({ where: { event: 'auth.login' } });
  assert.equal(rows.length, 1, 'the row is findable by its event, not by its wording');
  assert.equal(rows[0].userId, 'admin');
  assert.equal(rows[0].description, 'ورود به سامانه');
});

test('a stored audit row cannot be edited or deleted', SKIP, async () => {
  await recordEvent(asAdmin, { event: 'auth.login', entity: { id: 'admin', name: 'مدیر سیستم' } });

  await assert.rejects(
    () => db().$executeRawUnsafe(`UPDATE audit_log SET description = 'چیز دیگری'`),
    /append-only/,
    'rewriting history is refused by the database itself, not by a convention in the code',
  );
  await assert.rejects(
    () => db().$executeRawUnsafe(`DELETE FROM audit_log`),
    /append-only/,
  );

  const rows = await db().auditLog.findMany();
  assert.equal(rows.length, 1, 'and the row is still there, unchanged');
  assert.equal(rows[0].description, 'ورود به سامانه');
});

test('the test harness can still start each test from an empty table', SKIP, async () => {
  await recordEvent(asAdmin, { event: 'auth.logout', entity: { id: 'admin' } });
  // TRUNCATE does not fire a row-level trigger, which is deliberate: the rule is
  // "no row is ever rewritten", not "this database can never be reset".
  await resetAll();
  assert.equal(await db().auditLog.count(), 0);
});
