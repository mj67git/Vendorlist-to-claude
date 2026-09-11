import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A delivered installation starts empty.
 *
 * The startup path seeded seven sample business partners into any database
 * whose partner table was empty. Two things were wrong with that. A new
 * production installation came up already holding real company names — BASF,
 * Lonza, Sinoway — that nobody at the site had entered, sitting in the same
 * repository as the genuine records. And `./deploy/reset-data.sh --all` was
 * undone by the next container restart, which put all seven back, so an
 * administrator who had just cleared the database found it repopulated and had
 * no way to tell why.
 *
 * The seeding is now opt-in. This holds it that way: the check must come
 * before any database call, or an empty production database gets the demo rows
 * again.
 */

const source = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'server', 'repositories', 'partnerRepository.ts'),
  'utf8',
);

const body = source.slice(source.indexOf('export async function seedDefaultBusinessPartners'));

test('demo partners are seeded only when explicitly asked for', () => {
  assert.match(body, /VLSE_SEED_DEMO_DATA !== "true"\) return;/);
});

test('the opt-out happens before the database is touched', () => {
  const guard = body.indexOf('VLSE_SEED_DEMO_DATA');
  const firstDbCall = body.indexOf('requirePrisma()');
  assert.ok(guard > -1 && firstDbCall > -1);
  assert.ok(guard < firstDbCall, 'the environment check must come first');
});

test('the reset script and the seeding agree about what a clean database is', () => {
  // If seeding were unconditional, --all would be undone on the next restart.
  const script = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'deploy', 'reset-data.sh'),
    'utf8',
  );
  assert.ok(script.includes('business_partners'));
  assert.match(body, /VLSE_SEED_DEMO_DATA/);
});
