import crypto from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { encryptSecret } from '../security/secret-box.js';

const REQUIRED_HEADERS = ['卡序列号','累计充值','累计消费','余额','卡号','CVC','有效期','开卡状态','开卡时间','FirstName','LastName','州','城市','街道','邮编','标签','分组名称'];
const SOURCE_ACCOUNT_ID = '00000000-0000-4000-8000-000000000103';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 1000;

function xmlText(value) { return String(value || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }
function sharedStrings(zip) {
  const xml = zip['xl/sharedStrings.xml'] ? strFromU8(zip['xl/sharedStrings.xml']) : '';
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map((m) => [...m[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => xmlText(x[1])).join(''));
}
function columnNumber(ref) { let n = 0; for (const c of String(ref).replace(/\d/g, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; }
function parseRows(bytes) {
  if (bytes.length < 4 || Buffer.from(bytes.subarray(0, 4)).toString('hex') !== '504b0304') throw new Error('unsupported spreadsheet format');
  const zip = unzipSync(bytes); const strings = sharedStrings(zip);
  const xml = zip['xl/worksheets/sheet1.xml'] ? strFromU8(zip['xl/worksheets/sheet1.xml']) : '';
  if (!xml) throw new Error('worksheet not found');
  return [...xml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)].map((rowMatch) => {
    const cells = {};
    for (const m of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = m[1]; const body = m[2]; const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1]; if (!ref) continue;
      const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
      const value = /\bt="s"/.test(attrs) ? strings[Number(raw)] ?? '' : xmlText(raw);
      cells[columnNumber(ref)] = value;
    }
    return cells;
  });
}
function money(value) { const n = Number(String(value).replace(/[$,]/g, '')); return Number.isFinite(n) ? n : NaN; }
function normalizeRow(values, index) {
  const row = Object.fromEntries(REQUIRED_HEADERS.map((h, i) => [h, String(values[i] ?? '').trim()]));
  const errors = [];
  const sequence = row['卡序列号']; const pan = row['卡号'].replace(/[\s-]/g, '');
  if (!sequence) errors.push('MISSING_SEQUENCE');
  if (!/^\d{12,19}$/.test(pan)) errors.push('INVALID_CARD_NUMBER');
  if (!/^\d{3,4}$/.test(row.CVC)) errors.push('INVALID_CVC');
  const exp = row['有效期'].match(/^(\d{2})\/(\d{2})$/); if (!exp) errors.push('INVALID_EXPIRY');
  else { const year = 2000 + Number(exp[2]); const month = Number(exp[1]); const now = new Date(); if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month <= now.getUTCMonth())) errors.push('EXPIRED_CARD'); }
  if (!['已激活','active','ACTIVE'].includes(row['开卡状态'])) errors.push('CARD_NOT_ACTIVE');
  for (const h of ['FirstName','LastName','州','城市','街道','邮编']) if (!row[h]) errors.push(`MISSING_${h}`);
  const loaded = money(row['累计充值']); const spent = money(row['累计消费']); const balance = money(row['余额']);
  if (![loaded, spent, balance].every(Number.isFinite)) errors.push('INVALID_BALANCE');
  else if (Math.abs((loaded - spent) - balance) > 0.02) errors.push('BALANCE_MISMATCH');
  return { index, row, pan, expMonth: exp ? Number(exp[1]) : null, expYear: exp ? 2000 + Number(exp[2]) : null, balance, errors };
}
export function parseManualCardWorkbook(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'base64');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('spreadsheet exceeds 2MB limit');
  const rows = parseRows(new Uint8Array(bytes));
  const header = REQUIRED_HEADERS.map((_, i) => rows[1]?.[i] || '');
  if (header.join('\u0001') !== REQUIRED_HEADERS.join('\u0001')) throw new Error('unexpected spreadsheet headers');
  const rawData = rows.slice(2).filter((r) => Object.values(r).some(Boolean));
  if (rawData.length > MAX_ROWS) throw new Error('too many card rows');
  const data = rawData.map((r, i) => normalizeRow(REQUIRED_HEADERS.map((_, c) => r[c] || ''), i + 1));
  const sequences = new Set();
  for (const item of data) { if (item.row['卡序列号'] && sequences.has(item.row['卡序列号'])) item.errors.push('DUPLICATE_SEQUENCE'); sequences.add(item.row['卡序列号']); }
  return data;
}
function publicRow(item, existing = false) { return { row: item.index, sequence: item.row['卡序列号'].slice(0, 6), last4: item.pan.slice(-4), balance: Number.isFinite(item.balance) ? item.balance.toFixed(2) : null, status: item.errors.length ? 'REJECTED' : (existing ? 'UPDATE' : 'INSERT'), state: item.row['州'], errors: item.errors }; }
function confirmationFor(count) { return `确认导入 ${count} 张备用卡`; }

export function createManualCardImportService({ pool, encryptionKey, panHmacKey } = {}) {
  if (!pool?.getConnection) throw new TypeError('pool is required');
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) throw new TypeError('encryptionKey must be 32 bytes');
  if (!Buffer.isBuffer(panHmacKey) || panHmacKey.length !== 32) throw new TypeError('panHmacKey must be 32 bytes');
  async function preview({ filename = 'cards.xlsx', fileBase64 } = {}) {
    const bytes = Buffer.from(String(fileBase64 || ''), 'base64'); const rows = parseManualCardWorkbook(bytes); const [existing] = await pool.query('SELECT external_card_id FROM cards WHERE provider_account_id = ?', [SOURCE_ACCOUNT_ID]); const ids = new Set(existing.map((r) => String(r.external_card_id)));
    const result = rows.map((r) => publicRow(r, ids.has(r.row['卡序列号']))); const accepted = result.filter((r) => r.status !== 'REJECTED').length;
    return { filename: String(filename).slice(0, 255), rowCount: rows.length, insertCount: result.filter((r) => r.status === 'INSERT').length, updateCount: result.filter((r) => r.status === 'UPDATE').length, rejectedCount: result.filter((r) => r.status === 'REJECTED').length, rows: result, confirmation: confirmationFor(accepted) };
  }
  async function commit({ filename = 'cards.xlsx', fileBase64, confirmation, requestedBy = 'admin' } = {}) {
    const bytes = Buffer.from(String(fileBase64 || ''), 'base64'); const rows = parseManualCardWorkbook(bytes); const accepted = rows.filter((r) => !r.errors.length); if (confirmation !== confirmationFor(accepted.length)) throw new Error('import confirmation mismatch');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const [prior] = await pool.query('SELECT id, row_count, inserted_count, updated_count, rejected_count FROM manual_card_import_batches WHERE source_file_hash = ? AND status = \'COMMITTED\' LIMIT 1', [hash]);
    if (prior.length) return { batchId: prior[0].id, rowCount: Number(prior[0].row_count), insertedCount: Number(prior[0].inserted_count), updatedCount: Number(prior[0].updated_count), rejectedCount: Number(prior[0].rejected_count), replay: true };
    const connection = await pool.getConnection();
    try { await connection.beginTransaction(); const batchId = crypto.randomUUID(); await connection.query('INSERT INTO manual_card_import_batches (id, source_file_hash, filename, row_count, requested_by, status) VALUES (?, ?, ?, ?, ?, \'COMMITTING\')', [batchId, hash, String(filename).slice(0, 255), rows.length, requestedBy]); let inserted = 0; let updated = 0;
      for (const item of rows) { const sequence = item.row['卡序列号']; const panHmac = /^\d{12,19}$/.test(item.pan) ? crypto.createHmac('sha256', panHmacKey).update(item.pan).digest('hex') : null; let outcome = 'REJECTED'; if (!item.errors.length) { const credentials = { cardNumber: item.pan, cvv: item.row.CVC, cvc: item.row.CVC, expMonth: item.expMonth, expYear: item.expYear, billingAddress: { name: `${item.row.FirstName} ${item.row.LastName}`.trim(), country: 'US', state: item.row['州'], city: item.row['城市'], line1: item.row['街道'], postalCode: item.row['邮编'] } }; const encrypted = encryptSecret(JSON.stringify(credentials), encryptionKey); const [found] = await connection.query('SELECT id FROM cards WHERE provider_account_id = ? AND BINARY external_card_id = BINARY ? FOR UPDATE', [SOURCE_ACCOUNT_ID, sequence]); if (found.length) { await connection.query("UPDATE cards SET last4=?, status='active', current_balance=?, currency='USD', inventory_status=IF(? >= COALESCE((SELECT CAST(setting_value AS DECIMAL(18,6)) FROM app_settings WHERE setting_key='default_minimum_required_card_balance' LIMIT 1), 16), 'AVAILABLE', 'DEPLETED'), intake_status='ACCEPTED', sync_tier='MANUAL_IMPORT', card_credentials_ciphertext=?, card_number_ciphertext=?, pan_hmac=?, pan_hmac_version=1, last_synced_at=CURRENT_TIMESTAMP(3), updated_at=CURRENT_TIMESTAMP(3) WHERE id=?", [item.pan.slice(-4), item.balance, item.balance, encrypted, encryptSecret(item.pan, encryptionKey), panHmac, found[0].id]); updated += 1; outcome = 'UPDATED'; } else { await connection.query("INSERT INTO cards (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status, funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext, card_number_ciphertext, pan_hmac, pan_hmac_version, provider_account_id, external_card_id, intake_status, sync_tier, last_synced_at) VALUES (UUID(),NULL,?,?,?,?, 'active', ?,?,'USD','MONITORING',?,?,?,?,?,?,'ACCEPTED','MANUAL_IMPORT',CURRENT_TIMESTAMP(3))", [item.balance >= 16 ? 'AVAILABLE' : 'DEPLETED', sequence, 'MANUAL_BACKUP', item.pan.slice(-4), item.balance, item.balance, encrypted, encryptSecret(item.pan, encryptionKey), panHmac, SOURCE_ACCOUNT_ID, sequence]); inserted += 1; outcome = 'INSERTED'; } } await connection.query('INSERT INTO manual_card_import_rows (batch_id, external_card_id, last4, outcome, error_code) VALUES (?, ?, ?, ?, ?)', [batchId, sequence || `row-${item.index}`, item.pan ? item.pan.slice(-4) : null, outcome, item.errors.join(',') || null]); }
      await connection.query('UPDATE manual_card_import_batches SET inserted_count=?, updated_count=?, rejected_count=?, status=\'COMMITTED\', committed_at=CURRENT_TIMESTAMP(3) WHERE id=?', [inserted, updated, rows.length - accepted.length, batchId]); await connection.commit(); return { batchId, rowCount: rows.length, insertedCount: inserted, updatedCount: updated, rejectedCount: rows.length - accepted.length };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  return { preview, commit };
}
