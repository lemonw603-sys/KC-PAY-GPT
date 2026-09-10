#!/usr/bin/env node
// Configure the highvcc.com (备用卡台 A) access token the admin "一键开卡" action uses.
// Token comes from STDIN only — never a CLI arg (would sit in `ps`/shell history) and never
// printed back. Needs DB write access AND the session-encryption key (the token is stored
// encrypted in app_settings, same key as card credentials/session ciphertext), so run this ON
// the production host with /etc/pojia/runtime.env sourced — a bare DATABASE_URL tunnel is not
// enough.
//
//   ssh root@<host> 'source /etc/pojia/runtime.env && node /opt/pojia/current/v1/scripts/set-highvcc-token.mjs' <<< "$TOKEN"
import mysql from 'mysql2/promise';
import { createHighvccCardService } from '../src/services/highvcc-card-service.js';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

for (const name of ['DATABASE_URL', 'SESSION_ENCRYPTION_KEY_BASE64', 'CARD_INTAKE_PAN_HMAC_KEY_BASE64']) {
  if (!process.env[name]) { console.error(`${name} is required (source /etc/pojia/runtime.env first)`); process.exit(2); }
}
const token = await readStdin();
if (!token) { console.error('no token on stdin'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const service = createHighvccCardService({
    pool,
    encryptionKey: Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64'),
    panHmacKey: Buffer.from(process.env.CARD_INTAKE_PAN_HMAC_KEY_BASE64, 'base64'),
  });
  const status = await service.setToken({ token, requestedBy: 'admin-script:set-highvcc-token' });
  console.log(JSON.stringify(status)); // {configured, updatedAt} only — never the token
} catch (error) {
  console.error('failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
