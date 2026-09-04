import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { api, db, FIXTURE, login, profileBody, resetAll, SKIP, startTestServer, stopTestServer } from './helpers/apiHarness';

/**
 * One request, one chain.
 *
 * `correlationId` had a column and an index but no meaning: each handler that
 * filled it called `randomUUID()` at the moment of writing, so a request that
 * produced three records produced three chains of one. These tests hold the
 * property that makes "what else changed because of this?" answerable — every
 * record written while serving one call carries that call's identifier, and
 * records from different calls do not share one.
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

/** A save that also carries a risk assessment writes an edit record and a risk record. */
async function saveWithRisk(token: string, level: string, headers?: Record<string, string>) {
  return api('/api/vendors', {
    method: 'POST', token, headers,
    body: {
      ...profileBody({ country: 'India' }),
      id: FIXTURE.vendorId,
      riskAssessment: {
        riskLevel: level, evaluator: 'مسئول ریسک', severity: 5, occurrence: 4, detection: 3,
      },
    },
  });
}

test('the request identifier is echoed to the caller', SKIP, async () => {
  const token = await login('admin');
  const res = await api('/api/vendors', { token });
  assert.equal(res.status, 200);
  const id = res.headers.get('x-request-id');
  assert.ok(id && id.length >= 8, `expected a request id, got ${id}`);
});

test('every record written for one request shares that request\'s identifier', SKIP, async () => {
  const token = await login('admin');
  const res = await saveWithRisk(token, 'High');
  assert.equal(res.status, 200);
  const requestId = res.headers.get('x-request-id');

  // The writes are deliberately not awaited by the handler, so wait for them.
  const deadline = Date.now() + 2000;
  let rows: any[] = [];
  while (Date.now() < deadline) {
    rows = await db().auditLog.findMany({ where: { correlationId: requestId } });
    if (rows.length >= 2) break;
    await new Promise(r => setTimeout(r, 25));
  }

  assert.ok(rows.length >= 2, `expected the edit and the risk record, got ${rows.length}`);
  assert.ok(rows.some((r: any) => r.module === 'Risk Management'));
  // And nothing was written under a chain of its own.
  const all = await db().auditLog.findMany({ where: { entityId: FIXTURE.vendorId } });
  assert.ok(all.every((r: any) => r.correlationId === requestId));
});

test('two requests do not share a chain', SKIP, async () => {
  const token = await login('admin');
  const first = await saveWithRisk(token, 'High');
  const second = await saveWithRisk(token, 'Low');
  assert.notEqual(first.headers.get('x-request-id'), second.headers.get('x-request-id'));
});

test('a caller may name the request, but only with an identifier-shaped value', SKIP, async () => {
  const token = await login('admin');

  const named = await api('/api/vendors', { token, headers: { 'X-Request-Id': 'trace-abc-123' } });
  assert.equal(named.headers.get('x-request-id'), 'trace-abc-123');

  // Free text does not end up in a compliance record; the server mints its own.
  const junk = await api('/api/vendors', {
    token, headers: { 'X-Request-Id': "no' spaces; DROP TABLE audit_log" },
  });
  assert.notEqual(junk.headers.get('x-request-id'), "no' spaces; DROP TABLE audit_log");
  assert.ok((junk.headers.get('x-request-id') || '').length >= 8);

  // Too short to identify anything is refused as well.
  const tiny = await api('/api/vendors', { token, headers: { 'X-Request-Id': 'abc' } });
  assert.notEqual(tiny.headers.get('x-request-id'), 'abc');
});

test('the related endpoint returns the rest of the chain, not the record itself', SKIP, async () => {
  const token = await login('admin');
  const saved = await saveWithRisk(token, 'High');
  const requestId = saved.headers.get('x-request-id');

  const deadline = Date.now() + 2000;
  let rows: any[] = [];
  while (Date.now() < deadline) {
    rows = await db().auditLog.findMany({ where: { correlationId: requestId }, orderBy: { timestamp: 'asc' } });
    if (rows.length >= 2) break;
    await new Promise(r => setTimeout(r, 25));
  }
  assert.ok(rows.length >= 2);

  const res = await api(`/api/audit-logs/${rows[0].id}/related`, { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, rows.length - 1);
  assert.ok(res.body.data.every((r: any) => r.id !== rows[0].id));
  assert.ok(res.body.data.every((r: any) => r.correlationId === requestId));
});

test('a record with no chain relates to nothing, rather than to everything', SKIP, async () => {
  const token = await login('admin');
  const orphan = await db().auditLog.create({
    data: {
      auditId: 'AUD-ORPHAN', module: 'System', action: 'Update', severity: 'Information',
      correlationId: null, entityId: 'E-ORPHAN',
    },
  });
  // A second uncorrelated record, so "everything" would be a non-empty answer.
  await db().auditLog.create({
    data: {
      auditId: 'AUD-ORPHAN-2', module: 'System', action: 'Update', severity: 'Information',
      correlationId: null, entityId: 'E-ORPHAN-2',
    },
  });

  const res = await api(`/api/audit-logs/${orphan.id}/related`, { token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
});

test('the chain of a request is readable through the list filter too', SKIP, async () => {
  const token = await login('admin');
  const saved = await saveWithRisk(token, 'High');
  const requestId = saved.headers.get('x-request-id');

  const deadline = Date.now() + 2000;
  let res: any;
  while (Date.now() < deadline) {
    res = await api(`/api/audit-logs?correlationId=${requestId}`, { token });
    if (res.body.total >= 2) break;
    await new Promise(r => setTimeout(r, 25));
  }
  assert.ok(res.body.total >= 2);
});

test('reading a chain requires the audit permission', SKIP, async () => {
  const anon = await api('/api/audit-logs/anything/related');
  assert.equal(anon.status, 401);
});
