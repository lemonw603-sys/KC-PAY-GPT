import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { decryptSecret } from '../src/security/secret-box.js';

const config = loadConfig();
if (!Buffer.isBuffer(config.cardIntakePanHmacKey)) {
  throw new Error('CARD_INTAKE_PAN_HMAC_KEY_BASE64 is required for PAN lookup backfill');
}

const pool = createDatabasePool(config.database);
let scanned = 0;
let updated = 0;
let unavailable = 0;
try {
  const [rows] = await pool.query(
    `SELECT id, card_number_ciphertext, card_credentials_ciphertext
     FROM cards WHERE (pan_hmac IS NULL OR pan_hmac_version IS NULL OR pan_hmac_version <> 1)
       AND (card_number_ciphertext IS NOT NULL OR card_credentials_ciphertext IS NOT NULL)
     ORDER BY id`
  );
  for (const row of rows) {
    scanned += 1;
    try {
      const pan = row.card_number_ciphertext
        ? decryptSecret(row.card_number_ciphertext, config.sessionEncryptionKey)
        : JSON.parse(decryptSecret(row.card_credentials_ciphertext, config.sessionEncryptionKey)).cardNumber;
      const normalized = String(pan || '').replace(/[\s-]/g, '');
      if (!/^\d{12,19}$/.test(normalized)) {
        unavailable += 1;
        continue;
      }
      const hmac = crypto.createHmac('sha256', config.cardIntakePanHmacKey)
        .update(normalized).digest('hex');
      const [result] = await pool.query(
        `UPDATE cards SET pan_hmac = ?, pan_hmac_version = 1
         WHERE id = ? AND (pan_hmac IS NULL OR pan_hmac_version IS NULL OR pan_hmac_version <> 1)`,
        [hmac, row.id]
      );
      updated += Number(result.affectedRows || 0);
    } catch {
      unavailable += 1;
    }
  }
  console.log(JSON.stringify({ scanned, updated, unavailable }));
} finally {
  await pool.end();
}
