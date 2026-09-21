// Local-only, actual web server + isolated DB + headless Chrome. No worker is started.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { loadConfig } from '../v1/src/config.js';
import { createDatabasePool } from '../v1/src/db/pool.js';
import { hashAdminPassword } from '../v1/src/security/admin-session.js';
import { createAdminCdkService } from '../v1/src/services/cdk-service.js';
import { Cdp, launchChrome, openPage } from './visual-parity.mjs';

const target = new URL(process.env.DATABASE_URL);
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/step6_cdk_test');
const config = loadConfig();
const pool = createDatabasePool(config.database);
const create = createAdminCdkService({ pool, cdkHashKey: config.cdkHashKey, cdkRecoveryKey: config.cdkRecoveryKey });
const password = randomUUID();
const port = '8804', base = `http://127.0.0.1:${port}`;
const report = { checks: [], startedAt: new Date().toISOString() };
const output = new URL('../output/playwright/cdk-step6/', import.meta.url);
await mkdir(output, { recursive: true });
let server, chrome, cdp, ownsFixture = false;
async function run(command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore','pipe','pipe'] });
  let text = ''; child.stdout.on('data', (s) => { text += s; }); child.stderr.on('data', (s) => { text += s; });
  const [code] = await once(child, 'exit');
  return { code, text };
}
try {
  const [[existing]] = await pool.query('SELECT COUNT(*) n FROM cdks');
  assert.equal(Number(existing.n), 0, 'UI fixture database must be empty; never overwrite existing data');
  ownsFixture = true;
  const first = await create({ count: 1, requestKey: randomUUID(), note: '检索锚点' });
  await create({ count: 55, requestKey: randomUUID(), note: '隔离验收普通批次' });
  const reserve = await create({ count: 3, requestKey: randomUUID(), issuanceKind: 'RESERVE', note: '手机应急' });
  await create({ count: 2, requestKey: randomUUID(), issuanceKind: 'MARKETPLACE', expiryMode: 'NEVER', note: '隔离卡网', amount: '88.00' });
  const serverEnv = { ...process.env, PORT: port, HOST: '127.0.0.1', ADMIN_PASSWORD_HASH: await hashAdminPassword(password), PROVIDER_READS_ENABLED: 'false', PROVIDER_WRITES_ENABLED: 'false', PROVIDER_CARD_WRITES_ENABLED: 'false', PROVIDER_RECHARGE_WRITES_ENABLED: 'false' };
  delete serverEnv.ADMIN_HOST;
  server = spawn(process.execPath, ['v1/src/server.js'], { env: serverEnv, stdio: ['ignore','pipe','pipe'] });
  let serverOutput = ''; server.stdout.on('data', (s) => { serverOutput += s; }); server.stderr.on('data', (s) => { serverOutput += s; });
  const deadline = Date.now() + 15000;
  while (true) {
    try { if ((await fetch(base + '/health/live')).ok) break; } catch {}
    if (Date.now() > deadline) throw Error('local server not ready: ' + serverOutput);
    await new Promise((r) => setTimeout(r,100));
  }
  chrome = await launchChrome(); cdp = await Cdp.connect(chrome.wsUrl);
  const sid = await openPage(cdp, base + '/admin/', { width:1440,height:900,login:{password},prepare:"await switchView('cdks');return !document.querySelector('#cdks-view').hidden;" });
  const ev = async (body) => {
    const r = await cdp.send('Runtime.evaluate', { expression: `(async()=>{${body}})()`, awaitPromise:true,returnByValue:true },sid);
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async (expression) => ev(`const end=Date.now()+12000;while(!(${expression})){if(Date.now()>end)throw Error('UI condition timed out');await new Promise(r=>setTimeout(r,50));}return true;`);
  const click = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).click();`);
  const fill = (selector, value) => ev(`const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));`);
  const check = (name) => { report.checks.push(name); console.log('PASS ' + name); };
  await wait("document.querySelector('#cdk-codes tr .cdk-code')");
  assert.equal(await ev('return innerWidth'),1440);
  await fill('#cdk-code-q',first.codes[0]); await click('#cdk-code-filters button[type=submit]');
  await wait("document.querySelector('#cdk-code-page-info').textContent.includes('共 1')");
  assert.equal(await ev("return document.querySelector('#cdk-codes .cdk-code').textContent"), first.codes[0]); check('search finds code older than first 50 rows');
  await fill('#cdk-code-q',''); await click('#cdk-code-filters button[type=submit]');
  await wait("document.querySelectorAll('#cdk-codes tr').length===50");
  await click('#cdk-code-more'); await wait("document.querySelector('#cdk-code-page-info').textContent.startsWith('51')");
  await click('#cdk-code-prev'); await wait("document.querySelectorAll('#cdk-codes tr').length===50"); check('pagination forward/back');
  await click('#cdk-form button[type=submit]');
  await wait("!document.querySelector('#cdk-result').hidden && document.querySelector('#cdk-code-batch').value");
  const createdCode = await ev("return document.querySelector('#generated-cdks').value");
  assert.ok(createdCode.startsWith('PLUS-')); check('generate blank-note normal code and auto-filter batch');
  await fill('#cdk-code-batch',reserve.batchNo); await click('#cdk-code-filters button[type=submit]');
  await wait("document.querySelectorAll('#cdk-codes tr').length===3");
  await click('#cdk-select-page'); assert.match(await ev("return document.querySelector('#cdk-selected-count').textContent"), /3/);
  await click('[data-cdk-bulk=issue]'); await wait("document.querySelector('.ask-dialog')?.open");
  await fill('#ask-note','离线发出'); await click('.ask-dialog button[type=submit]');
  await wait("document.querySelector('#page-notice').textContent.includes('修改 3 张')");
  const [[issued]] = await pool.query('SELECT COUNT(*) n FROM cdks WHERE batch_no=? AND issued_at IS NOT NULL', [reserve.batchNo]);
  assert.equal(Number(issued.n),3); check('bulk issued selection writes all three rows');
  await click('#cdk-select-page'); await click('[data-cdk-bulk=expiry]'); await wait("document.querySelector('.ask-dialog')?.open");
  await fill('#ask-expiryMode','NEVER'); await click('.ask-dialog button[type=submit]');
  await wait("document.querySelector('#cdk-codes').textContent.includes('不过期') && !document.querySelector('.ask-dialog').open");
  const [[expiry]] = await pool.query('SELECT COUNT(*) n FROM cdks WHERE batch_no=? AND expires_at IS NULL', [reserve.batchNo]);
  assert.equal(Number(expiry.n),3); check('bulk expiry extension persists');
  await click('#cdk-select-page'); await click('[data-cdk-bulk=revoke]'); await wait("document.querySelector('.ask-dialog')?.open");
  await click('.ask-dialog button[type=submit]');
  await wait("document.querySelectorAll('#cdk-codes .cdk-tag').length===3 && [...document.querySelectorAll('#cdk-codes .cdk-tag')].every(x=>x.textContent==='已作废')");
  check('bulk revoke confirms count and updates UI');
  await fill('#cdk-kind','MARKETPLACE');
  assert.equal(await ev("return document.querySelector('#cdk-expiry-mode').value"),'NEVER'); check('marketplace selects never, purpose does not require note');
  await fill('#cdk-kind','NORMAL'); await fill('#cdk-count','2');
  assert.equal(await ev("return document.querySelector('#cdk-extra').hidden"),false);
  await fill('#cdk-amount','-1'); await click('#cdk-form button[type=submit]');
  await wait("document.querySelector('#page-notice').textContent.includes('金额请填写')");
  assert.equal(await ev("return sessionStorage.getItem('cdk-generation-request')"),null);
  await fill('#cdk-amount','10'); await click('#cdk-form button[type=submit]');
  await wait("document.querySelector('#cdk-batch-label').textContent.includes('2 张') && !document.querySelector('#cdk-form button[type=submit]').disabled");
  check('400 rejection allows corrected amount and resubmission');
  await fill('#cdk-count','1');
  const [[beforeLost]] = await pool.query('SELECT COUNT(*) n FROM cdks');
  await ev("window.cdkRealFetch=window.fetch;let lost=false;window.fetch=async(url,opts)=>{const response=await window.cdkRealFetch(url,opts);if(!lost&&String(url).includes('/cdks/generate')){lost=true;throw new TypeError('simulated lost response');}return response;};");
  await click('#cdk-form button[type=submit]');
  await wait("!document.querySelector('#cdk-form button[type=submit]').disabled && sessionStorage.getItem('cdk-generation-request') !== null");
  await ev('window.fetch=window.cdkRealFetch;');
  await fill('#cdk-count','2'); await click('#cdk-form button[type=submit]');
  await wait("document.querySelector('#page-notice').textContent.includes('恢复上次未确认')");
  await click('#cdk-recover-request'); assert.equal(await ev("return document.querySelector('#cdk-count').value"),'1');
  await click('#cdk-form button[type=submit]'); await wait("sessionStorage.getItem('cdk-generation-request') === null");
  const [[afterLost]] = await pool.query('SELECT COUNT(*) n FROM cdks'); assert.equal(Number(afterLost.n)-Number(beforeLost.n),1);
  check('lost successful response recovers original batch without duplication');
  await fill('#cdk-count','1');
  await ev("document.querySelector('#cdk-extra').hidden=true;document.querySelector('#cdk-result').hidden=true;");
  await fill('#cdk-code-batch',''); await click('#cdk-code-filters button[type=submit]');
  await wait("document.querySelectorAll('#cdk-codes tr').length===50");
  // Click another navigation item then back; old accidental top-level handler deletion regression.
  await click('[data-view=orders]'); assert.equal(await ev("return document.querySelector('#orders-view').hidden"),false);
  await click('[data-view=cdks]'); await wait("!document.querySelector('#cdks-view').hidden && document.querySelectorAll('#cdk-codes tr').length===50"); check('navigation survives extraction');
  async function screenshot(name,width,height) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sid);
    await ev('await document.fonts.ready;window.scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));');
    assert.equal(await ev('return innerWidth'),width);
    assert.ok(await ev('return document.documentElement.scrollWidth <= innerWidth + 1'),'page must not overflow viewport');
    const {cssContentSize:s}=await cdp.send('Page.getLayoutMetrics',{},sid);
    const {data}=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:s.height,scale:1}},sid);
    await writeFile(new URL(name+'.png',output),Buffer.from(data,'base64'));
  }
  if (!process.env.CDK_SKIP_CAPTURES) {
    await screenshot('desktop',1440,900); await screenshot('mobile',390,844); check('desktop/mobile captures with asserted viewport and no page overflow');
  }
  await ev("window.cdkRealFetch=window.fetch;window.fetch=(url,opts)=>String(url).includes('/cdks/search')?Promise.resolve(new Response('{}',{status:500,headers:{'content-type':'application/json'}})):window.cdkRealFetch(url,opts);");
  await click('#refresh-cdk-codes'); await wait("document.querySelector('#cdk-codes').textContent.includes('读取失败')");
  assert.equal(await ev("return document.querySelector('.cdk-kpis b').textContent"),'—'); check('500 does not masquerade as empty or zero');
  await ev('window.fetch=window.cdkRealFetch;'); await click('#refresh-cdk-codes'); await wait("document.querySelectorAll('#cdk-codes tr').length===50");
  await fill('#cdk-code-q','no-such-isolated-code'); await click('#cdk-code-filters button[type=submit]');
  await wait("document.querySelector('#cdk-codes').textContent.includes('没有符合条件')"); check('empty state is distinct from failed state');
  await fill('#cdk-code-q','');
  const guardStatus=await ev("return (await fetch('/api/v1/admin/cdks/bulk',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'issue',ids:[]})})).status");
  assert.equal(guardStatus,400); // Same-origin passed; validation rejects empty selection.
  const unauth=await fetch(base+'/api/v1/admin/cdks/liability'); assert.equal(unauth.status,401); check('unauthenticated reads rejected');
  // Expire the actual local session: a fake 401 alone bounces back from login
  // because the server still sees a valid cookie, which tests the wrong state.
  await ev("await fetch('/api/v1/admin/session',{method:'DELETE'});");
  await click('#refresh-cdk-codes').catch((error) => { if (!/navigated|context|closed/.test(error.message)) throw error; });
  const loginDeadline=Date.now()+12000;
  while(true){
    const history=await cdp.send('Page.getNavigationHistory',{},sid);
    if(new URL(history.entries[history.currentIndex].url).pathname==='/admin/login')break;
    if(Date.now()>loginDeadline)throw Error('expired session did not reach login');
    await new Promise(r=>setTimeout(r,50));
  }
  check('expired admin session redirects to login');
  const parity = await run(process.execPath,['scripts/visual-parity.mjs','docs/design/parity/cdk-page.json'],{PARITY_ADMIN_BASE:base,PARITY_PROTO_BASE:'http://localhost:8899',PARITY_ADMIN_PASSWORD:password});
  report.parity=parity; console.log(parity.text); assert.equal(parity.code,0,'visual parity');
  check('CDK geometry contract');
  const contract = JSON.parse(await readFile(new URL('../docs/design/parity/cdk-page.json', import.meta.url),'utf8'));
  contract.impl.prepare = "await switchView('cdks');document.querySelector('.cdk-kpis').style.gap='40px';return true;";
  const mutant = new URL('gap-mutant.json',output);
  await writeFile(mutant,JSON.stringify(contract));
  const mutation=await run(process.execPath,['scripts/visual-parity.mjs','output/playwright/cdk-step6/gap-mutant.json'],{PARITY_ADMIN_BASE:base,PARITY_PROTO_BASE:'http://localhost:8899',PARITY_ADMIN_PASSWORD:password});
  report.mutation=mutation;
  assert.equal(mutation.code,1,'geometry mutation must be detected, not pass or setup failure');
  check('gap mutation is detected by geometry gate');
  report.status='passed';
} catch(error) { report.status='failed'; report.error=error.message; process.exitCode=1; console.error(error); }
finally {
  report.finishedAt=new Date().toISOString();
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));
  cdp?.close(); if(chrome) await chrome.kill();
  if(server && server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}
  if (ownsFixture) {
    await pool.query('DELETE FROM customer_payments');
    await pool.query('DELETE FROM cdk_admin_events');
    await pool.query('DELETE FROM cdks');
    await pool.query('DELETE FROM cdk_batches');
  }
  await pool.end();
}
