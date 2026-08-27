import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  isEnvTrue,
  loadBarkNotificationConfig,
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
    SESSION_ENCRYPTION_KEY_BASE64: crypto.randomBytes(32).toString('base64'),
    CDK_HASH_KEY_V1_BASE64: crypto.randomBytes(32).toString('base64'),
    CDK_RECOVERY_KEY_BASE64: crypto.randomBytes(32).toString('base64')
  };
}

test('loads a valid explicit configuration', () => {
  const config = loadConfig(validEnvironment());
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3200);
  assert.equal(config.trustProxy, false);
  assert.equal(config.database.tls.enabled, false);
  assert.equal(config.sessionEncryptionKey.length, 32);
});

test('CDK delivery recipient HMAC key is optional but independent when configured', () => {
  const environment = validEnvironment();
  const key = crypto.randomBytes(32).toString('base64');
  const config = loadConfig({ ...environment, CDK_DELIVERY_HMAC_KEY_BASE64: key });
  assert.equal(config.cdkDeliveryHmacKey.length, 32);
  assert.throws(() => loadConfig({
    ...environment,
    CDK_DELIVERY_HMAC_KEY_BASE64: environment.CDK_HASH_KEY_V1_BASE64
  }), /must be independent/);
  assert.throws(() => loadConfig({
    ...environment,
    CDK_DELIVERY_HMAC_KEY_BASE64: Buffer.alloc(16).toString('base64')
  }), /exactly 32 bytes/);
});

test('payment reference HMAC key is optional, 32-byte, and independently scoped', () => {
  const environment = validEnvironment();
  const key = crypto.randomBytes(32).toString('base64');
  const config = loadConfig({ ...environment, PAYMENT_REFERENCE_HMAC_KEY_BASE64: key });
  assert.equal(config.paymentReferenceHmacKey.length, 32);
  assert.throws(() => loadConfig({
    ...environment,
    PAYMENT_REFERENCE_HMAC_KEY_BASE64: environment.CDK_HASH_KEY_V1_BASE64
  }), /must be independent/);
  assert.throws(() => loadConfig({
    ...environment,
    PAYMENT_REFERENCE_HMAC_KEY_BASE64: Buffer.alloc(16).toString('base64')
  }), /exactly 32 bytes/);
});

test('production web server only binds an explicit loopback address', () => {
  const production = {
    ...validEnvironment(),
    NODE_ENV: 'production'
  };

  assert.equal(loadConfig(production).host, '127.0.0.1');
  assert.equal(loadConfig({ ...production, HOST: '::1' }).host, '::1');
  assert.throws(
    () => loadConfig({ ...production, HOST: '0.0.0.0' }),
    /must use a loopback address in production/
  );
  assert.throws(
    () => loadConfig({ ...production, HOST: 'localhost' }),
    /must be an explicit IPv4 or IPv6 address/
  );
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

test('requires independent CDK hashing and recovery keys', () => {
  const shared = crypto.randomBytes(32).toString('base64');
  assert.throws(() => loadConfig({
    ...validEnvironment(),
    CDK_HASH_KEY_V1_BASE64: shared,
    CDK_RECOVERY_KEY_BASE64: shared
  }), /must be independent/);
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
  assert.equal(config.workerConcurrency, 1);
  assert.equal(config.providerReadsEnabled, false);
  assert.equal(config.providerWritesEnabled, false);
  assert.equal(config.providerCardWritesEnabled, false);
  assert.equal(config.providerRechargeWritesEnabled, false);
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
      PROVIDER_READS_ENABLED: 'true',
      ZZSHU_API_KEY: 'test-key'
    }),
    /HNSKJ_API_KEY is required/
  );
  assert.throws(
    () => loadWorkerConfig({
      ...validEnvironment(),
      PROVIDER_WRITES_ENABLED: 'true'
    }),
    /Provider writes remain locked/
  );
});

test('worker concurrency is bounded and must be an integer', () => {
  assert.equal(loadWorkerConfig({ ...validEnvironment(), WORKER_CONCURRENCY: '8' }).workerConcurrency, 8);
  for (const value of ['0', '-1', '33', '1.5', 'not-a-number']) {
    assert.throws(
      () => loadWorkerConfig({ ...validEnvironment(), WORKER_CONCURRENCY: value }),
      /Invalid v1 worker configuration/
    );
  }
});

test('Bark notifications are fail-closed and require a device key only when enabled', () => {
  const disabled = loadBarkNotificationConfig({ ...validEnvironment(), BARK_DEVICE_KEY: '' });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.deviceKey, null);
  assert.equal(disabled.serverUrl, 'https://api.day.app');

  assert.throws(() => loadBarkNotificationConfig({
    ...validEnvironment(), BARK_ENABLED: 'true'
  }), /BARK_DEVICE_KEY: is required/);

  const enabled = loadBarkNotificationConfig({
    ...validEnvironment(),
    BARK_ENABLED: 'true',
    BARK_DEVICE_KEY: 'fixture-key',
    BARK_SERVER_URL: 'https://bark.example.test/'
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.serverUrl, 'https://bark.example.test');
  assert.equal(enabled.deviceKey, 'fixture-key');
});

test('write gates normalize case and surrounding whitespace', () => {
  assert.equal(isEnvTrue(' TRUE '), true);
  assert.equal(isEnvTrue('True'), true);
  assert.equal(isEnvTrue(' false '), false);
  assert.equal(isEnvTrue(undefined), false);
});
