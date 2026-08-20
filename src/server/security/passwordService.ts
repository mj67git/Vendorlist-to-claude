import crypto from 'crypto';

export interface HashedPassword {
  hash: string;
  salt: string;
}

export type StoredPassword = string | HashedPassword | null | undefined;

// Kept unchanged to preserve compatibility with all existing password hashes.
const LEGACY_PBKDF2_ITERATIONS = 1000;
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_DIGEST = 'sha512';

export function hashPassword(password: string, salt: string): string {
  return crypto
    .pbkdf2Sync(
      password,
      salt,
      LEGACY_PBKDF2_ITERATIONS,
      PASSWORD_HASH_BYTES,
      PASSWORD_DIGEST,
    )
    .toString('hex');
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
 * Supports both legacy plaintext records and the current salted hash shape.
 * Valid credentials continue to produce exactly the same boolean result while
 * hashed comparisons avoid ordinary string-comparison timing leakage.
 */
export function verifyPassword(password: string, storedPassword: StoredPassword): boolean {
  if (typeof storedPassword === 'string') {
    return storedPassword === password;
  }

  if (storedPassword && typeof storedPassword === 'object') {
    const candidateHash = hashPassword(password, storedPassword.salt);
    return constantTimeStringEquals(candidateHash, storedPassword.hash);
  }

  return false;
}
