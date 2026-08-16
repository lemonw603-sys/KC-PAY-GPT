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
