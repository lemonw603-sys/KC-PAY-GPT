import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { zipSync, strToU8 } from 'fflate';
import { createManualCardImportService } from '../src/services/manual-card-import-service.js';
import { createOrderFromCdk } from '../src/db/repositories/order-intake-repository.js';
import { createWorkflowRepository } from '../src/db/repositories/workflow-repository.js';

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
function card(sequence, pan, balance='20', status='已激活') {
  return [sequence,balance,'0',balance,pan,'1'+'23','12/29',status,'x','Test','User','DE','Wilmington','1 Main St','19801','',''];
}

integration('multi-source snapshots, order freeze and allocation share one authoritative source boundary', async (t) => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, timezone: 'Z' });
  t.after(() => pool.end());
  const suffix = crypto.randomUUID().slice(0, 8);
  const sourceA = crypto.randomUUID(), sourceB = crypto.randomUUID();
  await pool.query(`INSERT INTO provider_accounts
    (id,provider_code,account_code,display_name,environment,purpose,source_adapter,
     supports_browser_recharge,operational_enabled,read_enabled,write_enabled,max_concurrency)
    VALUES (?, 'manual_excel', ?, 'Test A','PRODUCTION','CARD','backup_card_export_v1',1,1,0,0,1),
           (?, 'manual_excel', ?, 'Test B','PRODUCTION','CARD','backup_card_export_v1',1,1,0,0,1)`,
  [sourceA, `test-a-${suffix}`, sourceB, `test-b-${suffix}`]);
  const encryptionKey=Buffer.alloc(32,3), panHmacKey=Buffer.alloc(32,4);
  const importer=createManualCardImportService({pool,encryptionKey,panHmacKey});
  const digits=()=>Array.from({length:15},()=>crypto.randomInt(0,10)).join('');
  const panA='4'+digits(), panB='5'+digits();
  const first=workbook([card(`a-${suffix}`,panA,'20'),card(`b-${suffix}`,panB,'25')]);
  const preview=await importer.preview({providerAccountId:sourceA,fileBase64:first.toString('base64')});
  assert.deepEqual([preview.insertCount,preview.unavailableCount,preview.missingCount,preview.conflictCount],[2,0,0,0]);
  await importer.commit({providerAccountId:sourceA,fileBase64:first.toString('base64'),confirmation:preview.confirmation});

  const productId='00000000-0000-4000-8000-000000000201';
  await pool.query(`UPDATE app_settings SET setting_value=CASE setting_key
    WHEN 'accept_new_orders' THEN 'true' WHEN 'default_card_type_id' THEN '1'
    WHEN 'default_open_card_amount' THEN '18' WHEN 'default_minimum_required_card_balance' THEN '18'
    ELSE setting_value END WHERE setting_key IN
    ('accept_new_orders','default_card_type_id','default_open_card_amount','default_minimum_required_card_balance')`);
  await pool.query(`UPDATE fulfillment_routes SET accepts_new_orders=(executor_kind='BROWSER') WHERE product_id=?`,[productId]);
  await pool.query(`UPDATE browser_card_source_selections SET provider_account_id=?,version=version+1 WHERE product_id=?`,[sourceA,productId]);
  const cdkId=crypto.randomUUID(), orderId=crypto.randomUUID();
  await pool.query(`INSERT INTO cdks (id,code_hash,hash_version,status,batch_no,plan_type) VALUES (?,?,'test-v2','AVAILABLE',?,'plus')`,[cdkId,crypto.randomBytes(32).toString('hex'),`test-${suffix}`]);
  const [[cdk]]=await pool.query('SELECT code_hash FROM cdks WHERE id=?',[cdkId]);
  await createOrderFromCdk(pool,{orderId,publicNo:`TEST-${suffix}`,cdkLookup:{current:{version:'test-v2',hash:cdk.code_hash},legacy:{version:'none',hash:'0'.repeat(64)}},customerEmail:'test@example.invalid',chatgptAccountId:`acct-${suffix}`,sessionCiphertext:'not-read-during-assignment',cardPurchaseIdempotencyKey:`purchase-${suffix}`});
  const [[created]]=await pool.query('SELECT frozen_card_provider_account_id FROM orders WHERE id=?',[orderId]);
  assert.equal(created.frozen_card_provider_account_id,sourceA);
  await pool.query(`UPDATE browser_card_source_selections SET provider_account_id=?,version=version+1 WHERE product_id=?`,[sourceB,productId]);
  const assigned=await createWorkflowRepository(pool,{sessionEncryptionKey:encryptionKey,panHmacKey}).assignAvailableCard(orderId);
  assert.equal(assigned.providerCardId,`a-${suffix}`);
  const [[bound]]=await pool.query(`SELECT c.provider_account_id FROM orders o INNER JOIN cards c ON c.id=o.assigned_card_id WHERE o.id=?`,[orderId]);
  assert.equal(bound.provider_account_id,sourceA,'allocation must use the order freeze, not the newly selected source');

  const second=workbook([card(`b-${suffix}`,panB,'25')]);
  const secondPreview=await importer.preview({providerAccountId:sourceA,fileBase64:second.toString('base64')});
  assert.equal(secondPreview.missingCount,1); assert.equal(secondPreview.activeRiskCount,1);
  await importer.commit({providerAccountId:sourceA,fileBase64:second.toString('base64'),confirmation:secondPreview.confirmation});
  const [[missing]]=await pool.query('SELECT source_present,inventory_status FROM cards WHERE provider_account_id=? AND external_card_id=?',[sourceA,`a-${suffix}`]);
  assert.equal(Number(missing.source_present),0); assert.equal(missing.inventory_status,'ASSIGNED');

  const duplicate=workbook([card(`other-${suffix}`,panB,'25')]);
  const conflict=await importer.preview({providerAccountId:sourceB,fileBase64:duplicate.toString('base64')});
  assert.equal(conflict.conflictCount,1); assert.equal(conflict.commitAllowed,false);
});
