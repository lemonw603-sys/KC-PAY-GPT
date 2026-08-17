import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  loadConfig,
  loadMigrationConfig,
  loadRuntimeDatabaseConfig,
  loadWorkerConfig
} from '../src/config.js';
import { createDatabaseConnectionOptions } from '../src/db/pool.js';

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
  assert.equal(config.database.tls.enabled, false);
  assert.equal(config.sessionEncryptionKey.length, 32);
});

test('requires verified TLS for remote production databases', () => {
  const remote = {
    ...validEnvironment(),
    NODE_ENV: 'production',
    DATABASE_URL: 'mysql://app:pass@db.internal.example:3306/pojia'
  };
  assert.throws(() => loadConfig(remote), /DATABASE_TLS: must be true/);

  const secured = loadConfig({ ...remote, DATABASE_TLS: 'true' });
  const options = createDatabaseConnectionOptions(secured.database);
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.verifyIdentity, true);
  assert.equal('ca' in options.ssl, false);

  assert.throws(() => loadConfig({
    ...remote,
    DATABASE_URL: 'mysql://app:pass@10.0.0.8:3306/pojia',
    DATABASE_TLS: 'true'
  }), /must use a DNS hostname/);

  assert.throws(() => loadConfig({
    ...remote,
    DATABASE_URL: 'mysql://db.internal.example:3306/pojia',
    DATABASE_TLS: 'true'
  }), /must include a database username/);

  assert.throws(() => loadConfig({
    ...remote,
    DATABASE_URL: 'mysql://bad%ZZ:pass@db.internal.example:3306/pojia',
    DATABASE_TLS: 'true'
  }), /valid URL percent-encoding/);

  assert.throws(() => loadConfig({
    ...remote,
    DATABASE_URL: 'mysql://app:bad%ZZ@db.internal.example:3306/pojia',
    DATABASE_TLS: 'true'
  }), /valid URL percent-encoding/);
});

test('accepts a base64 PEM CA only when database TLS is enabled', () => {
  const certificate = [
    '-----BEGIN CERTIFICATE-----',
    'fixture',
    '-----END CERTIFICATE-----'
  ].join('\n');
  const ca = Buffer.from(certificate).toString('base64');
  assert.throws(() => loadRuntimeDatabaseConfig({
    ...validEnvironment(),
    DATABASE_TLS_CA_BASE64: ca
  }), /requires DATABASE_TLS=true/);

  const database = loadRuntimeDatabaseConfig({
    ...validEnvironment(),
    DATABASE_TLS: 'true',
    DATABASE_TLS_CA_BASE64: `${ca.slice(0, 12)}\n${ca.slice(12)}`
  });
  assert.equal(createDatabaseConnectionOptions(database).ssl.ca, certificate);
});

test('migration configuration uses a separate production credential', () => {
  const shared = 'mysql://shared:pass@127.0.0.1:3306/pojia';
  assert.throws(() => loadMigrationConfig({
    NODE_ENV: 'production',
    DATABASE_URL: shared,
    MIGRATION_DATABASE_URL: shared
  }), /username separate/);

  assert.throws(() => loadMigrationConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'mysql://shared:app-pass@127.0.0.1:3306/pojia',
    MIGRATION_DATABASE_URL: 'mysql://shared:migration-pass@localhost:3306/pojia'
  }), /username separate/);

  const migration = loadMigrationConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'mysql://app:pass@127.0.0.1:3306/pojia',
    MIGRATION_DATABASE_URL: 'mysql://migrator:pass@127.0.0.1:3306/pojia'
  });
  assert.equal(migration.database.url.includes('migrator'), true);
});

test('migration configuration enforces TLS for a remote production database', () => {
  const remote = {
    NODE_ENV: 'production',
    DATABASE_URL: 'mysql://app:pass@app-db.internal.example:3306/pojia',
    MIGRATION_DATABASE_URL: 'mysql://migrator:pass@migration-db.internal.example:3306/pojia'
  };
  assert.throws(() => loadMigrationConfig(remote), /MIGRATION_DATABASE_TLS: must be true/);

  const migration = loadMigrationConfig({ ...remote, MIGRATION_DATABASE_TLS: 'true' });
  assert.equal(createDatabaseConnectionOptions(migration.database).ssl.rejectUnauthorized, true);
  assert.equal(createDatabaseConnectionOptions(migration.database).ssl.verifyIdentity, true);
});

test('rejects missing database and invalid encryption key', () => {
  const env = validEnvironment();
  delete env.DATABASE_URL;
  env.SESSION_ENCRYPTION_KEY_BASE64 = 'bad';
  assert.throws(() => loadConfig(env), /Invalid v1 configuration/);
});

test('admin authentication is optional but requires a complete credential pair', () => {
  const disabled = loadConfig(validEnvironment());
  assert.equal(disabled.adminPasswordHash, null);
  assert.equal(disabled.adminSessionSecret, null);

  const passwordHash = `scrypt-v1$${Buffer.alloc(16, 2).toString('base64url')}$${Buffer.alloc(64, 3).toString('base64url')}`;
  const enabled = loadConfig({
    ...validEnvironment(),
    ADMIN_PASSWORD_HASH: passwordHash,
    ADMIN_SESSION_SECRET_BASE64: crypto.randomBytes(32).toString('base64')
  });
  assert.equal(enabled.adminPasswordHash, passwordHash);
  assert.equal(enabled.adminSessionSecret.length, 32);

  assert.throws(() => loadConfig({
    ...validEnvironment(),
    ADMIN_PASSWORD_HASH: 'configured-alone'
  }), /configured together/);
});

test('worker defaults to no provider access and keeps writes hard-locked', () => {
  const config = loadWorkerConfig(validEnvironment());
  assert.equal(config.providerReadsEnabled, false);
  assert.equal(config.providerWritesEnabled, false);
  assert.equal(config.zzshuApiKey, null);

  assert.throws(
    () => loadWorkerConfig({
      ...validEnvironment(),
      PROVIDER_READS_ENABLED: 'true'
    }),
    /ZZSHU_API_KEY is required/
  );
  assert.throws(
    () => loadWorkerConfig({
      ...validEnvironment(),
      PROVIDER_WRITES_ENABLED: 'true'
    }),
    /Provider writes remain locked/
  );
});
