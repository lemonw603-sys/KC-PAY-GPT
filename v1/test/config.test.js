import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

function validEnvironment() {
  return {
    NODE_ENV: 'test',
    PORT: '3200',
    TRUST_PROXY: 'false',
    DATABASE_URL: 'mysql://user:pass@127.0.0.1:3306/pojia_test',
    SESSION_ENCRYPTION_KEY_BASE64: crypto.randomBytes(32).toString('base64')
  };
}

test('loads a valid explicit configuration', () => {
  const config = loadConfig(validEnvironment());
  assert.equal(config.port, 3200);
  assert.equal(config.trustProxy, false);
  assert.equal(config.sessionEncryptionKey.length, 32);
});

test('rejects missing database and invalid encryption key', () => {
  const env = validEnvironment();
  delete env.DATABASE_URL;
  env.SESSION_ENCRYPTION_KEY_BASE64 = 'bad';
  assert.throws(() => loadConfig(env), /Invalid v1 configuration/);
});
