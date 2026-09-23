import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { zipSync, strToU8 } from 'fflate';
import { createManualCardImportService } from '../src/services/manual-card-import-service.js';
import { eligibleInventoryCardSql } from '../src/services/card-inventory-eligibility.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const headers = ['卡序列号','累计充值','累计消费','余额','卡号','CVC','有效期','开卡状态','开卡时间','FirstName','LastName','州','城市','街道','邮编','标签','分组名称'];
function workbook(rows) {
  const table = [['title', ...Array(16).fill('')], headers, ...rows]; const strings = table.flat();
  const shared = `<sst>${strings.map((value) => `<si><t>${String(value)}</t></si>`).join('')}</sst>`;
  let cursor = 0;
  const sheet = `<worksheet><sheetData>${table.map((row, ri) => `<row r="${ri + 1}">${row.map((_, ci) => {
    let n=ci+1,col=''; while(n){n--;col=String.fromCharCode(65+n%26)+col;n=Math.floor(n/26);} return `<c r="${col}${ri+1}" t="s"><v>${cursor++}</v></c>`;
  }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return Buffer.from(zipSync({ 'xl/sharedStrings.xml': strToU8(shared), 'xl/worksheets/sheet1.xml': strToU8(sheet) }));
}
const card = (sequence, pan, balance) => [sequence,balance,'0',balance,pan,'123','12/29','已激活','x','Test','User','DE','Wilmington','1 Main St','19801','',''];

/**
 * D-354 真实数据库复现 2026-09-23 的 0601：首次快照 $3.27 入库（funded=3.27），Lemon 补钱后
 * 快照 $31.99。修前：资格取 LEAST(31.99, 3.27−0)=3.27 < 16 → 永远不合格。修后：补款 28.72 记进
 * funded → 31.99，且 card_state_events 留下 CARD_TOPUP_OBSERVED。
 */
integration('D-354: a manual-import snapshot with a higher balance raises funded_amount and makes the card eligible', async (t) => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  t.after(() => pool.end());
  const suffix = crypto.randomUUID().slice(0, 8);
  const source = crypto.randomUUID();
  await pool.query(`INSERT INTO provider_accounts
    (id,provider_code,account_code,display_name,environment,purpose,source_adapter,
     supports_browser_recharge,operational_enabled,read_enabled,write_enabled,max_concurrency)
    VALUES (?, 'manual_excel', ?, 'TopUp', 'PRODUCTION','CARD','backup_card_export_v1',1,1,0,0,1)`, [source, `topup-${suffix}`]);
  const importer = createManualCardImportService({ pool, encryptionKey: Buffer.alloc(32, 3), panHmacKey: Buffer.alloc(32, 4) });
  const pan = '4' + Array.from({ length: 15 }, () => crypto.randomInt(0, 10)).join('');
  const sequence = `seq-${suffix}`;
  const snapshot = async (balance) => {
    const bytes = workbook([card(sequence, pan, balance)]);
    const preview = await importer.preview({ providerAccountId: source, fileBase64: bytes.toString('base64') });
    await importer.commit({ providerAccountId: source, fileBase64: bytes.toString('base64'), confirmation: preview.confirmation, filename: `snap-${balance}.xlsx` });
  };
  await snapshot('3.27');
  const [[before]] = await pool.query('SELECT id, funded_amount, current_balance FROM cards WHERE provider_account_id=?', [source]);
  assert.equal(String(before.funded_amount), '3.270000');
  const eligible = async () => (await pool.query(`SELECT COUNT(*) AS n FROM cards c WHERE c.provider_account_id=? AND ${eligibleInventoryCardSql('c', '16.00')}`, [source]))[0][0].n;
  assert.equal(Number(await eligible()), 0, '补钱前：$3.27 不够 Plus 门槛');

  await snapshot('31.99');
  const [[after]] = await pool.query('SELECT funded_amount, current_balance FROM cards WHERE id=?', [before.id]);
  assert.equal(String(after.current_balance), '31.990000');
  assert.equal(String(after.funded_amount), '31.990000', 'funded 抬了 28.72，正是补款金额');
  assert.equal(Number(await eligible()), 1, '补钱后：合格（修前这里是 0）');
  const [events] = await pool.query(`SELECT source, previous_json, current_json FROM card_state_events WHERE card_id=? AND event_type='CARD_TOPUP_OBSERVED'`, [before.id]);
  assert.equal(events.length, 1);
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  assert.equal(events[0].source, 'manual_card_import');
  assert.equal(parse(events[0].current_json).topUp, '28.720000');
  assert.equal(parse(events[0].previous_json).fundedAmount, '3.270000');

  // 余额往下走（消费）不算补款：funded 不动、不再记事件。
  await snapshot('16.00');
  const [[spent]] = await pool.query('SELECT funded_amount FROM cards WHERE id=?', [before.id]);
  assert.equal(String(spent.funded_amount), '31.990000');
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM card_state_events WHERE card_id=? AND event_type='CARD_TOPUP_OBSERVED'`, [before.id]);
  assert.equal(Number(n), 1);
});
