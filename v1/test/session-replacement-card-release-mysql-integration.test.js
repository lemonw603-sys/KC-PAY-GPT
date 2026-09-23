import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { zipSync, strToU8 } from 'fflate';
import { createManualCardImportService } from '../src/services/manual-card-import-service.js';
import { createOrderFromCdk } from '../src/db/repositories/order-intake-repository.js';
import { createWorkflowRepository } from '../src/db/repositories/workflow-repository.js';
import { replaceCustomerSessionInTransaction } from '../src/db/repositories/session-replacement-repository.js';

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
 * D-355 真库走一遍：建单 → 分卡（CARD_READY，卡 ASSIGNED、账本 RESERVED）→ 打回等 Session
 * → 卡回 AVAILABLE、分配 RELEASED、账本 RELEASED、assigned_card_id 清空 → 客户重贴
 * → 回 WAITING_FOR_CARD 并重排 ASSIGN_CARD → 再分卡拿回同一张。
 */
integration('D-355: WAITING_FOR_SESSION releases the card and the resubmission re-assigns it', async (t) => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  t.after(() => pool.end());
  const suffix = crypto.randomUUID().slice(0, 8);
  const source = crypto.randomUUID();
  await pool.query(`INSERT INTO provider_accounts
    (id,provider_code,account_code,display_name,environment,purpose,source_adapter,
     supports_browser_recharge,operational_enabled,read_enabled,write_enabled,max_concurrency)
    VALUES (?, 'manual_excel', ?, 'D355', 'PRODUCTION','CARD','backup_card_export_v1',1,1,0,0,1)`, [source, `d355-${suffix}`]);
  const encryptionKey = Buffer.alloc(32, 3), panHmacKey = Buffer.alloc(32, 4);
  const importer = createManualCardImportService({ pool, encryptionKey, panHmacKey });
  const pan = '4' + Array.from({ length: 15 }, () => crypto.randomInt(0, 10)).join('');
  const bytes = workbook([card(`c-${suffix}`, pan, '20')]);
  const preview = await importer.preview({ providerAccountId: source, fileBase64: bytes.toString('base64') });
  await importer.commit({ providerAccountId: source, fileBase64: bytes.toString('base64'), confirmation: preview.confirmation });

  const productId = '00000000-0000-4000-8000-000000000201';
  await pool.query(`UPDATE app_settings SET setting_value=CASE setting_key
    WHEN 'accept_new_orders' THEN 'true' WHEN 'default_card_type_id' THEN '1'
    WHEN 'default_open_card_amount' THEN '18' WHEN 'default_minimum_required_card_balance' THEN '16'
    ELSE setting_value END WHERE setting_key IN
    ('accept_new_orders','default_card_type_id','default_open_card_amount','default_minimum_required_card_balance')`);
  await pool.query(`UPDATE fulfillment_routes SET accepts_new_orders=(executor_kind='BROWSER') WHERE product_id=?`, [productId]);
  await pool.query(`UPDATE card_source_selections SET provider_account_id=?,version=version+1 WHERE product_id=? AND executor_kind='BROWSER'`, [source, productId]);
  await pool.query("INSERT INTO app_settings (setting_key, setting_value) VALUES ('browser_worker_heartbeat_at', ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)", [new Date().toISOString()]);
  const cdkId = crypto.randomUUID(), orderId = crypto.randomUUID();
  await pool.query(`INSERT INTO cdks (id,code_hash,hash_version,status,batch_no,plan_type) VALUES (?,?,'test-v2','AVAILABLE',?,'plus')`, [cdkId, crypto.randomBytes(32).toString('hex'), `d355-${suffix}`]);
  const [[cdk]] = await pool.query('SELECT code_hash FROM cdks WHERE id=?', [cdkId]);
  await createOrderFromCdk(pool, { orderId, publicNo: `D355-${suffix}`, cdkLookup: { current: { version: 'test-v2', hash: cdk.code_hash }, legacy: { version: 'none', hash: '0'.repeat(64) } },
    customerEmail: 'd355@example.invalid', chatgptAccountId: `acct-${suffix}`, sessionCiphertext: 'cipher-1', cardPurchaseIdempotencyKey: `purchase-${suffix}` });
  const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: encryptionKey, panHmacKey });
  const assigned = await workflow.assignAvailableCard(orderId);
  assert.equal(assigned.providerCardId, `c-${suffix}`);
  const [[before]] = await pool.query('SELECT o.status, o.assigned_card_id, c.inventory_status FROM orders o JOIN cards c ON c.id=o.assigned_card_id WHERE o.id=?', [orderId]);
  assert.equal(before.status, 'CARD_READY'); assert.equal(before.inventory_status, 'ASSIGNED');
  const cardId = before.assigned_card_id;

  await workflow.markSessionReplacementRequired(orderId, { failureCode: 'SESSION_INVALID', failureReason: 'test', customerActionCode: 'SESSION_INVALID' });
  const [[after]] = await pool.query('SELECT status, assigned_card_id FROM orders WHERE id=?', [orderId]);
  assert.deepEqual(after, { status: 'WAITING_FOR_SESSION', assigned_card_id: null });
  const [[freed]] = await pool.query('SELECT inventory_status, order_id FROM cards WHERE id=?', [cardId]);
  assert.deepEqual(freed, { inventory_status: 'AVAILABLE', order_id: null });
  const [assignments] = await pool.query('SELECT status, released_by FROM card_assignment_history WHERE order_id=? ORDER BY id', [orderId]);
  assert.deepEqual(assignments.map((r) => [r.status, r.released_by]), [['RELEASED', 'worker:session-replacement-required']]);
  const [ledger] = await pool.query('SELECT status FROM card_consumption_ledger WHERE order_id=?', [orderId]);
  assert.deepEqual(ledger.map((r) => r.status), ['RELEASED']);
  const [[event]] = await pool.query(`SELECT JSON_EXTRACT(metadata_json, '$.cardRelease.released') AS released FROM order_events WHERE order_id=? AND to_status='WAITING_FOR_SESSION' ORDER BY id DESC LIMIT 1`, [orderId]);
  assert.equal(String(event.released), 'true');

  // 客户重贴：没有卡 → WAITING_FOR_CARD + ASSIGN_CARD 重排；再分卡拿回同一张。
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.query(`SELECT id, public_no, status, version, customer_email, chatgpt_account_id,
      customer_action_code, session_replacement_count, session_repair_expires_at, assigned_card_id FROM orders WHERE id=? FOR UPDATE`, [orderId]);
    const resumed = await replaceCustomerSessionInTransaction(connection, { order, sessionCiphertext: 'cipher-2', customerEmail: 'd355@example.invalid', chatgptAccountId: `acct-${suffix}` });
    await connection.commit();
    assert.equal(resumed.resumeStatus, 'WAITING_FOR_CARD');
  } finally { connection.release(); }
  const [[pending]] = await pool.query(`SELECT COUNT(*) AS n FROM tasks WHERE order_id=? AND task_type='ASSIGN_CARD' AND status='PENDING'`, [orderId]);
  assert.equal(Number(pending.n), 1);
  const again = await workflow.assignAvailableCard(orderId);
  assert.equal(again.providerCardId, `c-${suffix}`);
  const [[final]] = await pool.query('SELECT o.status, c.inventory_status FROM orders o JOIN cards c ON c.id=o.assigned_card_id WHERE o.id=?', [orderId]);
  assert.deepEqual(final, { status: 'CARD_READY', inventory_status: 'ASSIGNED' });
});
