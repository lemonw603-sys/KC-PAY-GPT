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
const sourceA='00000000-0000-4000-8000-000000000103',sourceB='00000000-0000-4000-8000-000000000104';
await pool.query(`INSERT INTO provider_accounts(id,provider_code,account_code,display_name,environment,purpose,source_adapter,supports_browser_recharge,read_enabled,write_enabled,max_concurrency) VALUES (?, 'manual_excel','audit-b','Fixture B','PRODUCTION','CARD','backup_card_export_v1',1,0,0,1)`,[sourceB]);
const svc=createManualCardImportService({pool,encryptionKey:Buffer.alloc(32,1),panHmacKey:Buffer.alloc(32,2)});
const input=(id,seq)=>({providerAccountId:id,fileBase64:workbook([row(seq)]).toString('base64'),confirmation:'确认提交 1 张卡的完整快照'});
const outcomes=await Promise.allSettled([svc.commit(input(sourceA,'seq-race-a')),svc.commit(input(sourceB,'seq-race-b'))]);
const [cards]=await pool.query('SELECT COUNT(*) n,COUNT(DISTINCT provider_account_id) sources FROM cards');
console.log(JSON.stringify({mode:'FULL_48_MIGRATIONS_MYSQL_CONCURRENT_IMPORT',outcomes:outcomes.map(o=>({status:o.status,error:o.reason?.code||null})),stored:cards[0],note:'Single simultaneous race sample, not exhaustive timing proof; no Provider.'},null,2));
assert.equal(Number(cards[0].n),1);
}finally{await pool.end();}
