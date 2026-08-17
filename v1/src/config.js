import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  TRUST_PROXY: booleanString.default(false),
  DATABASE_URL: z.string().url().startsWith('mysql://'),
  SESSION_ENCRYPTION_KEY_BASE64: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'SESSION_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes')
});

const workerSchema = schema.extend({
  WORKER_ID: z.string().trim().min(1).max(128).optional(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  PROVIDER_READS_ENABLED: booleanString.default(false),
  PROVIDER_WRITES_ENABLED: booleanString.default(false),
  ZZSHU_API_BASE_URL: z.string().url().default('https://card.zzshu.pro/api/v1'),
  ZZSHU_API_KEY: z.string().trim().min(1).optional()
});

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
    databaseUrl: result.data.DATABASE_URL,
    sessionEncryptionKey: Buffer.from(result.data.SESSION_ENCRYPTION_KEY_BASE64, 'base64')
  };
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
