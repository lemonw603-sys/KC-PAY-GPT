#!/usr/bin/env node
// Look up which order a CDK code resolved to. CDK codes are stored as an irreversible hash
// (`cdks.code_hash`), not plaintext, so this reuses the same admin-search lookup the admin UI's
// order search box uses (createCdkLookup + hash match) instead of guessing at the hash by hand.
// Read-only: calls listOrders(), never writes.
//
//   ssh root@<host> 'source /etc/pojia/runtime.env && node /opt/pojia/current/v1/scripts/find-order-by-cdk.mjs <cdk-code>'
//
// Needs DATABASE_URL, SESSION_ENCRYPTION_KEY_BASE64, CDK_HASH_KEY_V1_BASE64,
// CARD_INTAKE_PAN_HMAC_KEY_BASE64 (source /etc/pojia/runtime.env) — a bare DB tunnel is not enough.
import mysql from 'mysql2/promise';
import { createAdminReadService } from '../src/services/admin-read-service.js';

const cdkCode = process.argv[2];
if (!cdkCode) { console.error('usage: find-order-by-cdk.mjs <cdk-code>'); process.exit(2); }
for (const name of ['DATABASE_URL', 'SESSION_ENCRYPTION_KEY_BASE64', 'CDK_HASH_KEY_V1_BASE64', 'CARD_INTAKE_PAN_HMAC_KEY_BASE64']) {
  if (!process.env[name]) { console.error(`${name} is required (source /etc/pojia/runtime.env first)`); process.exit(2); }
}

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const service = createAdminReadService({
    pool,
    sessionEncryptionKey: Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64'),
    cdkHashKey: Buffer.from(process.env.CDK_HASH_KEY_V1_BASE64, 'base64'),
    panHmacKey: Buffer.from(process.env.CARD_INTAKE_PAN_HMAC_KEY_BASE64, 'base64')
  });
  const result = await service.listOrders({ q: cdkCode, pageSize: 5 });
  // listOrders() includes the full decrypted card number by design (admin UI's "完整卡号" view) —
  // this script only needs to locate the order, so redact it before printing to stdout/logs.
  const redactedOrders = (result.orders || []).map((o) => ({
    ...o, card: o.card ? { ...o.card, cardNumber: undefined } : o.card
  }));
  if (!redactedOrders.length && !result.cdkMatches?.length) {
    console.log(JSON.stringify({ found: false, note: 'no order or CDK matched this code' }));
  } else {
    console.log(JSON.stringify({ found: true, orders: redactedOrders, cdkMatches: result.cdkMatches }, null, 2));
  }
} catch (error) {
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
