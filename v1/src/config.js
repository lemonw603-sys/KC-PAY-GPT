import net from 'node:net';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const databaseFields = {
  DATABASE_URL: z.string().url().startsWith('mysql://'),
  DATABASE_TLS: booleanString.default(false),
  DATABASE_TLS_CA_BASE64: z.string().trim().min(1).optional()
};

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  TRUST_PROXY: booleanString.default(false),
  ...databaseFields,
  SESSION_ENCRYPTION_KEY_BASE64: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'SESSION_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes'),
  ADMIN_PASSWORD_HASH: z.string().trim()
    .regex(/^scrypt-v1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/)
    .optional(),
  ADMIN_SESSION_SECRET_BASE64: z.string().trim().min(1).optional()
});

const runtimeDatabaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ...databaseFields
}).superRefine((value, context) => validateDatabaseConfig(value, context, {
  urlKey: 'DATABASE_URL',
  tlsKey: 'DATABASE_TLS',
  caKey: 'DATABASE_TLS_CA_BASE64'
}));

const migrationSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().startsWith('mysql://').optional(),
  MIGRATION_DATABASE_URL: z.string().url().startsWith('mysql://'),
  MIGRATION_DATABASE_TLS: booleanString.default(false),
  MIGRATION_DATABASE_TLS_CA_BASE64: z.string().trim().min(1).optional()
}).superRefine((value, context) => {
  validateDatabaseConfig(value, context, {
    urlKey: 'MIGRATION_DATABASE_URL',
    tlsKey: 'MIGRATION_DATABASE_TLS',
    caKey: 'MIGRATION_DATABASE_TLS_CA_BASE64'
  });
  const runtimeUsername = value.DATABASE_URL ? databaseUsername(value.DATABASE_URL) : null;
  const migrationUsername = databaseUsername(value.MIGRATION_DATABASE_URL);
  if (value.DATABASE_URL && runtimeUsername === null) {
    context.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'credentials must use valid URL percent-encoding'
    });
  } else if (value.NODE_ENV === 'production' && value.DATABASE_URL && !runtimeUsername) {
    context.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'must include a database username in production'
    });
  }
  if (
    value.NODE_ENV === 'production'
    && value.DATABASE_URL
    && runtimeUsername !== null
    && migrationUsername !== null
    && runtimeUsername === migrationUsername
  ) {
    context.addIssue({
      code: 'custom',
      path: ['MIGRATION_DATABASE_URL'],
      message: 'must use a username separate from DATABASE_URL in production'
    });
  }
});

function validateAdminConfig(value, context) {
  const hasPassword = Boolean(value.ADMIN_PASSWORD_HASH);
  const hasSecret = Boolean(value.ADMIN_SESSION_SECRET_BASE64);
  if (hasPassword !== hasSecret) {
    context.addIssue({
      code: 'custom',
      path: ['ADMIN_PASSWORD_HASH'],
      message: 'ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET_BASE64 must be configured together'
    });
  }
  if (hasSecret) {
    try {
      if (Buffer.from(value.ADMIN_SESSION_SECRET_BASE64, 'base64').length !== 32) throw new Error();
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_SESSION_SECRET_BASE64'],
        message: 'must decode to exactly 32 bytes'
      });
    }
  }
}

function isLoopbackDatabase(urlText) {
  const hostname = new URL(urlText).hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function databaseHostname(urlText) {
  return new URL(urlText).hostname.replace(/^\[|\]$/g, '');
}

function databaseUsername(urlText) {
  try {
    const url = new URL(urlText);
    decodeURIComponent(url.password);
    return decodeURIComponent(url.username);
  } catch {
    return null;
  }
}

function decodeCertificate(value) {
  const normalized = String(value || '').replace(/\s/g, '');
  if (!normalized || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    return null;
  }
  const certificate = Buffer.from(normalized, 'base64').toString('utf8');
  if (!certificate.includes('-----BEGIN CERTIFICATE-----')) return null;
  if (!certificate.includes('-----END CERTIFICATE-----')) return null;
  return certificate;
}

function validateDatabaseConfig(value, context, { urlKey, tlsKey, caKey }) {
  const tlsEnabled = Boolean(value[tlsKey]);
  const caValue = value[caKey];
  const username = databaseUsername(value[urlKey]);
  if (username === null) {
    context.addIssue({
      code: 'custom',
      path: [urlKey],
      message: 'credentials must use valid URL percent-encoding'
    });
  } else if (value.NODE_ENV === 'production' && !username) {
    context.addIssue({
      code: 'custom',
      path: [urlKey],
      message: 'must include a database username in production'
    });
  }
  if (caValue && !tlsEnabled) {
    context.addIssue({
      code: 'custom',
      path: [caKey],
      message: `requires ${tlsKey}=true`
    });
  }
  if (caValue && !decodeCertificate(caValue)) {
    context.addIssue({
      code: 'custom',
      path: [caKey],
      message: 'must be a base64-encoded PEM certificate'
    });
  }
  if (value.NODE_ENV === 'production' && !isLoopbackDatabase(value[urlKey]) && !tlsEnabled) {
    context.addIssue({
      code: 'custom',
      path: [tlsKey],
      message: 'must be true for a non-loopback production MySQL connection'
    });
  }
  if (
    value.NODE_ENV === 'production'
    && !isLoopbackDatabase(value[urlKey])
    && net.isIP(databaseHostname(value[urlKey]))
  ) {
    context.addIssue({
      code: 'custom',
      path: [urlKey],
      message: 'must use a DNS hostname so the TLS certificate identity can be verified'
    });
  }
}

function validateBaseConfig(value, context) {
  validateAdminConfig(value, context);
  validateDatabaseConfig(value, context, {
    urlKey: 'DATABASE_URL',
    tlsKey: 'DATABASE_TLS',
    caKey: 'DATABASE_TLS_CA_BASE64'
  });
}

const schema = baseSchema.superRefine(validateBaseConfig);

const workerSchema = baseSchema.extend({
  WORKER_ID: z.string().trim().min(1).max(128).optional(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  PROVIDER_READS_ENABLED: booleanString.default(false),
  PROVIDER_WRITES_ENABLED: booleanString.default(false),
  ZZSHU_API_BASE_URL: z.string().url().default('https://card.zzshu.pro/api/v1'),
  ZZSHU_API_KEY: z.string().trim().min(1).optional()
}).superRefine(validateBaseConfig);

function databaseConfig(data, { urlKey, tlsKey, caKey }) {
  return {
    url: data[urlKey],
    tls: data[tlsKey] ? {
      enabled: true,
      rejectUnauthorized: true,
      verifyIdentity: true,
      ca: data[caKey] ? decodeCertificate(data[caKey]) : null
    } : {
      enabled: false,
      rejectUnauthorized: true,
      verifyIdentity: true,
      ca: null
    }
  };
}

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid v1 configuration: ${detail}`);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    trustProxy: result.data.TRUST_PROXY,
    database: databaseConfig(result.data, {
      urlKey: 'DATABASE_URL',
      tlsKey: 'DATABASE_TLS',
      caKey: 'DATABASE_TLS_CA_BASE64'
    }),
    sessionEncryptionKey: Buffer.from(result.data.SESSION_ENCRYPTION_KEY_BASE64, 'base64'),
    adminPasswordHash: result.data.ADMIN_PASSWORD_HASH || null,
    adminSessionSecret: result.data.ADMIN_SESSION_SECRET_BASE64
      ? Buffer.from(result.data.ADMIN_SESSION_SECRET_BASE64, 'base64')
      : null
  };
}

export function loadMigrationConfig(env = process.env) {
  const result = migrationSchema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid v1 migration configuration: ${detail}`);
  }
  return {
    nodeEnv: result.data.NODE_ENV,
    database: databaseConfig(result.data, {
      urlKey: 'MIGRATION_DATABASE_URL',
      tlsKey: 'MIGRATION_DATABASE_TLS',
      caKey: 'MIGRATION_DATABASE_TLS_CA_BASE64'
    })
  };
}

export function loadRuntimeDatabaseConfig(env = process.env) {
  const result = runtimeDatabaseSchema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid v1 database configuration: ${detail}`);
  }
  return databaseConfig(result.data, {
    urlKey: 'DATABASE_URL',
    tlsKey: 'DATABASE_TLS',
    caKey: 'DATABASE_TLS_CA_BASE64'
  });
}

export function loadWorkerConfig(env = process.env) {
  const result = workerSchema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid v1 worker configuration: ${detail}`);
  }
  if (result.data.PROVIDER_WRITES_ENABLED) {
    throw new Error(
      'Provider writes remain locked until the Hnskj purchase/card response contract is verified'
    );
  }
  if (result.data.PROVIDER_READS_ENABLED && !result.data.ZZSHU_API_KEY) {
    throw new Error('ZZSHU_API_KEY is required when PROVIDER_READS_ENABLED=true');
  }

  return {
    ...loadConfig(env),
    workerId: result.data.WORKER_ID,
    workerPollIntervalMs: result.data.WORKER_POLL_INTERVAL_MS,
    workerLeaseSeconds: result.data.WORKER_LEASE_SECONDS,
    providerReadsEnabled: result.data.PROVIDER_READS_ENABLED,
    providerWritesEnabled: false,
    zzshuApiBaseUrl: result.data.ZZSHU_API_BASE_URL,
    zzshuApiKey: result.data.ZZSHU_API_KEY || null
  };
}
