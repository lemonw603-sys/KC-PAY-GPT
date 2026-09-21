// Local-only acceptance: real app/UI + MySQL, synthetic data, no provider or worker.
// Run: node scripts/step6-safety-acceptance.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import mysql from '../v1/node_modules/mysql2/promise.js';
import { createApp } from '../v1/src/app/create-app.js';
import { createAdminSessionAuth, hashAdminPassword } from '../v1/src/security/admin-session.js';
import { createAdminReadService } from '../v1/src/services/admin-read-service.js';
import { createAdminOperationsService } from '../v1/src/services/admin-operations-service.js';
import { createBrowserAdminService } from '../v1/src/services/browser-admin-service.js';
import { createBrowserExecutionRepository } from '../v1/src/db/repositories/browser-execution-repository.js';
import { createUnknownSubmissionResolveService } from '../v1/src/services/unknown-submission-resolve-service.js';
import { createReconciliationCaseService } from '../v1/src/services/reconciliation-case-service.js';
import { createAdminCdkService, downloadCdkBatch } from '../v1/src/services/cdk-service.js';
import { createCdkVerifyService } from '../v1/src/services/cdk-verify-service.js';
import { createOrderIntakeService } from '../v1/src/services/order-intake-service.js';
import { createWorkflowRepository } from '../v1/src/db/repositories/workflow-repository.js';
import { upsertBrowserAlertInTransaction } from '../v1/src/db/repositories/browser-alert-repository.js';
import { sessionFixture } from '../v1/test-support/session-fixture.js';
import { createCdkLookup } from '../v1/src/security/cdk-code.js';
import { encryptSecret, decryptSecret } from '../v1/src/security/secret-box.js';
import { loadRuntimeSettings } from '../v1/src/db/repositories/settings-repository.js';
import { allowedTaskTypesFor } from '../v1/src/workers/worker-runtime.js';
import { eligibleInventoryCardSql } from '../v1/src/services/card-inventory-eligibility.js';
import { createDailyReconciliationService } from '../v1/src/services/daily-reconciliation-service.js';
import { createCardSourceAdminService } from '../v1/src/services/card-source-admin-service.js';
import { createBrowserBillingAddressAdminService } from '../v1/src/services/browser-billing-address-admin-service.js';
import { createOperationsCsvExportService } from '../v1/src/services/operations-csv-export-service.js';
import { Cdp, launchChrome, openPage } from './visual-parity.mjs';

const suffix = crypto.randomBytes(4).toString('hex');
const database = `step6_safety_${suffix}`, migrator = `safety_${suffix}`;
const restoreContainer = `step6-restore-${suffix}`;
const diagnosticsMode = process.env.DIAGNOSTICS_ACCEPTANCE === '1';
const output = new URL(diagnosticsMode ? '../output/playwright/diagnostics/' : '../output/playwright/step6-safety/', import.meta.url);
const report = { startedAt: new Date().toISOString(), checks: [], failures: [], isolation: { database, restoreContainer, syntheticOnly: true, providersRegistered: false, workersStarted: false } };
await mkdir(output, { recursive: true });
let owner, pool, restored, restoreOwner, server, chrome, cdp, restoreTunnel, restoreCreated = false, dbCreated = false, userCreated = false;
const tunnelChildren=new Set();
const key = crypto.randomBytes(32), hashKey = crypto.randomBytes(32), recoveryKey = crypto.randomBytes(32);
const mark = (name, evidence) => { report.checks.push({ name, evidence }); console.log('PASS', name); };
async function command(bin, args, { env = {}, input } = {}) {
  const child = spawn(bin, args, { env: { ...process.env, ...env }, stdio: ['pipe','pipe','pipe'] });
  const out = [], err = []; child.stdout.on('data', b => out.push(b)); child.stderr.on('data', b => err.push(b));
  child.stdin.end(input); const [code] = await once(child,'exit');
  return { code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() };
}
async function checked(bin,args,options) { const r=await command(bin,args,options); assert.equal(r.code,0,r.stderr);return r.stdout; }
async function section(name, fn) { try { await fn(); } catch(e) { report.failures.push({name,error:e.message,stack:e.stack}); console.error('FAIL',name,e.message); } }
const sql = async (q,p=[]) => (await pool.query(q,p))[0];
const scalar = async (q,p=[]) => Object.values((await sql(q,p))[0])[0];
async function snapshot(ids) {
  const [row] = await sql(`SELECT o.status orderStatus, o.failure_code, o.cancellation_review_required,
    rat.status attemptStatus,rat.funds_risk_state funds, c.status cdkStatus,c.order_id cdkOrder,
    l.status ledger,a.status assignment,card.inventory_status inventory
    FROM orders o JOIN recharge_attempts rat ON rat.order_id=o.id JOIN cdks c ON c.id=o.cdk_id
    JOIN card_consumption_ledger l ON l.recharge_attempt_id=rat.id JOIN card_assignment_history a ON a.order_id=o.id
    JOIN cards card ON card.id=a.card_id WHERE o.id=?`,[ids.orderId]);
  row.cases=await sql('SELECT case_type,status FROM reconciliation_cases WHERE order_id=?',[ids.orderId]);
  row.alerts=await sql('SELECT alert_type,status FROM operator_alerts WHERE order_id=?',[ids.orderId]);
  row.attempts=Number(await scalar('SELECT COUNT(*) FROM recharge_attempts WHERE order_id=?',[ids.orderId]));
  row.tasks=Number(await scalar('SELECT COUNT(*) FROM tasks WHERE order_id=?',[ids.orderId]));
  return row;
}
try {
  report.commit=(await checked('git',['rev-parse','HEAD'])).toString().trim();
  report.sourceSha256 = {};
  for (const file of ['v1/public/admin/index.html','v1/public/admin/assets/admin.js','v1/public/admin/assets/diagnostics.js','v1/public/admin/assets/diagnostics.css','v1/src/services/reconciliation-case-service.js','v1/src/app/create-app.js']) {
    report.sourceSha256[file] = crypto.createHash('sha256').update(await readFile(file)).digest('hex');
  }
  const info=JSON.parse((await checked('docker',['inspect','pojia-stage1-mysql'])).toString())[0];
  const binding=info.NetworkSettings.Ports['3306/tcp'][0]; assert.equal(binding.HostIp,'127.0.0.1'); assert.notEqual(binding.HostPort,'13306');
  const password=info.Config.Env.find(e=>e.startsWith('MYSQL_ROOT_PASSWORD=')).slice('MYSQL_ROOT_PASSWORD='.length);
  const base=new URL(`mysql://root@127.0.0.1:${binding.HostPort}/`);base.password=password;
  owner=await mysql.createConnection({uri:base.href,timezone:'Z'});
  await owner.query(`CREATE DATABASE ${database}`);dbCreated=true;
  const source=new URL(database,base);pool=mysql.createPool({uri:source.href,timezone:'Z',connectionLimit:4});
  await checked(process.execPath,['v1/scripts/migrate.js'],{env:{MIGRATION_DATABASE_URL:source.href,MIGRATION_DATABASE_TLS:'false'}});
  for(const [k,v] of [['default_card_type_id','7'],['default_open_card_amount','50'],['default_minimum_required_card_balance','16']])await sql('UPDATE app_settings SET setting_value=? WHERE setting_key=?',[v,k]);
  const fixtureSource=await readFile(new URL('../v1/test/browser-resolve-unknown-payment-mysql-integration.test.js',import.meta.url),'utf8');
  const start=fixtureSource.indexOf('async function createFixture('),end=fixtureSource.indexOf('async function cleanup(');
  assert.ok(start>0&&end>start);
  // Reuse the existing real-DB fixture functions, not their test registration or expected outcomes.
  const helpers=new Function('crypto','createBrowserExecutionRepository',`const productId='00000000-0000-4000-8000-000000000201',routeId='00000000-0000-4000-8000-000000000302',hnskjAccountId='00000000-0000-4000-8000-000000000101';${fixtureSource.slice(start,end)};return {createFixture,moveToStuck};`)(crypto,createBrowserExecutionRepository);
  const browser=createBrowserAdminService({pool}),ops=createAdminOperationsService({pool});
  const read=createAdminReadService({pool,sessionEncryptionKey:key,cdkHashKey:hashKey,panHmacKey:crypto.randomBytes(32)});
  const cases=createReconciliationCaseService({pool});
  const daily=createDailyReconciliationService({pool}),cardSources=createCardSourceAdminService({pool}),billing=createBrowserBillingAddressAdminService({pool});
  const verify=createCdkVerifyService({pool,cdkHashKey:hashKey});
  const intake=createOrderIntakeService({pool,sessionEncryptionKey:key,cdkHashKey:hashKey});
  await ops.setOrderAcceptance({enabled:true,confirmation:'开始接单'});
  const adminPassword=crypto.randomUUID();
  const app=createApp({adminAuth:createAdminSessionAuth({passwordHash:await hashAdminPassword(adminPassword),sessionSecret:crypto.randomBytes(32),secureCookies:false}),
    getAdminOverview:read.getOverview,listAdminOrders:read.listOrders,getAdminOrder:read.getOrder,getAdminOrderTimeline:read.getOrderTimeline,listAdminAlerts:read.listAlerts,
    listAdminReconciliationCases:cases.listCases,resolveAdminReconciliationCase:cases.resolve,listAdminBrowserRuns:browser.listRuns,getAdminBrowserRun:browser.getRun,
    listAdminBrowserDispatchJobs:browser.listDispatchJobs,runDailyReconciliation:()=>daily.run({persist:false}),listAdminCardSources:cardSources.list,
    getAdminBillingAddressSettings:billing.get,setAdminBillingAddressSettings:billing.set,getAdminCard:read.getCard,exportAdminOperationsCsv:createOperationsCsvExportService({pool}).exportCsv,
    controlAdminBrowserRun:browser.controlRun,resolveUnknownSubmission:createUnknownSubmissionResolveService({pool}),
    setAdminOrderAcceptance:ops.setOrderAcceptance,setAdminDispatch:ops.setDispatch,setAdminBrowserPaymentWrites:ops.setBrowserPaymentWrites});
  server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const web=`http://127.0.0.1:${server.address().port}`;report.isolation.web=web;
  chrome=await launchChrome();cdp=await Cdp.connect(chrome.wsUrl);
  const sid=await openPage(cdp,web+'/admin/',{width:1440,height:1000,login:{password:adminPassword}});
  const ev=async body=>{const r=await cdp.send('Runtime.evaluate',{expression:`(async()=>{${body}})()`,awaitPromise:true,returnByValue:true},sid);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const wait=async expr=>ev(`const end=Date.now()+12000;while(!(${expr})){if(Date.now()>end)throw Error('UI timeout: '+${JSON.stringify(expr)});await new Promise(r=>setTimeout(r,50));}return true;`);
  const click=async selector=>{await wait(`document.querySelector(${JSON.stringify(selector)})`);return ev(`document.querySelector(${JSON.stringify(selector)}).click();`);};
  const fill=(selector,value)=>ev(`const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing field');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));`);
  async function capture(name) { const {data}=await cdp.send('Page.captureScreenshot',{format:'png'},sid);await writeFile(new URL(name+'.png',output),Buffer.from(data,'base64')); }
  async function reload(){await ev('await loadOverview();');await wait('document.querySelector("[data-op=pay]")');}
  await section('payment gate scope',async()=>{
    await ops.setBrowserPaymentWrites({enabled:true});await ops.setDispatch({enabled:true,confirmation:'开始自动充值'});
    await reload();await click('[data-op=pay]');await wait('document.querySelector("[data-op=pay]").dataset.on==="false"');
    const rows=await sql("SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('browser_payment_writes_enabled','dispatch_new_recharges','poll_existing_orders','sync_card_transactions') ORDER BY setting_key");
    assert.equal(rows.find(r=>r.setting_key==='browser_payment_writes_enabled').setting_value,'false');
    assert.equal(rows.find(r=>r.setting_key==='dispatch_new_recharges').setting_value,'true');
    const runtime=await loadRuntimeSettings(pool);const permitted=allowedTaskTypesFor(runtime,{providerReadsEnabled:true,providerRechargeWritesEnabled:true});
    assert.ok(permitted.includes('SUBMIT_RECHARGE'));
    await assert.rejects(()=>createBrowserExecutionRepository(pool).issuePaymentPermit({runId:'isolated-run',workerId:'isolated-worker',leaseToken:'isolated'}),{code:'BROWSER_PAYMENT_WRITES_DISABLED'});
    await assert.rejects(()=>createBrowserExecutionRepository(pool).commitPaymentSubmissionIntent({runId:'isolated-run',workerId:'isolated-worker',leaseToken:'isolated',permitNonce:'isolated',operationId:'isolated-submit'}),{code:'BROWSER_PAYMENT_WRITES_DISABLED'});
    await capture('payment-off');mark('Browser payment off rejects new permit; API submission remains eligible',{settings:rows,allowedTasks:permitted});
    await click('[data-op=dispatch]');await wait('document.querySelector("[data-op=dispatch]").dataset.on==="false"');
    const stopped=allowedTaskTypesFor(await loadRuntimeSettings(pool),{providerReadsEnabled:true,providerRechargeWritesEnabled:true});
    assert.ok(!stopped.includes('SUBMIT_RECHARGE'));assert.ok(stopped.includes('POLL_RECHARGE'));assert.ok(stopped.includes('SYNC_CARD_TRANSACTIONS'));
    mark('dispatch off excludes new submit, keeps poll and card synchronization',{allowedTasks:stopped,scope:'scheduler eligibility; no external submission executed'});
  });
  const fixtures=[];
  for(const kind of ['API','BROWSER'])for(const outcome of ['CHARGED','NOT_CHARGED']) {
    await section(`${kind} ${outcome} UI closeout`,async()=>{
      const f=await helpers.createFixture(pool,`${kind}-${outcome}`,{seedCase:false});const ids=f.ids;fixtures.push(ids);
      const code='PLUS-'+crypto.randomBytes(16).toString('hex').toUpperCase();const lookup=createCdkLookup(code,hashKey);
      // Hash shape follows the actual lookup helper; values are never printed.
      await sql('UPDATE cdks SET code_hash=?,hash_version=?,issued_at=NOW(3),issuance_kind=\'NORMAL\' WHERE id=?',[lookup.current.hash,lookup.current.version,ids.cdkId]);
      await sql('UPDATE orders SET session_ciphertext=?,customer_email=? WHERE id=?',[encryptSecret('{"synthetic":true}',key),`${kind.toLowerCase()}-${outcome.toLowerCase()}@example.test`,ids.orderId]);
      await sql('UPDATE cards SET card_credentials_ciphertext=?,funded_amount=50,current_balance=50,last4=? WHERE id=?',[encryptSecret('{}',key),String(2400+fixtures.length),ids.cardId]);
      if(kind==='API'){
        await helpers.moveToStuck(pool,ids,{runStatus:'RECONCILE_ONLY',verificationState:'NOT_REQUIRED',orderStatus:'SUBMIT_UNKNOWN'});
        for(const table of ['browser_checkpoints','browser_run_events','browser_operations','execution_resource_leases'])await sql(`DELETE FROM ${table} WHERE browser_run_id=?`,[ids.runId]);
        await sql('DELETE FROM browser_runs WHERE id=?',[ids.runId]);await sql('DELETE FROM browser_dispatch_jobs WHERE recharge_attempt_id=?',[ids.attemptId]);
        const route=await scalar("SELECT id FROM fulfillment_routes WHERE executor_kind='API' AND product_id='00000000-0000-4000-8000-000000000201' LIMIT 1");
        await sql('UPDATE orders SET fulfillment_route_id=? WHERE id=?',[route,ids.orderId]);
        await sql("UPDATE recharge_attempts SET executor_kind='API',fulfillment_route_id=?,executor_profile_id=NULL WHERE id=?",[route,ids.attemptId]);
        await createWorkflowRepository(pool,{sessionEncryptionKey:key}).escalateUnknownSubmission(ids.orderId,{reasonCode:'ISOLATED_TEST',evidence:{synthetic:true}});
      }else{
        for(const [action,confirmation] of [['REQUEST',`请求人工接管 ${ids.runId}`],['FREEZE',`冻结自动化 ${ids.runId}`],['MARK_PAYMENT_UNKNOWN',`确认付款结果未知 ${ids.runId}`]])await browser.controlRun(ids.runId,{action,confirmation,operationId:crypto.randomUUID(),reasonCode:'OPERATOR_REVIEW',actorId:'isolated-test'});
        await upsertBrowserAlertInTransaction(pool,{type:'BROWSER_PAYMENT_UNKNOWN',orderId:ids.orderId,title:'隔离验收付款不明',message:'synthetic'});
      }
      const publicNo=await scalar('SELECT public_no FROM orders WHERE id=?',[ids.orderId]);
      const before=await snapshot(ids);assert.equal((await verify({cdk:code})).state,'BOUND_TO_ORDER');
      const eligible=()=>scalar(`SELECT COUNT(*) FROM cards c WHERE c.id=? AND ${eligibleInventoryCardSql('c','16')}`,[ids.cardId]);
      assert.equal(Number(await eligible()),0,'unknown funds must not make the card reusable');
      assert.ok(before.cases.length>0&&before.cases.every(c=>c.status==='OPEN'));
      await assert.rejects(()=>intake({cdk:code,session:sessionFixture()}),{code:'CDK_UNAVAILABLE'});
      if(diagnosticsMode){
        await ev("await switchView('diagnostics');");
        const caseId=await scalar('SELECT id FROM reconciliation_cases WHERE order_id=?',[ids.orderId]);
        assert.equal(await ev(`return document.querySelectorAll('[data-case-id="${caseId}"] [data-resolve-case]').length`),0);
        const blocked=await ev(`const r=await fetch('/api/v1/admin/reconciliation-cases/${caseId}/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resolutionNote:'bypass attempt'})});return {status:r.status,body:await r.json()};`);
        assert.equal(blocked.status,409);assert.equal(blocked.body.error,'case_requires_order_resolution');assert.deepEqual(await snapshot(ids),before);
        mark(`${kind} ${outcome}: forged generic-close HTTP blocked with unchanged DB`,blocked);
        await click(`[data-case-id="${caseId}"] .primary[data-open-case-order]`);
      }else{await reload();await click(`[data-open-case-order-wb="${publicNo}"]`);}
      const action=kind==='API'?'#resolve-unknown-submission':'[data-order-run-control="RESOLVE_UNKNOWN_PAYMENT"]';
      await click(action);await wait('document.querySelector(".ask-dialog")?.open');
      await fill(kind==='API'?'#ask-outcome':'#ask-verifiedOutcome',outcome);
      if(kind==='BROWSER')await fill('#ask-renewalCancelled','true');
      await fill(kind==='API'?'#ask-note':'#ask-evidenceNote','隔离验收：合成账号与卡交易证据，不涉及真实资金');
      await capture(`${kind}-${outcome}-confirmation`);await click('.ask-dialog button[type=submit]');
      await wait('!document.querySelector(".ask-dialog")?.open');
      const deadline=Date.now()+10000;while((await snapshot(ids)).funds==='UNKNOWN'){if(Date.now()>deadline)throw Error('closeout did not persist: '+await ev('return document.querySelector("#page-notice").textContent'));await new Promise(r=>setTimeout(r,100));}
      const after=await snapshot(ids);assert.equal(after.funds,outcome==='CHARGED'?'SETTLED':'CLEARED');assert.equal(after.ledger,outcome==='CHARGED'?'CONSUMED':'RELEASED');assert.equal(after.assignment,'RELEASED');
      assert.ok(after.cases.every(c=>c.status==='RESOLVED'));assert.ok(after.alerts.filter(a=>/PAYMENT_UNKNOWN/.test(a.alert_type)).every(a=>a.status==='RESOLVED'));
      assert.equal(after.attempts,before.attempts);assert.equal(after.tasks,before.tasks);
      const verdict=await verify({cdk:code});assert.equal(verdict.state,outcome==='CHARGED'?'BOUND_TO_ORDER':'VALID');
      const eligibleAfter=Number(await eligible());assert.equal(eligibleAfter,outcome==='NOT_CHARGED'?1:0);
      await reload();assert.equal(await ev(`return document.querySelectorAll('[data-open-case-order-wb="${publicNo}"]').length`),0);
      await capture(`${kind}-${outcome}-closed`);mark(`${kind} ${outcome}: ${diagnosticsMode?'diagnostics':'workbench'} → detail → actual handler → DB/CDK verified`,{before,after,cdkVerdict:verdict.state,eligibleCardAfter:eligibleAfter});
      if(outcome==='NOT_CHARGED'){
        const retry=await intake({cdk:code,session:sessionFixture()});assert.notEqual(retry.orderId,ids.orderId);
        const repeated=await intake({cdk:code,session:sessionFixture()});assert.equal(repeated.orderId,retry.orderId);
        mark(`${kind} no-charge: actual customer resubmission creates one new order; replay reuses it`,{status:retry.status,reused:repeated.reused});
      }else await assert.rejects(()=>intake({cdk:code,session:sessionFixture()}),{code:'CDK_UNAVAILABLE'});
    });
  }
  if(diagnosticsMode)await section('diagnostics reports and UI states',async()=>{
    await ev("if(document.querySelector('#detail-drawer').open)document.querySelector('#detail-drawer').close();await switchView('diagnostics');");
    await wait("document.querySelector('#diagnostics-report-time').textContent.includes('只读核对')");
    const data=await daily.run({persist:false});
    const cnt=await ev("return document.querySelector('[data-diagnostic-filter=unverifiable] span').textContent");
    assert.equal(Number(cnt),data.cards.filter(c=>c.amount.finding==='UNVERIFIABLE').length);
    await click('[data-diagnostic-filter=unverifiable]');await click('[data-diagnostic-expand]');
    assert.ok(await ev("return document.querySelector('.diag-evidence:not([hidden])').textContent.includes('卡片同步')"));
    await click('[data-diagnostic-card]');await wait("document.querySelector('#detail-drawer').open && !document.querySelector('#detail-content').textContent.includes('正在读取')");
    assert.ok(!(await ev("return document.querySelector('#detail-content').textContent")).includes('读取失败'));await click('#close-detail');
    mark('real read-only report drives counts, expands evidence and opens actual card detail',{unverifiable:Number(cnt)});
    const ordinary=await cases.upsertCase({caseType:'OPERATOR_NOTE',dedupeKey:'diag-ordinary',evidence:{synthetic:true}});
    await ev('await refreshDiagnostics();');await click(`[data-case-id="${ordinary.id}"] [data-resolve-case]`);await fill('#ask-note','isolated record closure');await click('.ask-dialog button[type=submit]');
    const end=Date.now()+8000;while(await scalar('SELECT status FROM reconciliation_cases WHERE id=?',[ordinary.id])!=='RESOLVED'){if(Date.now()>end)throw Error('ordinary case did not close');await new Promise(r=>setTimeout(r,50));}
    mark('non-payment record retains audited-note close path',{status:'RESOLVED'});
    const publicNo=await scalar('SELECT public_no FROM orders WHERE id=?',[fixtures[0].orderId]);
    await fill('#diagnostics-public-no',publicNo);await click('#diagnostics-order-search button[type=submit]');await wait("document.querySelector('[data-diagnostic-order]')");await click('[data-diagnostic-order]');await wait("document.querySelector('#detail-drawer').open");await click('#close-detail');
    mark('diagnostics search reaches existing order detail',{publicNo});
    await ev("window.diagRealFetch=window.fetch;window.fetch=(url,opts)=>String(url).includes('/reconciliation/daily')?Promise.resolve(new Response('{}',{status:500,headers:{'content-type':'application/json'}})):window.diagRealFetch(url,opts);");
    await click('#diagnostics-report-refresh');await wait("document.querySelector('[data-diagnostic-retry]')");assert.equal(await ev("return document.querySelector('[data-diagnostic-filter=difference] span').textContent"),'—');
    await ev('window.fetch=window.diagRealFetch;');await click('[data-diagnostic-retry]');await wait("!document.querySelector('[data-diagnostic-retry]')");mark('500 clears stale report/count and retry recovers',{});
    await ev("window.fetch=(url,opts)=>/reconciliation-cases|admin\\/overview|billing-address/.test(String(url))?Promise.resolve(new Response('{}',{status:503,headers:{'content-type':'application/json'}})):window.diagRealFetch(url,opts);await refreshDiagnostics({daily:true});");
    assert.match(await ev("return document.querySelector('#diagnostics-status').textContent"),/读取失败/);assert.match(await ev("return document.querySelector('#reconciliation-table').textContent"),/读取失败/);
    assert.equal(await ev("return document.querySelector('#billing-address-settings button').disabled"),true);
    await ev('window.fetch=window.diagRealFetch;await refreshDiagnostics({daily:true});');assert.equal(await ev("return document.querySelector('#billing-address-settings button').disabled"),false);
    mark('runtime/case read failure shown; failed config read disables writes until retry',{});
    await ev("document.querySelector('#diagnostics-tools').open=true;");await fill('#billing-address-name','Isolated Test');await fill('#billing-address-enabled','true');await click('#billing-address-settings button');
    await wait("document.querySelector('#page-notice').textContent.includes('账单地址设置已保存')");assert.equal(await scalar("SELECT setting_value FROM app_settings WHERE setting_key='browser_billing_address_name'"),'Isolated Test');
    const csv=await ev("const r=await fetch('/api/v1/admin/exports/orders.csv?limit=10000');const t=await r.text();return {status:r.status,hasData:t.includes('UNKPAY'),leaks:/session_ciphertext|card_credentials_ciphertext|accessToken/.test(t)};");
    assert.equal(csv.status,200);assert.equal(csv.hasData,true);assert.equal(csv.leaks,false);mark('existing billing save and sanitized CSV backend retained',{csv});
    await ev("document.querySelector('#diagnostics-tools').open=false;document.querySelector('#page-notice').hidden=true;window.scrollTo(0,0);");
    for(const [width,height] of [[1440,1000],[390,844]]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sid);assert.equal(await ev('return innerWidth'),width);assert.ok(await ev('return document.documentElement.scrollWidth<=innerWidth+1'));await capture('diagnostics-'+width);}
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sid);
    const parity=await command(process.execPath,['scripts/visual-parity.mjs','docs/design/parity/diagnostics-page.json'],{env:{PARITY_ADMIN_BASE:web,PARITY_PROTO_BASE:'http://127.0.0.1:8899',PARITY_ADMIN_PASSWORD:adminPassword}});
    await writeFile(new URL('parity.txt',output),parity.stdout);assert.equal(parity.code,0,parity.stdout.toString()+parity.stderr);mark('approved prototype geometry/style contract',{});
    const mutant=JSON.parse(await readFile('docs/design/parity/diagnostics-page.json','utf8'));
    mutant.impl.prepare="await switchView('diagnostics');document.querySelector('.diag-layout').style.gap='2px';return true;";
    const mutationPath=new URL('gap-mutant.json',output);await writeFile(mutationPath,JSON.stringify(mutant));
    const mutation=await command(process.execPath,['scripts/visual-parity.mjs',fileURLToPath(mutationPath)],{env:{PARITY_ADMIN_BASE:web,PARITY_PROTO_BASE:'http://127.0.0.1:8899',PARITY_ADMIN_PASSWORD:adminPassword}});
    await writeFile(new URL('mutation.txt',output),mutation.stdout);assert.equal(mutation.code,1,mutation.stdout.toString()+mutation.stderr);mark('geometry contract rejects deliberate gap regression',{exitCode:mutation.code});
  });
  await section('existing unknown-payment MySQL regressions',async()=>{
    const result=await command(process.execPath,['--test','--test-concurrency=1','v1/test/browser-resolve-unknown-payment-mysql-integration.test.js'],{env:{TEST_DATABASE_URL:source.href}});
    await writeFile(new URL('mysql-tests.txt',output),Buffer.concat([result.stdout,Buffer.from(result.stderr)]));assert.equal(result.code,0,result.stdout.toString().slice(-3000));mark('existing unknown-payment MySQL regressions',{output:result.stdout.toString().split('\n').slice(-10)});
  });
  await section('backup functional restore',async()=>{
    const batch=await createAdminCdkService({pool,cdkHashKey:hashKey,cdkRecoveryKey:recoveryKey})({count:1,requestKey:crypto.randomUUID(),note:'synthetic restore sentinel'});
    const original=await downloadCdkBatch(pool,batch.batchNo,recoveryKey);
    const sentinel=fixtures[0];assert.ok(sentinel);
    // A dedicated definer, as in the release plan, rather than root: isolated grants only.
    await owner.query('CREATE USER ?@? IDENTIFIED BY ?',[migrator,'%',crypto.randomBytes(24).toString('hex')]);userCreated=true;
    await owner.query(`GRANT ALL ON ${database}.* TO '${migrator}'@'%'`);
    const [[tr]]=await pool.query("SHOW CREATE TRIGGER operator_alert_incident_version_before_update");
    const triggerSql=tr['SQL Original Statement'];assert.ok(triggerSql);
    await pool.query('DROP TRIGGER operator_alert_incident_version_before_update');
    await pool.query(triggerSql.replace(/DEFINER=`[^`]+`@`[^`]+`/,`DEFINER=\`${migrator}\`@\`%\``));
    const dump=await checked('docker',['exec','-e',`MYSQL_PWD=${password}`,'pojia-stage1-mysql','mysqldump','-uroot','--single-transaction','--routines','--events','--triggers','--hex-blob','--no-tablespaces',database]);
    const backupPass=crypto.randomBytes(32).toString('hex');
    const encrypted=await checked('openssl',['enc','-aes-256-cbc','-salt','-pbkdf2','-iter','600000','-pass','env:SAFETY_BACKUP_PASS'],{env:{SAFETY_BACKUP_PASS:backupPass},input:gzipSync(dump)});
    const decrypted=await checked('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-iter','600000','-pass','env:SAFETY_BACKUP_PASS'],{env:{SAFETY_BACKUP_PASS:backupPass},input:encrypted});
    const restoredDump=gunzipSync(decrypted);assert.deepEqual(restoredDump,dump);
    await checked('docker',['run','-d','--rm','--network','none','--name',restoreContainer,'-e','MYSQL_ALLOW_EMPTY_PASSWORD=yes',info.Config.Image]);restoreCreated=true;
    const end=Date.now()+60000;
    while(true){const logs=await command('docker',['logs',restoreContainer]);if(Buffer.concat([logs.stdout,Buffer.from(logs.stderr)]).toString().includes('MySQL init process done. Ready for start up.')){const ping=await command('docker',['exec',restoreContainer,'mysqladmin','ping','-uroot','--silent']);if(ping.code===0)break;}if(Date.now()>end)throw Error('restore MySQL not ready');await new Promise(r=>setTimeout(r,500));}
    const ri=JSON.parse((await checked('docker',['inspect',restoreContainer])).toString())[0];assert.equal(ri.HostConfig.NetworkMode,'none');
    // No container network or published ports. Bridge the local MySQL client over
    // docker exec stdio to the container's own loopback; no external egress exists.
    restoreTunnel=net.createServer(socket=>{
      const child=spawn('docker',['exec','-i',restoreContainer,'bash','-c','exec 3<>/dev/tcp/127.0.0.1/3306; cat <&3 & cat >&3; wait'],{stdio:['pipe','pipe','ignore']});
      tunnelChildren.add(child);socket.pipe(child.stdin);child.stdout.pipe(socket);
      child.stdin.on('error',()=>socket.destroy());socket.on('error',()=>child.kill());
      socket.on('close',()=>child.kill());child.on('exit',()=>{tunnelChildren.delete(child);socket.destroy();});
    });restoreTunnel.listen(0,'127.0.0.1');await once(restoreTunnel,'listening');
    const restorePort=restoreTunnel.address().port;
    restoreOwner=await mysql.createConnection({host:'127.0.0.1',port:restorePort,user:'root',timezone:'Z'});await restoreOwner.query(`CREATE DATABASE ${database}`);
    await checked('docker',['exec','-i',restoreContainer,'mysql','-uroot',database],{input:restoredDump});
    restored=mysql.createPool({host:'127.0.0.1',port:restorePort,user:'root',database,timezone:'Z'});
    const [[{n:tables}]]=await restored.query('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=?',[database]);assert.ok(Number(tables)>0);
    const [[session]]=await restored.query('SELECT session_ciphertext FROM orders WHERE id=?',[sentinel.orderId]);assert.equal(decryptSecret(session.session_ciphertext,key),'{"synthetic":true}');assert.throws(()=>decryptSecret(session.session_ciphertext,crypto.randomBytes(32)));
    assert.deepEqual(await downloadCdkBatch(restored,batch.batchNo,recoveryKey),original);
    const restoredRead=createAdminReadService({pool:restored,sessionEncryptionKey:key,cdkHashKey:hashKey});assert.ok(await restoredRead.getOverview());
    mark('backup gzip/encryption roundtrip, fresh MySQL import, Session/CDK decrypt and app overview',{tables:Number(tables),wrongKeyRejected:true,productionBackup:false,networkMode:ri.HostConfig.NetworkMode});
    const [[alert]]=await restored.query('SELECT id FROM operator_alerts LIMIT 1');assert.ok(alert);
    let triggerError;try{await restored.query("UPDATE operator_alerts SET status='RESOLVED' WHERE id=?",[alert.id]);}catch(e){triggerError={code:e.code,errno:e.errno};}
    assert.equal(triggerError?.errno,1449);mark('negative control: table-only restore passes but missing definer blocks alert UPDATE',triggerError);
    await restoreOwner.query('CREATE USER ?@? IDENTIFIED BY ?',[migrator,'%',crypto.randomBytes(24).toString('hex')]);await restoreOwner.query(`GRANT ALL ON ${database}.* TO '${migrator}'@'%'`);
    await restored.query("UPDATE operator_alerts SET status='RESOLVED' WHERE id=?",[alert.id]);const [[prior]]=await restored.query('SELECT incident_version FROM operator_alerts WHERE id=?',[alert.id]);
    await restored.query("UPDATE operator_alerts SET status='OPEN' WHERE id=?",[alert.id]);const [[after]]=await restored.query('SELECT incident_version FROM operator_alerts WHERE id=?',[alert.id]);assert.equal(Number(after.incident_version),Number(prior.incident_version)+1);
    mark('definer restored with DB-level grants only: trigger increments incident version',{before:prior.incident_version,after:after.incident_version});
  });
} catch(e) {report.failures.push({name:'setup',error:e.message,stack:e.stack});console.error(e.message);}
finally {
  cdp?.close();if(chrome)await chrome.kill();if(server)await new Promise(r=>server.close(r));
  if(restored)await restored.end();if(restoreOwner)await restoreOwner.end();
  for(const child of tunnelChildren)child.kill();if(restoreTunnel)await new Promise(r=>restoreTunnel.close(r));
  if(restoreCreated)await checked('docker',['rm','-f',restoreContainer]);
  if(pool)await pool.end();
  if(dbCreated)await owner.query(`DROP DATABASE ${database}`);
  if(userCreated)await owner.query('DROP USER ?@?',[migrator,'%']);
  if(owner){const [[db]]=await owner.query('SELECT COUNT(*) n FROM information_schema.schemata WHERE schema_name=?',[database]);const [[u]]=await owner.query('SELECT COUNT(*) n FROM mysql.user WHERE user=?',[migrator]);report.cleanup={databasesRemaining:Number(db.n),accountsRemaining:Number(u.n)};await owner.end();}
  report.finishedAt=new Date().toISOString();report.status=report.failures.length?'failed':'passed';
  await writeFile(new URL('evidence.json',output),JSON.stringify(report,null,2));
  if(report.failures.length)process.exitCode=1;
}
