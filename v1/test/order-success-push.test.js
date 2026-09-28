import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ORDER_SUCCEEDED_ALERT_TYPE, formatDuration, newlySucceededOrdersSql, resolveDeliveredSuccessAlertsSql, succeededAlert
} from '../src/db/repositories/order-success-push.js';

// D-409（Lemon 2026-09-29 选乙）：每单只在结束时推一条「充值成功 / 邮箱 · 产品 · 用时」。
test('用时写法：45 秒 / 1 分 50 秒 / 3 分 / 2 小时 3 分；负数和空按 0', () => {
  assert.equal(formatDuration(45), '45 秒');
  assert.equal(formatDuration(110), '1 分 50 秒');
  assert.equal(formatDuration(180), '3 分');
  assert.equal(formatDuration(7380), '2 小时 3 分');
  assert.equal(formatDuration(7200), '2 小时');
  assert.equal(formatDuration(-5), '0 秒');
  assert.equal(formatDuration(null), '0 秒');
});

test('成功提醒：每单一条（dedupe 带订单 id）、info、标题「充值成功」、正文「产品 · 用时」（邮箱由推送展示层补）', () => {
  assert.deepEqual(succeededAlert({ id: 'o-1', plan_type: 'plus', seconds: 110 }), {
    type: ORDER_SUCCEEDED_ALERT_TYPE, dedupeKey: 'order-succeeded:o-1', orderId: 'o-1', severity: 'info',
    title: '充值成功', message: 'Plus · 用时 1 分 50 秒'
  });
  assert.equal(succeededAlert({ id: 'o-2', plan_type: 'pro_20x', seconds: 60 }).message, '20X · 用时 1 分');
});

test('只捡 30 分钟内结束的成功单、不推演练单、已开过的不重开；推完（SENT / DEAD）或一天后收掉', () => {
  const sql = newlySucceededOrdersSql();
  assert.match(sql, /o\.status = 'RECHARGE_SUCCESS'/);
  assert.match(sql, /o\.finished_at >= CURRENT_TIMESTAMP\(3\) - INTERVAL 30 MINUTE/);
  assert.match(sql, /AND NOT \(EXISTS \(SELECT 1 FROM browser_runs rehearsal_run/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM operator_alerts succ_oa\s+WHERE succ_oa\.dedupe_key = CONCAT\('order-succeeded:', o\.id\)\)/);
  const resolve = resolveDeliveredSuccessAlertsSql();
  assert.match(resolve, /succ_an\.status IN \('SENT', 'DEAD'\)/);
  assert.match(resolve, /INTERVAL 1 DAY/);
});

test('巡检每轮都捡成功单、并收掉推完的（接线在 operator-watch，演练 / dry-run 不写）', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../scripts/operator-watch.mjs', import.meta.url), 'utf8');
  const writeBlock = src.slice(src.indexOf('if (!dryRun) {'), src.indexOf('for (const row of stuckRuns)'));
  assert.match(writeBlock, /succeededPushed = await recordSucceededOrders\(connection\);/);
  assert.match(writeBlock, /await connection\.query\(resolveDeliveredSuccessAlertsSql\(\)\);/);
});
