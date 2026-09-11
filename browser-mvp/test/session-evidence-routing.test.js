import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sessionProviderClass} from '../src/session-provider-selection.js';
import {sessionBootstrapEvidence} from '../src/executor.js';
import {AppendOnlyWal,WalEvidenceSink} from '../src/wal.js';
import {MysqlEvidenceSink,CompositeEvidenceSink} from '../src/mysql-evidence-sink.js';

test('single-worker provider selection defaults COOKIE, selects EXTENSION, rejects invalid mode',()=>{
 assert.equal(new (sessionProviderClass())({source:{load(){}}}).adapterMode,'COOKIE');
 assert.equal(new (sessionProviderClass('EXTENSION'))({source:{load(){}}}).adapterMode,'EXTENSION');
 assert.throws(()=>sessionProviderClass('INVALID'));
});
test('actual branch evidence reaches WAL and MySQL JSON unchanged',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'session-evidence-'));
 try {
 const wal=await new AppendOnlyWal({filePath:join(dir,'events.wal')}).init();
 let stored;
 const sink=new CompositeEvidenceSink([new WalEvidenceSink(wal),new MysqlEvidenceSink({pool:{query:async(_sql,args)=>{stored=JSON.parse(args[6]);return [];}}})]);
 const summary={action:'session-bootstrap',...sessionBootstrapEvidence({adapterMode:'EXTENSION'},{viaExtension:true},'attempt-1')};
 await sink.append({jobId:'fixture:job',type:'checkpoint',sequence:1,payloadDigest:'a'.repeat(64),summary});
 assert.deepEqual(stored,summary);
 const {readFile}=await import('node:fs/promises');const entry=JSON.parse((await readFile(join(dir,'events.wal'),'utf8')).trim());
 assert.deepEqual(entry.event.summary,summary);
 } finally {await rm(dir,{recursive:true,force:true});}
});
