import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuditRecord, diffFields, AUDIT_PAYLOAD_LIMIT } from '../src/utils/auditEvents';
import {
  ALL_AUDIT_EVENTS, AUDIT_EVENTS, AUDIT_ACTION_LABELS, AUDIT_MODULE_LABELS,
  describeEvent, type AuditEvent,
} from '../src/utils/auditTaxonomy';

/**
 * The rules of the trail, tested where they live.
 *
 * Each of these fixes a behaviour measured on a live server before the rewrite:
 * a deleted source stored its whole record, a re-saved risk assessment stored
 * two identical copies of an unchanged assessment, and every call site invented
 * its own wording. The policy is now one pure function, so it can be held to
 * those rules without a database.
 */

const built = (input: Parameters<typeof buildAuditRecord>[0]) => buildAuditRecord(input)!;

test('an edit that changed nothing writes no row at all', () => {
  // The trail used to say «ویرایش پارامترهای FMEA» about a save in which every
  // single field was byte-identical to the one before it.
  assert.equal(buildAuditRecord({
    event: 'risk.assessed',
    entity: { id: 'V1', name: 'فروشندهٔ الف' },
    changes: [{ field: 'rpn', from: 12, to: 12 }, { field: 'riskLevel', from: 'Low', to: 'Low' }],
  }), null);

  // …and one that did change something is recorded.
  const real = built({
    event: 'risk.assessed',
    entity: { id: 'V1', name: 'فروشندهٔ الف' },
    changes: [{ field: 'rpn', from: 12, to: 18 }],
  });
  assert.match(real.description!, /RPN 12 ← 18/);
});

test('empty, null and absent are the same value, so they are not a change', () => {
  // The source form posts `''` where the record holds null. Treating that as an
  // edit would fill the trail with rows nobody caused.
  assert.equal(buildAuditRecord({
    event: 'source.updated',
    entity: { id: 'V1', name: 'الف' },
    changes: [{ field: 'irc', from: null, to: '' }, { field: 'city', from: undefined, to: null }],
  }), null);
});

test('a sign-in is recorded even though it changes no field', () => {
  const row = built({ event: 'auth.login', entity: { id: 'admin', name: 'مدیر سیستم' } });
  assert.equal(row.action, 'LOGIN');
  assert.equal(row.result, 'Success');
  assert.equal(row.description, 'ورود به سامانه');
});

test('a deletion carries the identity and nothing else', () => {
  // The old record dumped the whole source — id, scores, logs, analysis records
  // — into `before_data`. What an auditor needs is who deleted what, and when.
  const row = built({
    event: 'source.deleted',
    entity: { type: 'Source', id: 'V6', name: 'پاراستامول / فروشندهٔ الف' },
    reason: 'تکراری با سورس V-112',
  });
  assert.equal(row.beforeData, null, 'no copy of the deleted record');
  assert.equal(row.afterData, null, 'and nothing on the other side either');
  assert.equal(row.entityId, 'V6');
  assert.equal(row.entityName, 'پاراستامول / فروشندهٔ الف');
  assert.match(row.description!, /حذف شد/);
  assert.match(row.description!, /تکراری با سورس V-112/);
});

test('forbidden fields never reach the record, however they are passed', () => {
  const row = built({
    event: 'user.updated',
    entity: { id: 'qa', name: 'سارا احمدی' },
    changes: [
      { field: 'name', from: 'سارا', to: 'سارا احمدی' },
      { field: 'passwordHash', from: 'aaa', to: 'bbb' },
      { field: 'password_salt', from: '1', to: '2' },
    ],
    facts: { token: 'ey.J', fileDataUrl: 'data:application/pdf;base64,AAA', note: 'ok' },
  });
  const stored = JSON.stringify(row.afterData);
  for (const banned of ['passwordHash', 'password_salt', 'aaa', 'bbb', 'token', 'ey.J', 'base64']) {
    assert.ok(!stored.includes(banned), `${banned} must not be stored`);
  }
  assert.ok(stored.includes('سارا احمدی'), 'the real change survives');
  assert.ok(stored.includes('ok'), 'so do the harmless facts');
});

test('diffFields reports only the fields asked for, and only when they moved', () => {
  const before = { name: 'الف', country: 'Turkey', updatedAt: '2026-01-01', passwordHash: 'x' };
  const after = { name: 'الف', country: 'India', updatedAt: '2026-02-02', passwordHash: 'y' };

  const changes = diffFields(before, after, ['name', 'country', 'updatedAt', 'passwordHash']);
  assert.deepEqual(changes, [{ field: 'country', from: 'Turkey', to: 'India' }],
    'unchanged fields, and forbidden ones, are left out — `updatedAt` moving is not something a person did');
});

test('an oversized payload is cut where the reader can see it', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({
    field: `field_${i}`, from: 'مقدار قدیمی طولانی برای پر کردن حجم', to: 'مقدار تازه',
  }));
  const row = built({ event: 'source.updated', entity: { id: 'V1', name: 'الف' }, changes: many });
  const payload = row.afterData as { changes: unknown[]; truncated?: string };

  assert.ok(JSON.stringify(payload.changes).length <= AUDIT_PAYLOAD_LIMIT, 'inside the ceiling');
  assert.ok(payload.changes.length < many.length, 'so something was dropped');
  assert.match(payload.truncated!, /ثبت نشد/, 'and the row says so rather than pretending');
});

test('every event names a module and an action the filters already know', () => {
  // A row whose module or action is a spelling nothing else uses is a row the
  // filter cannot find — the exact failure `auditTaxonomy` was written for.
  for (const event of ALL_AUDIT_EVENTS) {
    const def = AUDIT_EVENTS[event];
    assert.ok(AUDIT_MODULE_LABELS[def.module], `${event} → module «${def.module}» has no label`);
    assert.ok(AUDIT_ACTION_LABELS[def.action], `${event} → action «${def.action}» has no label`);
    assert.ok(def.label.trim().length > 0, `${event} has no name for the filter list`);
  }
});

test('every event produces a Persian sentence, with or without context', () => {
  for (const event of ALL_AUDIT_EVENTS) {
    const bare = describeEvent(event);
    const full = describeEvent(event, {
      entityName: 'رکورد نمونه',
      changes: [{ field: 'status', from: 'الف', to: 'ب' }],
      facts: { qcCode: 'QC-1', decision: 'Pass', rows: 12, verdict: 'تأیید', permission: 'vendor.decide' },
      reason: 'دلیل آزمایشی',
    });
    for (const [name, text] of [['بدون داده', bare], ['با داده', full]] as const) {
      assert.ok(text.trim().length > 0, `${event} (${name}) → جملهٔ خالی`);
      assert.ok(!text.includes('undefined') && !text.includes('null'),
        `${event} (${name}) → «${text}»`);
      assert.ok(!/\bobject Object\b/.test(text), `${event} (${name}) → «${text}»`);
    }
  }
});

test('the vocabulary is closed: an unknown event is refused', () => {
  assert.throws(
    () => buildAuditRecord({ event: 'source.exploded' as AuditEvent, entity: { id: 'V1' } }),
    /رویداد ممیزی ناشناخته/,
  );
});

test('the sentence names what changed, not how many bytes moved', () => {
  const scored = built({
    event: 'source.scored',
    entity: { id: 'V1', name: 'فروشندهٔ الف' },
    changes: [
      { field: 'totalSPS', from: 87.4, to: 92.4 },
      { field: 'grade', from: 'B', to: 'A' },
      { field: 'commercialScore', from: 80, to: 90 },
    ],
  });
  assert.match(scored.description!, /SPS 87\.4 ← 92\.4/);
  assert.match(scored.description!, /گرید B ← A/);

  const lab = built({
    event: 'lab.result_added',
    entity: { id: 'V1', name: 'فروشندهٔ الف' },
    facts: { qcCode: 'QC-77', decision: 'Pass' },
  });
  assert.match(lab.description!, /QC-77/);
  assert.match(lab.description!, /Pass/);

  const denied = built({
    event: 'access.denied',
    entity: { id: 'V1', name: 'فروشندهٔ الف' },
    facts: { attempted: 'رد صلاحیت سورس', permission: 'vendor.decide' },
  });
  assert.equal(denied.result, 'Blocked');
  assert.equal(denied.severity, 'Critical');
  assert.match(denied.description!, /vendor\.decide/);
});
