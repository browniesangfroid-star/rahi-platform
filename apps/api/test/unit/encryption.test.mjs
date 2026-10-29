import test from 'node:test';
import assert from 'node:assert/strict';
import { EncryptionService } from '../../dist/crypto/encryption.service.js';

// Fixed key so the tests are deterministic (test-only key, never production).
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('encryption: round-trip, tamper rejection, legacy passthrough', () => {
  const crypto = new EncryptionService();
  const secret = 'JBSWY3DPEHPK3PXP';
  const sealed = crypto.encrypt(secret);
  assert.ok(sealed.startsWith('v1:'));
  assert.notEqual(sealed, secret);
  assert.equal(crypto.decrypt(sealed), secret);
  assert.equal(crypto.decryptMaybe(sealed), secret);
  // Same plaintext encrypts differently each time (random IV).
  assert.notEqual(crypto.encrypt(secret), sealed);
  // Tampering with the ciphertext fails authentication, never silently.
  const tampered = sealed.slice(0, -2) + 'AA';
  assert.throws(() => crypto.decrypt(tampered));
  // Pre-Phase-16 plaintext rows keep working until re-encrypted.
  assert.equal(crypto.decryptMaybe(secret), secret);
  assert.equal(crypto.decryptMaybe(null), null);
});

test('encryption: a different key cannot open the ciphertext', () => {
  const first = new EncryptionService();
  const sealed = first.encrypt('sensitive-bank-account');
  process.env.ENCRYPTION_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  const second = new EncryptionService();
  assert.throws(() => second.decrypt(sealed));
});
