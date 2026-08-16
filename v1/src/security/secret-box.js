import crypto from 'node:crypto';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('Secret-box key must be exactly 32 bytes');
  }
}

export function encryptSecret(value, key) {
  assertKey(key);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]);
}

export function decryptSecret(payload, key) {
  assertKey(key);
  if (!Buffer.isBuffer(payload) || payload.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error('Invalid encrypted secret payload');
  }
  if (payload[0] !== VERSION) {
    throw new Error(`Unsupported encrypted secret version: ${payload[0]}`);
  }

  const iv = payload.subarray(1, 1 + IV_BYTES);
  const tag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
