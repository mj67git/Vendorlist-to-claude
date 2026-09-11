import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The reset script names its tables in SQL, and SQL does not know when the
 * schema grows.
 *
 * `deploy/reset-data.sh` is the one supported way to empty a database before
 * handover, and it works by naming every table it truncates. Add a table to
 * `schema.prisma` and nothing tells the script about it: the reset keeps
 * reporting success while leaving rows behind — the quiet half-empty database
 * nobody inspects because the script said «✔ انجام شد».
 *
 * So the list is checked against the schema rather than trusted.
 */

const root = path.join(import.meta.dirname, '..');
const script = fs.readFileSync(path.join(root, 'deploy', 'reset-data.sh'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');

/** Physical table names, the way Prisma spells them for PostgreSQL. */
function schemaTables(): string[] {
  return [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map(m => m[1]).sort();
}

/** The tables one of the script's two lists names. */
function scriptList(variable: 'DATA_TABLES' | 'AUDIT_TABLES'): string[] {
  const line = script.match(new RegExp(`^${variable}="([^"]*)"`, 'm'));
  assert.ok(line, `${variable} در اسکریپت پیدا نشد`);
  return line[1].split(',').map(s => s.trim()).filter(Boolean).sort();
}

test('a full reset covers every table the schema defines, except users', () => {
  // Accounts survive deliberately: a database nobody can sign in to is not a
  // clean installation, it is a broken one.
  const expected = schemaTables().filter(t => t !== 'users');
  assert.deepEqual(scriptList('DATA_TABLES'), expected);
});

test('the reset never names the users table', () => {
  assert.ok(!scriptList('DATA_TABLES').includes('users'));
  assert.ok(!scriptList('AUDIT_TABLES').includes('users'));
});

test('both modes clear the audit trail, which is what was asked for', () => {
  assert.deepEqual(scriptList('AUDIT_TABLES'), ['audit_log']);
  assert.ok(scriptList('DATA_TABLES').includes('audit_log'));
});

test('it truncates rather than deletes, because the trail refuses deletes', () => {
  // The append-only trigger from migration 20260909100000 rejects a row DELETE
  // even from the database owner. A reset written with DELETE would fail at the
  // last table, after clearing everything else.
  assert.match(script, /TRUNCATE TABLE .* RESTART IDENTITY CASCADE/);
  assert.ok(!/DELETE\s+FROM/i.test(script));
});

test('it refuses to run without an explicit mode', () => {
  // No default: «./deploy/reset-data.sh» with no argument must not be able to
  // wipe anything.
  assert.match(script, /MODE="\$\{1:-\}"/);
  assert.match(script, /exit 2/);
});
