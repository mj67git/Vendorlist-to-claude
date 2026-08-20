import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  generateSalt,
  hashPassword,
  verifyPassword,
} from '../src/server/security/passwordService';

function legacyHashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

test('password hashing remains byte-for-byte compatible with stored legacy hashes', () => {
  const password = 'Existing-Password-123';
  const salt = '00112233445566778899aabbccddeeff';
  assert.equal(hashPassword(password, salt), legacyHashPassword(password, salt));
});

test('password verification preserves plaintext migration compatibility', () => {
  assert.equal(verifyPassword('123456', '123456'), true);
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
