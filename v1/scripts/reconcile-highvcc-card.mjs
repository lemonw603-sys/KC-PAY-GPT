#!/usr/bin/env node
// Finish recording a highvcc.com (备用卡台 A) card that the platform already created — money
// already spent — but that openCard() failed to record (its error names this exact card id and
// says so explicitly). Never opens a new card or spends anything; only reads the existing
// card's detail and, if complete, inserts the one row that openCard() would have written.
//
//   ssh root@<host> 'source /etc/pojia/runtime.env && node /opt/pojia/current/v1/scripts/reconcile-highvcc-card.mjs <card-id>'
//
// Needs DATABASE_URL, SESSION_ENCRYPTION_KEY_BASE64, CARD_INTAKE_PAN_HMAC_KEY_BASE64 (source
// /etc/pojia/runtime.env) — a bare DB tunnel is not enough. Refuses (HIGHVCC_RECONCILE_NOT_READY)
// if the platform still has no complete detail for the card; safe to re-run in that case.
import mysql from 'mysql2/promise';
import { createHighvccCardService } from '../src/services/highvcc-card-service.js';

const cardId = process.argv[2];
if (!cardId) { console.error('usage: reconcile-highvcc-card.mjs <card-id>'); process.exit(2); }
for (const name of ['DATABASE_URL', 'SESSION_ENCRYPTION_KEY_BASE64', 'CARD_INTAKE_PAN_HMAC_KEY_BASE64']) {
  if (!process.env[name]) { console.error(`${name} is required (source /etc/pojia/runtime.env first)`); process.exit(2); }
}

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const service = createHighvccCardService({
    pool,
    encryptionKey: Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64'),
    panHmacKey: Buffer.from(process.env.CARD_INTAKE_PAN_HMAC_KEY_BASE64, 'base64'),
  });
  const result = await service.recordExistingCard({ cardId, requestedBy: 'reconcile-highvcc-card.mjs' });
  console.log(JSON.stringify({ recorded: true, cardId: result.cardId, last4: result.last4, expires: result.expires, holder: result.holder, balance: result.balance }));
} catch (error) {
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  if (error.detail) console.error('detail:', error.detail);
  process.exitCode = 1;
} finally {
  await pool.end();
}
