import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {loadAdminJs} from './helpers/admin-dom-harness.js';

test('today orders 500 is an error, recovery with empty array is a real empty state',async()=>{
  const {sandbox,html}=loadAdminJs();let fail=true;
  sandbox.fetch=async url=>{
    const orders=String(url).includes('/admin/orders?');
    return {status:orders&&fail?500:200,ok:!(orders&&fail),json:async()=>orders?{orders:[]}:{operationalBacklog:{},decisions:{}}};
  };
  await sandbox.loadOverview();assert.match(html('wb-orders'),/订单读取失败/);assert.doesNotMatch(html('wb-orders'),/今天还没有订单/);
  fail=false;await sandbox.loadOverview();assert.match(html('wb-orders'),/今天还没有订单/);assert.doesNotMatch(html('wb-orders'),/读取失败/);
});

test('retired Session window is not rendered as an active limit',()=>{
  const {sandbox,evalIn}=loadAdminJs();sandbox.renderSettingsGlobal({sessionReplacementWindowHours:72});
  const out=evalIn('elements.settingsGlobal.innerHTML');
  assert.doesNotMatch(out,/72|Session 门槛|时间窗/);
  assert.match(out,/账单地址/);
});

test('batch date is a complete Beijing calendar date, not a sliced display time',()=>{
  const source=fs.readFileSync(new URL('../public/admin/assets/cdks.js',import.meta.url),'utf8');
  const sandbox={window:{}};vm.runInNewContext(source,sandbox);
  assert.equal(sandbox.window.cdkBatchDate('2026-09-20T15:21:00Z'),'2026/09/20');
  assert.equal(sandbox.window.cdkBatchDate('2026-09-20T17:21:00Z'),'2026/09/21');
  assert.equal(sandbox.window.cdkBatchDate(null),'日期未记录');
  assert.equal(sandbox.window.cdkBatchDate('invalid'),'日期未记录');
  assert.doesNotMatch(source,/formatTime\([^)]*createdAt\)\.slice\(0,\s*10\)/);
});
