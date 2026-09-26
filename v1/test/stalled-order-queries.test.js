import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PRE_PAYMENT_STUCK_SQL, RESOLVE_FINISHED_STALLED_SQL, preStuckAlert } from '../src/db/repositories/stalled-order-queries.js';
import { PHONE_PUSH_TYPES } from '../src/domain/alert-push-policy.js';

// D-390（欠账 17）：付款前挂住没人管的单要叫人。SQL 在生产 schema 上由 customer-sql-probe 实跑；
// 排除规则 2026-09-26 在历史关单上验过（付款前停下的全选中，点过付款的 4 张全排除）。
// 这里锁住「谁算有人在管」的每一条，防止改 SQL 时漏掉一条变成误报或漏报。

test('only Browser orders still processing, and only after N minutes', () => {
  assert.match(PRE_PAYMENT_STUCK_SQL, /o\.status = 'RECHARGE_PROCESSING'/);
  assert.match(PRE_PAYMENT_STUCK_SQL, /o\.updated_at < CURRENT_TIMESTAMP\(3\) - INTERVAL \? MINUTE/);
  assert.match(PRE_PAYMENT_STUCK_SQL, /EXISTS \(SELECT 1 FROM browser_dispatch_jobs d WHERE d\.order_id = o\.id\)/, 'API-route orders have their own tasks and alerts');
  assert.equal(PRE_PAYMENT_STUCK_SQL.split('?').length - 1, 3, 'three minute parameters, as operator-watch passes them');
});

test('anything someone is handling, or another alert already covers, is excluded', () => {
  assert.match(PRE_PAYMENT_STUCK_SQL, /d\.status = 'QUEUED'/, 'queued: the "waiting in line" alert covers it');
  assert.match(PRE_PAYMENT_STUCK_SQL, /d\.status = 'CLAIMED' AND d\.lease_until >= CURRENT_TIMESTAMP\(3\) - INTERVAL \? MINUTE/, 'a claimed job with a live lease is being worked; the pool re-claims expired ones within seconds');
  assert.match(PRE_PAYMENT_STUCK_SQL, /r\.status = 'RUNNING' AND r\.worker_lease_until >= CURRENT_TIMESTAMP\(3\) - INTERVAL \? MINUTE/, 'a running run with a live lease (incl. the 90 s operator takeover wait)');
  assert.match(PRE_PAYMENT_STUCK_SQL, /r\.status = 'HUMAN_REQUIRED'/, 'BROWSER_HUMAN_REQUIRED covers it');
  assert.match(PRE_PAYMENT_STUCK_SQL, /COALESCE\(r\.payment_state, 'NOT_STARTED'\) NOT IN \('NOT_STARTED', 'PAYMENT_ARMED'\)/, 'past the click: the unresolved-payment alert and the verifier own it');
});

test('the alert rings the phone and tells the operator money did not move', () => {
  const alert = preStuckAlert({ id: 'order-1', waited: 7 });
  assert.equal(alert.type, 'BROWSER_ORDER_STALLED');
  assert.equal(PHONE_PUSH_TYPES[alert.type], 'HUMAN');
  assert.match(alert.message, /已 7 分钟/);
  assert.match(alert.message, /还没点付款，钱没动/);
  assert.match(alert.message, /后台打开这一单点「放弃并放卡」/, 'D-394: the operator can finish it alone, no SSH');
});

test('a stalled alert is resolved once its order has ended, and only then', () => {
  assert.match(RESOLVE_FINISHED_STALLED_SQL, /oa\.alert_type = 'BROWSER_ORDER_STALLED' AND oa\.status = 'OPEN'/);
  assert.match(RESOLVE_FINISHED_STALLED_SQL, /o\.status IN \('RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'CLOSED', 'CARD_FAILED'\)/);
  assert.doesNotMatch(RESOLVE_FINISHED_STALLED_SQL, /RECHARGE_PROCESSING|WAITING_FOR/, 'an order still in progress keeps its alert');
});

test('operator-watch runs the shared SQL rather than a copy of its own', async () => {
  const script = await readFile(new URL('../scripts/operator-watch.mjs', import.meta.url), 'utf8');
  assert.match(script, /connection\.query\(PRE_PAYMENT_STUCK_SQL, \[minutes, minutes, minutes\]\)/);
  assert.match(script, /connection\.query\(RESOLVE_FINISHED_STALLED_SQL\)/);
  assert.match(script, /upsertBrowserAlertInTransaction\(connection, preStuckAlert\(row\)\)/);
  assert.doesNotMatch(script, /worker_lease_until/, 'the stuck rule lives in one place');
});
