import crypto from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { encryptSecret } from '../security/secret-box.js';
import { PublicApiError } from '../domain/public-api-error.js';

export const REQUIRED_HEADERS = ['卡序列号','累计充值','累计消费','余额','卡号','CVC','有效期','开卡状态','开卡时间','FirstName','LastName','州','城市','街道','邮编','标签','分组名称'];
const STRUCTURAL_ERRORS = new Set(['MISSING_SEQUENCE','INVALID_CARD_NUMBER','INVALID_CVC','INVALID_EXPIRY','INVALID_BALANCE','BALANCE_MISMATCH','DUPLICATE_SEQUENCE']);
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
      cells[columnNumber(ref)] = /\bt="s"/.test(attrs) ? strings[Number(raw)] ?? '' : xmlText(raw);
    }
    return cells;
  });
}
function money(value) { const n = Number(String(value).replace(/[$,]/g, '')); return Number.isFinite(n) ? n : NaN; }
function normalizeRow(values, index, now = new Date()) {
  const row = Object.fromEntries(REQUIRED_HEADERS.map((h, i) => [h, String(values[i] ?? '').trim()]));
  const structuralErrors = []; const availabilityReasons = []; const warnings = [];
  const sequence = row['卡序列号']; const pan = row['卡号'].replace(/[\s-]/g, '');
  if (!sequence) structuralErrors.push('MISSING_SEQUENCE');
  if (!/^\d{12,19}$/.test(pan)) structuralErrors.push('INVALID_CARD_NUMBER');
  if (!/^\d{3,4}$/.test(row.CVC)) structuralErrors.push('INVALID_CVC');
  const exp = row['有效期'].match(/^(\d{2})\/(\d{2})$/);
  if (!exp || Number(exp[1]) < 1 || Number(exp[1]) > 12) structuralErrors.push('INVALID_EXPIRY');
  else {
    const year = 2000 + Number(exp[2]); const month = Number(exp[1]);
    if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month <= now.getUTCMonth() + 1)) availabilityReasons.push('EXPIRED_CARD');
  }
  const active = ['已激活','active','ACTIVE'].includes(row['开卡状态']);
  if (!active) availabilityReasons.push('CARD_NOT_ACTIVE');
  for (const h of ['FirstName','LastName','州','城市','街道','邮编']) if (!row[h]) availabilityReasons.push(`MISSING_${h}`);
  const loaded = money(row['累计充值']); const spent = money(row['累计消费']); const balance = money(row['余额']);
  if (![loaded, spent, balance].every(Number.isFinite) || loaded < 0 || spent < 0 || balance < 0) structuralErrors.push('INVALID_BALANCE');
  // The platform's running totals do not always reconcile (top-up fees, rounding).
  // The 余额 column is what allocation uses, so a mismatch is reported, not blocking.
  else if (Math.abs((loaded - spent) - balance) > 0.02) warnings.push('BALANCE_MISMATCH');
  return { index, row, pan, expMonth: exp ? Number(exp[1]) : null, expYear: exp ? 2000 + Number(exp[2]) : null, balance, structuralErrors, availabilityReasons, warnings };
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
  for (const item of data) {
    if (item.row['卡序列号'] && sequences.has(item.row['卡序列号'])) item.structuralErrors.push('DUPLICATE_SEQUENCE');
    sequences.add(item.row['卡序列号']);
  }
  return data;
}

function hmac(pan, key) { return /^\d{12,19}$/.test(pan) ? crypto.createHmac('sha256', key).update(pan).digest('hex') : null; }
function confirmationFor(count) { return `确认提交 ${count} 张卡的完整快照`; }
function sourceError(message, code, status = 400) { return new PublicApiError(message, { code, status }); }
function decodeWorkbook(fileBase64) {
  const encoded = String(fileBase64 || '').trim();
  if (!encoded) throw sourceError('card spreadsheet is required', 'MANUAL_CARD_FILE_INVALID');
  const bytes = Buffer.from(encoded, 'base64');
  const canonical = encoded.replace(/=+$/, '');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== canonical) {
    throw sourceError('card spreadsheet encoding is invalid', 'MANUAL_CARD_FILE_INVALID');
  }
  try { return { bytes, rows: parseManualCardWorkbook(bytes) }; }
  catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw sourceError('card spreadsheet is invalid', 'MANUAL_CARD_FILE_INVALID');
  }
}
function sourceQuery(forUpdate = false) {
  return `SELECT id, provider_code, account_code, display_name, source_adapter,
    supports_browser_recharge, operational_enabled
    FROM provider_accounts WHERE id=? AND purpose='CARD' LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`;
}
async function loadSource(queryable, providerAccountId, { forUpdate = false } = {}) {
  const id = String(providerAccountId || '').trim();
  if (!id) throw sourceError('card source is required', 'CARD_SOURCE_REQUIRED');
  const [rows] = await queryable.query(sourceQuery(forUpdate), [id]);
  const source = rows[0];
  if (!source || !source.supports_browser_recharge || source.provider_code !== 'manual_excel' || !source.source_adapter) {
    throw sourceError('manual Browser card source is unavailable', 'MANUAL_CARD_SOURCE_UNAVAILABLE', 409);
  }
  return source;
}
function publicRow(item, existing = false, conflict = false) {
  const unavailable = item.availabilityReasons.length > 0;
  return { row: item.index, sequence: item.row['卡序列号'].slice(0, 6), last4: item.pan.slice(-4),
    balance: Number.isFinite(item.balance) ? item.balance.toFixed(2) : null,
    status: conflict ? 'CONFLICT' : item.structuralErrors.length ? 'REJECTED' : unavailable ? 'UNAVAILABLE' : (existing ? 'UPDATE' : 'INSERT'),
    state: item.row['州'], errors: [...item.structuralErrors, ...item.availabilityReasons, ...(conflict ? ['PAN_SOURCE_CONFLICT'] : [])],
    warnings: [...(item.warnings || [])] };
}
// A card is "at risk" only while money is still in flight. SETTLED is terminal:
// its consumption already lives in the capacity ledger, and orders.assigned_card_id
// is never cleared, so counting SETTLED here froze every card that had paid once
// (it could never return to AVAILABLE on a later snapshot).
function activeRiskSql(alias = 'cards') {
  return `(EXISTS (SELECT 1 FROM card_assignment_history h WHERE h.card_id=${alias}.id AND h.status='ACTIVE')
    OR EXISTS (SELECT 1 FROM recharge_attempts ra WHERE ra.order_id IN
      (SELECT o.id FROM orders o WHERE o.assigned_card_id=${alias}.id)
      AND ra.funds_risk_state IN ('ACTIVE','UNKNOWN'))
    OR EXISTS (SELECT 1 FROM browser_runs br
      INNER JOIN recharge_attempts bra ON bra.id=br.recharge_attempt_id
      INNER JOIN orders bro ON bro.id=bra.order_id
      WHERE bro.assigned_card_id=${alias}.id
        AND br.status NOT IN ('COMPLETED','FAILED_SAFE')))`;
}

export function createManualCardImportService({ pool, encryptionKey, panHmacKey } = {}) {
  if (!pool?.getConnection) throw new TypeError('pool is required');
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) throw new TypeError('encryptionKey must be 32 bytes');
  if (!Buffer.isBuffer(panHmacKey) || panHmacKey.length !== 32) throw new TypeError('panHmacKey must be 32 bytes');

  async function inspect({ queryable, providerAccountId, rows, lock = false }) {
    const source = await loadSource(queryable, providerAccountId, { forUpdate: lock });
    if (source.source_adapter !== 'backup_card_export_v1') throw sourceError('unsupported card source adapter', 'UNSUPPORTED_CARD_SOURCE_ADAPTER');
    const [existing] = await queryable.query(`SELECT id, external_card_id, pan_hmac, source_present,
      ${activeRiskSql('cards')} AS has_active_risk FROM cards WHERE provider_account_id=?${lock ? ' FOR UPDATE' : ''}`, [source.id]);
    const byExternal = new Map(existing.map((r) => [String(r.external_card_id), r]));
    const panHmacs = rows.map((r) => hmac(r.pan, panHmacKey)).filter(Boolean);
    let conflicts = [];
    if (panHmacs.length) {
      const [found] = await queryable.query(`SELECT id, provider_account_id, pan_hmac FROM cards
        WHERE pan_hmac IN (${panHmacs.map(() => '?').join(',')}) AND provider_account_id<>?${lock ? ' FOR UPDATE' : ''}`,
      [...panHmacs, source.id]);
      conflicts = found;
    }
    const conflictHmacs = new Set(conflicts.map((r) => r.pan_hmac));
    const incomingIds = new Set(rows.map((r) => r.row['卡序列号']).filter(Boolean));
    const missing = existing.filter((r) => !incomingIds.has(String(r.external_card_id)));
    return { source, byExternal, conflictHmacs, missing };
  }

  async function preview({ providerAccountId, filename = 'cards.xlsx', fileBase64 } = {}) {
    const { rows } = decodeWorkbook(fileBase64);
    const state = await inspect({ queryable: pool, providerAccountId, rows });
    const result = rows.map((r) => publicRow(r, state.byExternal.has(r.row['卡序列号']), state.conflictHmacs.has(hmac(r.pan, panHmacKey))));
    const structuralCount = result.filter((r) => r.status === 'REJECTED').length;
    const conflictCount = result.filter((r) => r.status === 'CONFLICT').length;
    return { providerAccountId: state.source.id, sourceName: state.source.display_name || state.source.account_code,
      filename: String(filename).slice(0, 255), rowCount: rows.length,
      insertCount: result.filter((r) => r.status === 'INSERT').length,
      updateCount: result.filter((r) => r.status === 'UPDATE').length,
      unavailableCount: result.filter((r) => r.status === 'UNAVAILABLE').length,
      missingCount: state.missing.length,
      activeRiskCount: state.missing.filter((r) => Boolean(r.has_active_risk)).length,
      conflictCount, rejectedCount: structuralCount, commitAllowed: structuralCount === 0 && conflictCount === 0,
      rows: result, confirmation: confirmationFor(rows.length) };
  }

  async function commit({ providerAccountId, filename = 'cards.xlsx', fileBase64, confirmation, requestedBy = 'admin' } = {}) {
    const { bytes, rows } = decodeWorkbook(fileBase64);
    if (confirmation !== confirmationFor(rows.length)) throw sourceError('import confirmation mismatch', 'MANUAL_CARD_IMPORT_CONFIRMATION_REQUIRED');
    if (rows.some((r) => r.structuralErrors.some((e) => STRUCTURAL_ERRORS.has(e)))) throw sourceError('full snapshot contains structural errors', 'MANUAL_CARD_SNAPSHOT_INVALID', 409);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const state = await inspect({ queryable: connection, providerAccountId, rows, lock: true });
      if (state.conflictHmacs.size) throw sourceError('physical card already belongs to another source', 'CARD_SOURCE_PAN_CONFLICT', 409);
      const [prior] = await connection.query(`SELECT id, row_count, inserted_count, updated_count,
        unavailable_count, missing_count, conflict_count, rejected_count
        FROM manual_card_import_batches WHERE provider_account_id=? AND source_file_hash=?
        AND status='COMMITTED' LIMIT 1`, [state.source.id, hash]);
      if (prior.length) { await connection.commit(); return { batchId: prior[0].id, rowCount: Number(prior[0].row_count), insertedCount: Number(prior[0].inserted_count), updatedCount: Number(prior[0].updated_count), unavailableCount: Number(prior[0].unavailable_count), missingCount: Number(prior[0].missing_count), conflictCount: Number(prior[0].conflict_count), rejectedCount: Number(prior[0].rejected_count), replay: true }; }
      const batchId = crypto.randomUUID();
      await connection.query(`INSERT INTO manual_card_import_batches
        (id, provider_account_id, adapter_code, source_file_hash, filename, row_count, requested_by, status)
        VALUES (?,?,?,?,?,?,?,'COMMITTING')`, [batchId, state.source.id, state.source.source_adapter, hash, String(filename).slice(0, 255), rows.length, String(requestedBy).slice(0, 128)]);
      let inserted = 0; let updated = 0; let unavailable = 0;
      for (const item of rows) {
        const sequence = item.row['卡序列号']; const existing = state.byExternal.get(sequence); const isAvailableByFacts = item.availabilityReasons.length === 0;
        if (!isAvailableByFacts) unavailable += 1;
        const credentials = { cardNumber: item.pan, cvv: item.row.CVC, cvc: item.row.CVC, expMonth: item.expMonth, expYear: item.expYear,
          billingAddress: { name: `${item.row.FirstName} ${item.row.LastName}`.trim(), country: 'US', state: item.row['州'], city: item.row['城市'], line1: item.row['街道'], postalCode: item.row['邮编'] } };
        const encrypted = encryptSecret(JSON.stringify(credentials), encryptionKey);
        const operationalStatus = isAvailableByFacts ? 'ACTIVE' : item.availabilityReasons.join(',').slice(0, 32);
        if (existing) {
          await connection.query(`UPDATE cards SET last4=?, status=?, current_balance=?, currency='USD',
            inventory_status=IF(${activeRiskSql('cards')}, inventory_status, ?), intake_status='ACCEPTED',
            sync_tier='MANUAL_IMPORT', source_present=1, source_operational_status=?,
            last_manual_snapshot_batch_id=?, card_credentials_ciphertext=?, card_number_ciphertext=?,
            pan_hmac=?, pan_hmac_version=1, last_synced_at=CURRENT_TIMESTAMP(3), updated_at=CURRENT_TIMESTAMP(3)
            WHERE id=?`, [item.pan.slice(-4), isAvailableByFacts ? 'active' : 'unavailable', item.balance,
            isAvailableByFacts ? 'AVAILABLE' : 'HELD_FOR_REVIEW', operationalStatus, batchId, encrypted,
            encryptSecret(item.pan, encryptionKey), hmac(item.pan, panHmacKey), existing.id]);
          updated += 1;
        } else {
          await connection.query(`INSERT INTO cards
            (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status,
             funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext,
             card_number_ciphertext, pan_hmac, pan_hmac_version, provider_account_id, external_card_id,
             intake_status, sync_tier, source_present, source_operational_status,
             last_manual_snapshot_batch_id, last_synced_at)
            VALUES (UUID(),NULL,?,?,?,?,?,?,?,'USD','MONITORING',?,?,?,?,?,?,'ACCEPTED','MANUAL_IMPORT',1,?,?,CURRENT_TIMESTAMP(3))`,
          [isAvailableByFacts ? 'AVAILABLE' : 'HELD_FOR_REVIEW', sequence, 'MANUAL_BACKUP', item.pan.slice(-4),
            isAvailableByFacts ? 'active' : 'unavailable', item.balance, item.balance, encrypted,
            encryptSecret(item.pan, encryptionKey), hmac(item.pan, panHmacKey), 1, state.source.id, sequence,
            operationalStatus, batchId]);
          inserted += 1;
        }
        await connection.query(`INSERT INTO manual_card_import_rows
          (batch_id, external_card_id, last4, outcome, error_code) VALUES (?,?,?,?,?)`,
        [batchId, sequence, item.pan.slice(-4), isAvailableByFacts ? (existing ? 'UPDATED' : 'INSERTED') : 'UNAVAILABLE', item.availabilityReasons.join(',') || null]);
      }
      for (const item of state.missing) {
        await connection.query(`UPDATE cards SET source_present=0,
          inventory_status=IF(${activeRiskSql('cards')}, inventory_status, 'HELD_FOR_REVIEW'),
          source_operational_status='MISSING_FROM_SNAPSHOT', last_manual_snapshot_batch_id=?,
          updated_at=CURRENT_TIMESTAMP(3) WHERE id=?`, [batchId, item.id]);
        await connection.query(`INSERT INTO manual_card_import_rows
          (batch_id, external_card_id, last4, outcome, error_code)
          SELECT ?, external_card_id, last4, 'MISSING', NULL FROM cards WHERE id=?`, [batchId, item.id]);
      }
      await connection.query(`UPDATE provider_accounts SET last_full_snapshot_at=CURRENT_TIMESTAMP(3) WHERE id=?`, [state.source.id]);
      await connection.query(`UPDATE manual_card_import_batches SET inserted_count=?, updated_count=?,
        unavailable_count=?, missing_count=?, conflict_count=0, rejected_count=0,
        status='COMMITTED', committed_at=CURRENT_TIMESTAMP(3) WHERE id=?`,
      [inserted, updated, unavailable, state.missing.length, batchId]);
      await connection.commit();
      return { batchId, rowCount: rows.length, insertedCount: inserted, updatedCount: updated,
        unavailableCount: unavailable, missingCount: state.missing.length, conflictCount: 0, rejectedCount: 0 };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  return { preview, commit };
}
