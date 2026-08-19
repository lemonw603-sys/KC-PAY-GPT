import crypto from 'node:crypto';

export const LEGACY_CDK_HASH_VERSION = 'sha256-v1';
export const CURRENT_CDK_HASH_VERSION = 'hmac-sha256-v1';
export const GENERATED_CDK_PATTERN = /^PJ-[A-HJ-KM-NP-Z2-9]{20}$/;

function assertHashKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('CDK hash key must be exactly 32 bytes');
  }
}

export function hashLegacyCdk(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

export function hashCurrentCdk(code, key) {
  assertHashKey(key);
  return crypto.createHmac('sha256', key).update(String(code), 'utf8').digest('hex');
}

export function createCdkLookup(code, key) {
  return {
    current: { version: CURRENT_CDK_HASH_VERSION, hash: hashCurrentCdk(code, key) },
    legacy: { version: LEGACY_CDK_HASH_VERSION, hash: hashLegacyCdk(code) }
  };
}
