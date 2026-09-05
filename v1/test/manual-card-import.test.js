import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { createManualCardImportService, parseManualCardWorkbook } from '../src/services/manual-card-import-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.resolve(here, '../migrations/048_manual_backup_card_import.sql'), 'utf8');

test('manual backup-card migration creates a multi-source catalog, snapshots and order freeze', () => {
  assert.match(migration, /manual_excel.*backup-a/is);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS manual_card_import_batches/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS manual_card_import_rows/i);
  assert.match(migration, /browser_card_source_selections/i);
  assert.match(migration, /frozen_card_provider_account_id/i);
  assert.match(migration, /provider_account_id, source_file_hash/i);
  assert.match(migration, /source_present/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS fulfillment_route_card_sources/i);
  assert.match(migration, /00000000-0000-4000-8000-000000000103/);
  assert.doesNotMatch(migration, /CHATGPT_PLUS_BROWSER_V1/);
});

test('manual workbook parser rejects non-OOXML bytes before database access', () => {
  assert.throws(() => parseManualCardWorkbook(Buffer.from('not a workbook')), /unsupported spreadsheet format/);
});

test('manual workbook parser never accepts a file over the bounded size', () => {
  assert.throws(() => parseManualCardWorkbook(Buffer.alloc(2 * 1024 * 1024 + 1)), /exceeds 2MB/);
});


function workbook(rows) {
  const strings = rows.flat();
  const shared = `<sst>${strings.map((value) => `<si><t>${String(value)}</t></si>`).join('')}</sst>`;
  let cursor = 0;
  const sheet = `<worksheet><sheetData>${rows.map((row, ri) => `<row r="${ri + 1}">${row.map((_, ci) => {
    let n = ci + 1; let col = ''; while (n) { n -= 1; col = String.fromCharCode(65 + (n % 26)) + col; n = Math.floor(n / 26); }
    return `<c r="${col}${ri + 1}" t="s"><v>${cursor++}</v></c>`;
  }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return Buffer.from(zipSync({ 'xl/sharedStrings.xml': strToU8(shared), 'xl/worksheets/sheet1.xml': strToU8(sheet) }));
}
const headers = ['卡序列号','累计充值','累计消费','余额','卡号','CVC','有效期','开卡状态','开卡时间','FirstName','LastName','州','城市','街道','邮编','标签','分组名称'];

test('preview is source-scoped and does not hard-code a product minimum balance', async () => {
  const bytes = workbook([
    ['title', ...Array(16).fill('')], headers,
    ['seq-1','2','0','2','4111' + '1111'.repeat(3),'1' + '23','12/29','已激活','x','Test','One','DE','Wilmington','1 Main St','19801','',''],
    ['seq-2','20','0','20','5555' + '5555'.repeat(2) + '4444','4' + '56','12/29','停用','x','Test','Two','DE','Wilmington','2 Main St','19801','','']
  ]);
  const pool = { async getConnection() { throw new Error('not used'); }, async query(sql) {
    if (/FROM provider_accounts/.test(sql)) return [[{ id: 'source-a', provider_code: 'manual_excel', account_code: 'a', display_name: 'A', source_adapter: 'backup_card_export_v1', supports_browser_recharge: 1 }]];
    if (/FROM cards WHERE provider_account_id/.test(sql)) return [[], []];
    if (/pan_hmac IN/.test(sql)) return [[], []];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const service = createManualCardImportService({ pool, encryptionKey: Buffer.alloc(32, 1), panHmacKey: Buffer.alloc(32, 2) });
  const result = await service.preview({ providerAccountId: 'source-a', fileBase64: bytes.toString('base64') });
  assert.equal(result.insertCount, 1);
  assert.equal(result.unavailableCount, 1);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.commitAllowed, true);
  assert.match(result.confirmation, /完整快照/);
});
