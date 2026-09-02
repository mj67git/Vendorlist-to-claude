import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  generateSalt,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../src/server/security/passwordService';

/** How every hash in the database was written before the work factor was raised. */
function legacyHashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

test('a hash stored at the old work factor still verifies', () => {
  // Nothing migrated the database, so every existing account still holds an
  // untagged 1000-iteration hash. Rejecting those would lock out every user.
  const salt = '00112233445566778899aabbccddeeff';
  const stored = { hash: legacyHashPassword('Existing-Password-123', salt), salt };

  assert.equal(verifyPassword('Existing-Password-123', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
});

test('new hashes are written at the current work factor and say so', () => {
  const salt = generateSalt();
  const fresh = hashPassword('correct horse', salt);

  assert.match(fresh, /^pbkdf2\$210000\$[0-9a-f]{128}$/);
  assert.notEqual(fresh, legacyHashPassword('correct horse', salt));
  assert.equal(verifyPassword('correct horse', { hash: fresh, salt }), true);
});

test('needsRehash marks the old hashes and leaves current ones alone', () => {
  const salt = generateSalt();
  assert.equal(needsRehash({ hash: legacyHashPassword('x', salt), salt }), true);
  assert.equal(needsRehash({ hash: hashPassword('x', salt), salt }), false);
  assert.equal(needsRehash(undefined), false);
});

test('a password stored in the clear is never accepted', () => {
  // This used to return true: a stored string was compared directly against the
  // submitted password. No row in this database has that shape, and if one ever
  // appeared it must not be a way in.
  assert.equal(verifyPassword('123456', '123456'), false);
  assert.equal(verifyPassword('incorrect', '123456'), false);
});

test('password verification accepts the existing hash shape and rejects mismatches', () => {
  const salt = generateSalt();
  const stored = { hash: hashPassword('correct horse', salt), salt };

  assert.equal(verifyPassword('correct horse', stored), true);
  assert.equal(verifyPassword('wrong horse', stored), false);
  assert.equal(
    verifyPassword('correct horse', { ...stored, hash: stored.hash.toUpperCase() }),
    false,
  );
  assert.equal(verifyPassword('anything', undefined), false);
});
