/**
 * One way to write to the audit trail.
 *
 * Before this there were fifty: every route assembled its own record, wrote its
 * own Persian sentence, chose its own module spelling and decided for itself
 * what to put in `before_data`. Measured on a live server, that produced a trail
 * that was at once too big and too vague — a deleted source stored its entire
 * record (620 characters for a nearly empty one), a re-saved risk assessment
 * stored two byte-identical copies of an assessment nobody had changed, and one
 * click on «ذخیره» wrote four rows with nothing tying them together.
 *
 * `buildAuditRecord` is the whole policy, as a pure function, so the rules can
 * be tested without a database:
 *
 *   1. drop the fields that must never be written (rule 2 of the trail: a
 *      password hash or a document's base64 has no business in a log);
 *   2. keep only what actually changed;
 *   3. write nothing at all when nothing changed — an "edit" that edited
 *      nothing is a lie the trail used to tell;
 *   4. cut anything still oversized, visibly, at 2 KB.
 *
 * `recordEvent` is the thin wrapper that adds who, when and from where, and
 * hands the result to `AuditService`.
 */

import {
  AUDIT_EVENTS, describeEvent,
  type AuditEvent, type AuditEventContext, type FieldChange,
} from './auditTaxonomy.js';
import type { CreateAuditInput } from './auditService.js';
import { AuditService } from './auditService.js';
import { getClientIp, getUserAgent } from '../server/http/requestInfo.js';

/** Never written, whatever a caller passes. Matched case-insensitively. */
const FORBIDDEN = [
  'password', 'passwordhash', 'password_hash', 'passwordsalt', 'password_salt',
  'salt', 'hash', 'token', 'jwt', 'secret',
  'filedataurl', 'file_data_url', 'filedata', 'base64', 'specificationfile',
  'specificationfiledata', 'dataurl',
];

/** The ceiling for the variable part of one row. */
export const AUDIT_PAYLOAD_LIMIT = 2048;

export interface RecordEventInput {
  event: AuditEvent;
  entity?: { type?: string; id?: string | null; name?: string | null };
  changes?: FieldChange[];
  facts?: Record<string, unknown>;
  reason?: string | null;
  /** Overrides the event's own outcome — a create that was refused, say. */
  result?: 'Success' | 'Failed' | 'Blocked';
  actor?: { username?: string | null; name?: string | null; role?: string | null };
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

const isForbidden = (key: string) => {
  const flat = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return FORBIDDEN.some(banned => flat.includes(banned));
};

/** `''`, `null` and `undefined` all mean "not set", so they must not differ. */
const settled = (value: unknown) =>
  value === '' || value === undefined ? null : value;

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(settled(a)) === JSON.stringify(settled(b));

/**
 * Bookkeeping the database keeps for itself.
 *
 * An audit row is a statement about what a person did, and a timestamp the ORM
 * moved is not something a person did. Excluded here rather than left to each
 * caller, because the convenient call is `diffFields(before, after,
 * Object.keys(after))` and that is exactly the one that would log it.
 */
const NEVER_DIFFED = ['updatedat', 'createdat', 'id'];

/**
 * The changed fields between two versions of a record, and nothing else.
 *
 * Callers pass the fields worth watching rather than the whole object.
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: string[],
): FieldChange[] {
  const from = before || {};
  const to = after || {};
  const changes: FieldChange[] = [];
  for (const field of fields) {
    if (isForbidden(field)) continue;
    if (NEVER_DIFFED.includes(field.toLowerCase().replace(/[^a-z]/g, ''))) continue;
    if (sameValue(from[field], to[field])) continue;
    changes.push({ field, from: settled(from[field]) as never, to: settled(to[field]) as never });
  }
  return changes;
}

/**
 * Read a stored audit row back as "what this field was, and became".
 *
 * The history endpoints (`score-history`, `risk-history`,
 * `evaluation-history`) rebuild a timeline from the trail, and they used to do
 * it by reading whole-record copies out of `before_data` and `after_data`.
 * Those copies are exactly what the rewrite stopped writing, so the readers
 * have to understand the new shape — and the old one, because rows written
 * before the rewrite are still in the table and still belong on the timeline.
 */
export function auditRowValues(row: {
  beforeData?: unknown; afterData?: unknown;
}): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const after = (row?.afterData || {}) as Record<string, unknown>;
  const changes = Array.isArray((after as any).changes) ? (after as any).changes as FieldChange[] : null;
  if (!changes) {
    return { before: (row?.beforeData || {}) as Record<string, unknown>, after };
  }
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  for (const change of changes) {
    from[change.field] = change.from;
    to[change.field] = change.to;
  }
  // Facts sit alongside the changes and answer the same question for events
  // that are not a field edit at all.
  const facts = (after as any).facts;
  if (facts && typeof facts === 'object') Object.assign(to, facts);
  return { before: from, after: to };
}

function cleanChanges(changes?: FieldChange[]): FieldChange[] {
  return (changes || [])
    .filter(c => c && typeof c.field === 'string' && !isForbidden(c.field))
    .filter(c => !sameValue(c.from, c.to))
    .map(c => ({ field: c.field, from: settled(c.from) as never, to: settled(c.to) as never }));
}

function cleanFacts(facts?: Record<string, unknown>): Record<string, unknown> | null {
  if (!facts) return null;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (isForbidden(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

/**
 * Cut an oversized payload where a reader can see it was cut.
 *
 * A silently truncated audit record is worse than a large one: it reads as the
 * whole story. The marker says how many entries were dropped.
 */
function capped<T>(items: T[], serialize: (items: T[]) => string): { kept: T[]; dropped: number } {
  if (serialize(items).length <= AUDIT_PAYLOAD_LIMIT) return { kept: items, dropped: 0 };
  const kept = [...items];
  while (kept.length > 0 && serialize(kept).length > AUDIT_PAYLOAD_LIMIT) kept.pop();
  return { kept, dropped: items.length - kept.length };
}

export interface BuiltAuditRecord extends CreateAuditInput {
  /** The event name, persisted in the `event` column of `audit_log`. */
  event: AuditEvent;
}

/**
 * Turn an event into the record that will be stored, or into `null` when the
 * event says nothing — an edit with no changed field and no facts to report.
 * Sign-ins, refusals and downloads are marked `alwaysRecord` and survive.
 */
export function buildAuditRecord(
  input: RecordEventInput,
  now: Date = new Date(),
): BuiltAuditRecord | null {
  const def = AUDIT_EVENTS[input.event];
  if (!def) throw new Error(`رویداد ممیزی ناشناخته: ${input.event}`);

  const changes = cleanChanges(input.changes);
  const facts = cleanFacts(input.facts);
  if (!def.alwaysRecord && changes.length === 0 && !facts) return null;

  const { kept, dropped } = capped(changes, list => JSON.stringify(list));
  const payload: Record<string, unknown> = {};
  if (kept.length > 0) payload.changes = kept;
  if (dropped > 0) payload.truncated = `${dropped} تغییر دیگر ثبت نشد (سقف حجم رکورد ممیزی)`;
  if (facts) payload.facts = facts;

  const ctx: AuditEventContext = {
    entityName: input.entity?.name ?? null,
    changes,
    facts: facts || undefined,
    reason: input.reason ?? null,
  };

  return {
    event: input.event,
    auditId: `AUD-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
    correlationId: input.correlationId,
    userId: input.actor?.username || undefined,
    userName: input.actor?.name || input.actor?.username || undefined,
    role: input.actor?.role || undefined,
    module: def.module,
    entityType: input.entity?.type || def.entityType,
    entityId: input.entity?.id || undefined,
    entityName: input.entity?.name || undefined,
    action: def.action,
    severity: def.severity,
    result: input.result || def.result || 'Success',
    description: describeEvent(input.event, ctx),
    reasonForChange: input.reason || undefined,
    // Deliberately no `beforeData`: the trail stores what changed, never a copy
    // of the record. A deletion therefore carries nothing but the identity
    // already named above, which is the whole point of naming it there.
    beforeData: null,
    afterData: Object.keys(payload).length > 0 ? payload : null,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  };
}

/**
 * Record one event, taking the actor and the request's own details from the
 * Express request.
 *
 * Deliberately fire-and-forget with its own `catch`: an audit write must never
 * turn a successful save into a failed request, which is why every call site
 * today ends in `.catch(console.error)`. Putting it here means no call site can
 * forget it. The promise is returned so a test can await the write.
 */
export function recordEvent(req: any, input: RecordEventInput): Promise<void> {
  const record = buildAuditRecord({
    ...input,
    actor: input.actor ?? {
      username: req?.user?.username,
      name: req?.user?.name || req?.user?.username,
      role: req?.user?.role,
    },
    ipAddress: input.ipAddress ?? getClientIp(req),
    userAgent: input.userAgent ?? getUserAgent(req),
  });
  // Nothing changed, so there is nothing to say. The one place in this file
  // where the trail deliberately stays silent.
  if (!record) return Promise.resolve();

  return AuditService.createAuditRecord(record)
    .then(() => undefined)
    .catch(err => {
      console.error(`Audit write failed for ${record.event}:`, err);
    });
}
