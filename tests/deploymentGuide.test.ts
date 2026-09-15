import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ALL_PERMISSIONS } from '../src/utils/permissions';

/**
 * The numbers in the IT guide are facts about the code, so the code checks them.
 *
 * The guide told the IT department the system has «۳۴ مجوز» while
 * `ALL_PERMISSIONS` had thirty-five — and it had thirty-five at the previous
 * release too, so the sentence had been wrong through a delivery. The list of
 * names printed underneath it was right the whole time; only the count anyone
 * would quote was wrong.
 *
 * A number kept by hand in prose drifts from the code it describes. This is the
 * same arrangement the reset script's table list already has: the document is
 * compared with the thing it documents, and a change that forgets the document
 * fails here rather than in front of a customer.
 */

const GUIDE = readFileSync(new URL('../IT_DEPLOYMENT_GUIDE.md', import.meta.url), 'utf8');

/** Persian digits, as the guide writes every number. */
function fromPersian(digits: string): number {
  return Number(digits.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))));
}

test('the guide states the number of permissions the code actually has', () => {
  const stated = [...GUIDE.matchAll(/\*\*([۰-۹]+) مجوز\*\*|همهٔ ([۰-۹]+) مجوز/g)]
    .map(m => fromPersian(m[1] ?? m[2]));

  assert.ok(stated.length >= 2, 'the guide should state the count where it lists the permissions and where it describes the admin role');
  for (const n of stated) {
    assert.equal(n, ALL_PERMISSIONS.length,
      `the guide says ${n} permissions; the code has ${ALL_PERMISSIONS.length}`);
  }
});

test('the guide lists exactly the permissions the code defines', () => {
  // The block between the «فهرست کامل» heading and the note about retired
  // names — the retired ones are deliberately outside it.
  const start = GUIDE.indexOf('فهرست کامل');
  const end = GUIDE.indexOf('نام‌های بازنشسته', start);
  assert.ok(start > 0 && end > start, 'the permission list section should still be in the guide');

  const listed = new Set(
    [...GUIDE.slice(start, end).matchAll(/`([a-z-]+\.[a-z-]+)`/g)].map(m => m[1]),
  );
  const defined = new Set<string>(ALL_PERMISSIONS);

  const missing = [...defined].filter(p => !listed.has(p));
  const extra = [...listed].filter(p => !defined.has(p));
  assert.deepEqual(missing, [], `permissions the guide does not mention: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `permissions the guide invents: ${extra.join(', ')}`);
});

test('the guide states the number of migrations the repository carries', () => {
  // Same reasoning: `prisma migrate deploy` is the step the guide is most
  // insistent about, and it names a count while warning against `db push`.
  const stated = [...GUIDE.matchAll(/\*\*([۰-۹]+) مهاجرت\*\*/g)].map(m => fromPersian(m[1]));
  assert.ok(stated.length >= 1, 'the guide should still name the migration count');

  const count = readdirSync(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).length;

  for (const n of stated) {
    assert.equal(n, count, `the guide says ${n} migrations; the folder has ${count}`);
  }
});
