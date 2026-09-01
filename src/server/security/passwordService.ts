import crypto from 'crypto';

export interface HashedPassword {
  hash: string;
  salt: string;
}

export type StoredPassword = string | HashedPassword | null | undefined;

/**
 * PBKDF2 work factor.
 *
 * The original 1000 iterations were far below what a password hash needs: a
 * measured 30 failed logins took 343ms in total, so guessing was limited by the
 * network rather than by the hash. OWASP's current guidance for
 * PBKDF2-HMAC-SHA512 is 210,000, which is what new and re-hashed passwords use.
 *
 * Existing hashes are not broken by the change. A stored hash written at the old
 * cost carries no marker, so anything unmarked is verified at 1000 iterations
 * exactly as before; new ones are stored as `pbkdf2$<iterations>$<hex>` and
 * verified at whatever cost they name. `needsRehash()` lets the login route
 * upgrade an old hash the moment the correct password proves itself, so accounts
 * migrate as people sign in and nobody is locked out or forced to reset.
 */
const CURRENT_PBKDF2_ITERATIONS = 210_000;
const LEGACY_PBKDF2_ITERATIONS = 1000;
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_DIGEST = 'sha512';
const HASH_PREFIX = 'pbkdf2$';

function derive(password: string, salt: string, iterations: number): string {
  return crypto
    .pbkdf2Sync(password, salt, iterations, PASSWORD_HASH_BYTES, PASSWORD_DIGEST)
    .toString('hex');
}

/** Hash for storage, at the current work factor and tagged with it. */
export function hashPassword(password: string, salt: string): string {
  return `${HASH_PREFIX}${CURRENT_PBKDF2_ITERATIONS}$${derive(password, salt, CURRENT_PBKDF2_ITERATIONS)}`;
}

/** Split a stored value into the cost it was written at and the digest itself. */
function parseStoredHash(stored: string): { iterations: number; digest: string } {
  if (stored.startsWith(HASH_PREFIX)) {
    const [, iterations, digest] = stored.split('$');
    const parsed = Number.parseInt(iterations, 10);
    if (Number.isFinite(parsed) && parsed > 0 && digest) {
      return { iterations: parsed, digest };
    }
  }
  // Untagged: written before the work factor was raised.
  return { iterations: LEGACY_PBKDF2_ITERATIONS, digest: stored };
}

/** True when this stored hash should be rewritten at the current work factor. */
export function needsRehash(storedPassword: StoredPassword): boolean {
  if (!storedPassword || typeof storedPassword !== 'object') return false;
  return parseStoredHash(storedPassword.hash).iterations < CURRENT_PBKDF2_ITERATIONS;
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

function constantTimeStringEquals(actualValue: string, expectedValue: unknown): boolean {
  if (typeof expectedValue !== 'string') return false;

  // UTF-8 comparison preserves the exact case-sensitive semantics of the
  // previous string equality check, including malformed stored values.
  const actual = Buffer.from(actualValue, 'utf8');
  const expected = Buffer.from(expectedValue, 'utf8');
  if (actual.length !== expected.length) return false;

  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Verify a password against a stored hash, at whatever cost that hash names.
 *
 * The plaintext branch that used to sit here is gone. It compared a submitted
 * password directly against a stored string, which is only reachable for a
 * record holding a password in the clear — a shape no row in this database has,
 * and one that must never be accepted if it appeared.
 */
export function verifyPassword(password: string, storedPassword: StoredPassword): boolean {
  if (storedPassword && typeof storedPassword === 'object') {
    const { iterations, digest } = parseStoredHash(storedPassword.hash);
    return constantTimeStringEquals(derive(password, storedPassword.salt, iterations), digest);
  }

  return false;
}
