import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { decryptSecret, encryptSecret } from '../src/security/secret-box.js';

test('encrypts and decrypts a Session payload', () => {
  const key = crypto.randomBytes(32);
  const source = JSON.stringify({ accessToken: 'sensitive', account: { id: 'acct-1' } });
  const encrypted = encryptSecret(source, key);

  assert.notEqual(encrypted.toString('utf8'), source);
  assert.equal(decryptSecret(encrypted, key), source);
});

test('fails closed with a different key', () => {
  const encrypted = encryptSecret('secret', crypto.randomBytes(32));
  assert.throws(() => decryptSecret(encrypted, crypto.randomBytes(32)));
});
