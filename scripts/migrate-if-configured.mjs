#!/usr/bin/env node
/**
 * Applies pending Prisma migrations during the build, but only when a database
 * is actually configured.
 *
 * Why this exists: nothing else runs migrations. The Dockerfile has no
 * entrypoint and Vercel's build step only compiled the app, so a fresh
 * deployment came up pointing at a database with no tables and every route
 * returned 500. Putting `prisma migrate deploy` in the build fixes that.
 *
 * Why it is conditional: builds happen where no database exists — a plain
 * `npm run build` on a laptop, and preview deployments that were never given a
 * DATABASE_URL. An unconditional migrate would fail all of those, turning a
 * missing environment variable into a broken build. So a build without a
 * database still succeeds and simply says the step was skipped.
 *
 * What is NOT forgiven: if a database IS configured and the migration fails,
 * this exits non-zero and takes the build down with it. Shipping an app whose
 * schema does not match its code is worse than not shipping.
 *
 * Why it retries: serverless Postgres scales to zero. Neon suspends the compute
 * after a few minutes idle and wakes it on the next connection, which takes
 * longer than the client is willing to wait, so the first attempt comes back
 * P1001 "Can't reach database server" and the build dies on a database that is
 * merely asleep. That is exactly how the deployment of 433ef22 failed. A
 * connection failure is therefore retried with a widening gap, which wakes the
 * compute and succeeds on the next try. Anything that is not a connectivity
 * error — a failed or conflicting migration — still fails immediately, because
 * no amount of waiting fixes it.
 *
 * The URL check mirrors isValidPostgresUrl() in server.ts. It is duplicated
 * rather than imported because this runs before the server bundle is built.
 */

import { spawnSync } from 'node:child_process';

function isUsableDatabaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;

  // Placeholder values copied out of a sample .env are worse than nothing:
  // they look configured and fail deep inside the migration.
  if (
    trimmed.includes('<') ||
    trimmed.includes(':port') ||
    trimmed.includes('host:port') ||
    trimmed.includes('database_name') ||
    trimmed.includes('user:password@host')
  ) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') return false;
    if (!parsed.hostname || parsed.hostname === 'host' || parsed.hostname === 'localhost.invalid') return false;
    return true;
  } catch {
    return false;
  }
}

if (!isUsableDatabaseUrl(process.env.DATABASE_URL)) {
  console.log(
    '[migrate] No usable DATABASE_URL — skipping migrations.\n' +
      '[migrate] The build continues, but the deployed app will return 500 on every\n' +
      '[migrate] data route until a PostgreSQL DATABASE_URL is set and it is rebuilt.',
  );
  process.exit(0);
}

// A database that refuses the connection fails fast, but one that silently
// drops packets — a wrong hostname that still resolves, a firewall, a missing
// sslmode — leaves the client waiting on a TCP timeout measured in minutes.
// That turns a mistyped connection string into a build that appears to hang.
// Bounded here so it always ends in a readable error instead. Migrating this
// schema takes seconds, so the ceiling is generous.
const MIGRATE_TIMEOUT_MS = 120_000;

console.log('[migrate] DATABASE_URL found — applying pending migrations…');

// Waits without pulling in an async runtime, so the script stays a straight
// line of spawnSync calls.
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// A sleeping Neon compute answers within a few seconds of being poked, so these
// gaps are generous; a database that is genuinely down still fails the build,
// about a minute later than before.
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

const isConnectivityFailure = (text) =>
  /P1001|Can't reach database server|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Timed out fetching a new connection/i.test(text);

let result;
for (let attempt = 0; ; attempt++) {
  result = spawnSync('prisma', ['migrate', 'deploy'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: MIGRATE_TIMEOUT_MS,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (output) process.stdout.write(output);

  if (!result.error && result.status === 0) break;

  const timedOut = result.error && result.error.code === 'ETIMEDOUT';
  const retryable = timedOut || isConnectivityFailure(output);
  const delay = RETRY_DELAYS_MS[attempt];

  if (!retryable || delay === undefined) break;

  console.log(
    `[migrate] Database did not answer (attempt ${attempt + 1} of ${RETRY_DELAYS_MS.length + 1}). ` +
      `Serverless Postgres may be waking up; retrying in ${delay / 1000}s…`,
  );
  sleep(delay);
}

if (result.error && result.error.code === 'ETIMEDOUT') {
  console.error(
    `\n[migrate] Timed out after ${MIGRATE_TIMEOUT_MS / 1000}s trying to reach the database.\n` +
      '[migrate] The connection string is probably wrong or the database is unreachable.\n' +
      '[migrate] Check DATABASE_URL: correct host, and for hosted Postgres it usually\n' +
      '[migrate] needs to end with ?sslmode=require',
  );
  process.exit(1);
}

if (result.error) {
  console.error('[migrate] Could not run the Prisma CLI:', result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error('[migrate] Migration failed. Refusing to build against a schema that does not match the code.');
  process.exit(result.status ?? 1);
}

console.log('[migrate] Database schema is up to date.');
