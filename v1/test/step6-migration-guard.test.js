import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {step6MigrationPlan,preflightStep6Migrations} from '../src/db/step6-migration-guard.js';

const names=['055_cdk_issuance_and_expiry.sql','056_cdk_sales_metadata.sql','057_alert_incident_version.sql'];
const sources=await Promise.all(names.map(async file=>({file,sql:await readFile(new URL('../migrations/'+file,import.meta.url),'utf8')})));

test('recovery plans are bound to reviewed SQL and contain all 15 additive steps',()=>{
  assert.deepEqual(sources.map(({file,sql})=>step6MigrationPlan(file,sql).length),[4,8,3]);
  for(const {file,sql} of sources)assert.throws(()=>step6MigrationPlan(file,sql+'\n-- unreviewed edit'),{code:'MIGRATION_SOURCE_MISMATCH'});
  assert.equal(step6MigrationPlan('054_card_retirement.sql','unchanged legacy'),null);
});

function reader({root=false,badColumn=false}={}){
  const queries=[];
  return {queries,async query(sql,args){
    queries.push(sql);assert.match(sql,/^(SELECT|SHOW)/,'preflight cannot issue DDL or DML');
    if(sql.startsWith('SELECT DATABASE'))return [[{db:'test',logBin:1,trustCreators:0,metadataExists:1}]];
    if(sql==='SHOW GRANTS')return [[{grant:root?'GRANT ALL PRIVILEGES ON *.* TO test':'GRANT ALL PRIVILEGES ON `test`.* TO test'}]];
    if(badColumn&&sql.includes('information_schema.COLUMNS')&&args[1]==='issued_at')return [[{COLUMN_TYPE:'varchar(30)',IS_NULLABLE:'YES',COLUMN_DEFAULT:null,EXTRA:'',GENERATION_EXPRESSION:'',COLLATION_NAME:'x',TABLE_COLLATION:'x'}]];
    return [[]];
  }};
}

test('schema-only account fails trigger preflight without any schema change',async()=>{
  const c=reader();await assert.rejects(()=>preflightStep6Migrations(c,sources,new Set()),{code:'MIGRATION_TRIGGER_PRIVILEGE_REQUIRED'});
  assert.ok(c.queries.every(sql=>/^(SELECT|SHOW)/.test(sql)));
});

test('wrong existing column and missing recorded structure fail closed',async()=>{
  await assert.rejects(()=>preflightStep6Migrations(reader({root:true,badColumn:true}),sources,new Set()),{code:'MIGRATION_SCHEMA_MISMATCH'});
  await assert.rejects(()=>preflightStep6Migrations(reader({root:true}),sources,new Set(['055_cdk_issuance_and_expiry'])),{code:'MIGRATION_SCHEMA_MISMATCH'});
});

test('058 widening accepts only the original or reviewed target definition, without writing during preflight',async()=>{
  const file='058_app_settings_report_capacity.sql',sql=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');
  const steps=step6MigrationPlan(file,sql);assert.equal(steps.length,1);assert.equal(steps[0].kind,'widen-column');
  assert.throws(()=>step6MigrationPlan(file,sql+' '),{code:'MIGRATION_SOURCE_MISMATCH'});
  for(const type of ['varchar(255)','mediumtext','int']){
    const base=reader({root:true});const originalQuery=base.query.bind(base);
    base.query=async(q,p)=>q.includes('information_schema.COLUMNS')?[[{COLUMN_TYPE:type,IS_NULLABLE:'NO',COLUMN_DEFAULT:null,EXTRA:'',GENERATION_EXPRESSION:'',COLLATION_NAME:'utf8mb4_unicode_ci',TABLE_COLLATION:'utf8mb4_unicode_ci'}]]:originalQuery(q,p);
    if(type==='int')await assert.rejects(()=>preflightStep6Migrations(base,[{file,sql}],new Set()),{code:'MIGRATION_SCHEMA_MISMATCH'});
    else await preflightStep6Migrations(base,[{file,sql}],new Set());
    if(type==='varchar(255)')await assert.rejects(()=>preflightStep6Migrations(base,[{file,sql}],new Set(['058_app_settings_report_capacity'])),{code:'MIGRATION_SCHEMA_MISMATCH'});
  }
});
