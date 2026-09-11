// D-162 one-off: fill cards.card_bin for cards created before the column existed.
// Decrypts card_number_ciphertext only to take the first 8 digits (the issuing product
// prefix) and never prints, logs or stores anything else from the PAN.
//
//   node scripts/backfill-card-bin.mjs [--dry-run]
//   Needs DATABASE_URL and SESSION_ENCRYPTION_KEY_BASE64 (source /etc/pojia/runtime.env).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const HERE = dirname(fileURLToPath(import.meta.url));
const { decryptSecret } = await import(join(HERE, '../src/security/secret-box.js'));
const { cardBin } = await import(join(HERE, '../src/domain/card-bin.js'));

const dryRun = process.argv.includes('--dry-run');
if (!process.env.DATABASE_URL || !process.env.SESSION_ENCRYPTION_KEY_BASE64) {
  console.error('DATABASE_URL and SESSION_ENCRYPTION_KEY_BASE64 are required'); process.exit(2);
}
const key = Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64, 'base64');
const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const [rows] = await pool.query(
    'SELECT id, last4, card_number_ciphertext FROM cards WHERE card_bin IS NULL AND card_number_ciphertext IS NOT NULL'
  );
  const summary = { scanned: rows.length, filled: 0, unreadable: 0, bySegment: {} };
  for (const row of rows) {
    let bin = null;
    try { bin = cardBin(decryptSecret(row.card_number_ciphertext, key)); } catch { bin = null; }
    if (!bin) { summary.unreadable += 1; continue; }
    summary.bySegment[bin] = (summary.bySegment[bin] || 0) + 1;
    if (!dryRun) await pool.query('UPDATE cards SET card_bin = ? WHERE id = ? AND card_bin IS NULL', [bin, row.id]);
    summary.filled += 1;
  }
  console.log(JSON.stringify({ dryRun, ...summary }, null, 1));
} finally { await pool.end(); }
