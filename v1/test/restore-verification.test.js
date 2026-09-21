import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { parseRestoreKeys, validateRestoreContainer, validateRestoreTrigger, validateDailySummary } from '../scripts/verify-restored-backup.mjs';

const encoded = randomBytes(32).toString('base64');
test('pre-058 observed summary remains explicitly legacy; new schema and malformed summaries fail closed',()=>{
  const old={generatedAt:'2026-09-18T08:29:39.596Z',discrepancyFingerprints:['old-fingerprint']};
  assert.equal(validateDailySummary(JSON.stringify(old),false),'LEGACY_FORMAT');
  assert.throws(()=>validateDailySummary(JSON.stringify(old),true),/RESTORE_DAILY_SUMMARY_INVALID/);
  assert.equal(validateDailySummary(JSON.stringify({...old,date:'2026-09-21',persistentFingerprints:[]}),true),'OK');
  for(const value of ['{}','not-json',JSON.stringify({...old,generatedAt:'bad'}),JSON.stringify({...old,discrepancyFingerprints:[null]})])assert.throws(()=>validateDailySummary(value,false),/RESTORE_DAILY_SUMMARY_INVALID/);
});
const keyText = `SESSION_ENCRYPTION_KEY_BASE64=${encoded}\nexport CDK_RECOVERY_KEY_BASE64="${encoded}"\nDATABASE_URL=not-evaluated\n`;
test('restoration key file is parsed as data and only whitelisted keys are used', () => {
  assert.deepEqual(Object.keys(parseRestoreKeys(keyText)), ['SESSION_ENCRYPTION_KEY_BASE64','CDK_RECOVERY_KEY_BASE64']);
  assert.equal(parseRestoreKeys(keyText).SESSION_ENCRYPTION_KEY_BASE64.length,32);
  for (const text of ['',keyText+`CDK_RECOVERY_KEY_BASE64=${encoded}`,keyText.replace(encoded,'$(touch /tmp/never-execute)'),keyText.replace(encoded,'bad')]) assert.throws(()=>parseRestoreKeys(text),/RESTORE_/);
});
const isolated={Name:'/pojia-restore-test-123',State:{Running:true},HostConfig:{NetworkMode:'none',PortBindings:{}},Config:{Labels:{'com.pojia.restore-test':'true'}}};
test('verification refuses production names, non-isolated containers and missing ownership label',()=>{
  validateRestoreContainer('pojia-restore-test-123',isolated);
  for(const [name,info] of [['pojia-mysql',isolated],['pojia-restore-test-123',{...isolated,HostConfig:{NetworkMode:'bridge'}}],['pojia-restore-test-123',{...isolated,Config:{}}],['pojia-restore-test-123',{...isolated,State:{Running:false}}]])assert.throws(()=>validateRestoreContainer(name,info),/RESTORE_CONTAINER_NOT_ISOLATED/);
});
const trigger={name:'operator_alert_incident_version_before_update',table:'operator_alerts',timing:'BEFORE',event:'UPDATE',orientation:'ROW',definer:'pojia_migrator@172.17.0.1',body:"SET NEW.incident_version = OLD.incident_version + IF(OLD.status <> 'OPEN' AND NEW.status = 'OPEN', 1, 0)"};
test('only the approved 057 trigger and exact definer can be provisioned',()=>{
  assert.equal(validateRestoreTrigger([trigger],true),true);
  assert.equal(validateRestoreTrigger([],false),false);
  for(const [rows,version] of [[[],true],[[trigger],false],[[trigger,trigger],true],[[{...trigger,definer:'root@localhost'}],true],[[{...trigger,body:'SET NEW.incident_version=1'}],true]])assert.throws(()=>validateRestoreTrigger(rows,version),/RESTORE_/);
});
