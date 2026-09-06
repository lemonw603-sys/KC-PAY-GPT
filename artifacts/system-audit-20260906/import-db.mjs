import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import mysql from '../../node_modules/mysql2/promise.js';
import {zipSync,strToU8} from '../../v1/node_modules/fflate/esm/index.mjs';
import {createManualCardImportService} from '../../v1/src/services/manual-card-import-service.js';
const port=Number(process.env.AUDIT_MYSQL_PORT);if(!port)throw Error('isolated port required');
const options={host:'127.0.0.1',port,user:'root',database:'audit_fixture',timezone:'Z'};
const migration=await mysql.createConnection({...options,multipleStatements:true});
const files=(await fs.readdir('v1/migrations')).filter(f=>f.endsWith('.sql')).sort();
for(const f of files)await migration.query(await fs.readFile('v1/migrations/'+f,'utf8'));
await migration.end();
const pool=mysql.createPool({...options,connectionLimit:4});
const headers=['卡序列号','累计充值','累计消费','余额','卡号','CVC','有效期','开卡状态','开卡时间','FirstName','LastName','州','城市','街道','邮编','标签','分组名称'];
const row=(id,expiry='12/39')=>[id,'20','0','20','4111111111111111','123',expiry,'已激活','fixture','Test','Only','DE','Wilmington','Fixture St','19801','',''];
function workbook(data){const rows=[['fixture'],headers,...data];let cursor=0;
 const shared='<sst>'+rows.flat().map(v=>`<si><t>${v}</t></si>`).join('')+'</sst>';
 const sheet='<worksheet><sheetData>'+rows.map((r,ri)=>`<row r="${ri+1}">`+r.map((_,ci)=>`<c r="${String.fromCharCode(65+ci)}${ri+1}" t="s"><v>${cursor++}</v></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>';
 return Buffer.from(zipSync({'xl/sharedStrings.xml':strToU8(shared),'xl/worksheets/sheet1.xml':strToU8(sheet)}));}

try{
const source='00000000-0000-4000-8000-000000000103';
const svc=createManualCardImportService({pool,encryptionKey:Buffer.alloc(32,1),panHmacKey:Buffer.alloc(32,2)});
const commit=data=>svc.commit({providerAccountId:source,fileBase64:workbook(data).toString('base64'),confirmation:`确认提交 ${data.length} 张卡的完整快照`});
await commit([row('seq-a'),row('seq-b')]);
const[duplicates]=await pool.query('SELECT pan_hmac,COUNT(*) n FROM cards WHERE provider_account_id=? GROUP BY pan_hmac',[source]);
assert.equal(duplicates[0].n,2);
const [[card]]=await pool.query('SELECT id,pan_hmac FROM cards WHERE external_card_id="seq-a"');
const cdk=crypto.randomUUID(),order=crypto.randomUUID();
await pool.query('INSERT INTO cdks(id,code_hash,status) VALUES (?, ?, "REDEEMED")',[cdk,crypto.createHash('sha256').update(cdk).digest('hex')]);
await pool.query('INSERT INTO orders(id,public_no,cdk_id,status,session_ciphertext,card_purchase_idempotency_key,assigned_card_id) VALUES (?,?,?,"RECHARGE_PROCESSING",?, ?, ?)',[order,'fixture-'+order,cdk,Buffer.from('synthetic-not-session'),'fixture-'+order,card.id]);
await pool.query('INSERT INTO card_assignment_history(id,card_id,order_id,assigned_by) VALUES (?,?,?,"fixture")',[crypto.randomUUID(),card.id,order]);
await pool.query('UPDATE cards SET inventory_status="ASSIGNED" WHERE id=?',[card.id]);
const replacement=row('seq-a');replacement[4]='5555555555554444';
await commit([replacement,row('seq-b')]);
const [[changed]]=await pool.query('SELECT pan_hmac,inventory_status FROM cards WHERE id=?',[card.id]);
assert.notEqual(changed.pan_hmac,card.pan_hmac);assert.equal(changed.inventory_status,'ASSIGNED');
await commit([]);
const [missing]=await pool.query('SELECT source_present,inventory_status,COUNT(*) n FROM cards WHERE provider_account_id=? GROUP BY source_present,inventory_status',[source]);
assert(missing.every(x=>x.source_present===0));
console.log(JSON.stringify({mode:'FULL_MIGRATION_MYSQL_ACTUAL_IMPORT_SERVICE',migrationFiles:files.length,samePanStoredRows:duplicates[0].n,activeCardIdentityChanged:true,activeInventoryPreserved:changed.inventory_status,emptySnapshot:missing,limits:'Sequential actual import commits with active assignment; no Provider or real customer; concurrent allocation not exercised.'},null,2));
}finally{await pool.end();}
