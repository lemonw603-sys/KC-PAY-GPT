import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_ALERT_TYPES, upsertBrowserAlertInTransaction } from '../src/db/repositories/browser-alert-repository.js';

test('browser alerts are one row per type and order, reopened on repeat, with fixed severities', async () => {
  const queries = [];
  const connection = { async query(sql, values) { queries.push({ sql, values }); return [{ affectedRows: 1 }, []]; } };
  const result = await upsertBrowserAlertInTransaction(connection, {
    type: 'BROWSER_PAYMENT_UNKNOWN', orderId: 'order-1', title: 't', message: 'm'
  });
  assert.deepEqual(result, { type: 'BROWSER_PAYMENT_UNKNOWN', severity: 'critical', dedupeKey: 'browser-browser_payment_unknown:order-1' });
  // D-175: the order number is looked up first so the push can name the customer;
  // this fake returns no rows, and the alert still goes out with the bare message.
  // alert-notification-repository 里的静音名单是模块私有的，这里以快照方式表达契约：
  // 若将来有人往静音名单里加东西，这条断言提醒他别把人机验证加进去。
  const PHONE_SILENT_TYPES_SNAPSHOT = ['BROWSER_PAYMENT_UNKNOWN', 'BROWSER_PAYMENT_CONFIRMED'];
  assert.match(queries[0].sql, /SELECT public_no FROM orders/);
  const insert = queries.find(({ sql }) => /INSERT INTO operator_alerts/.test(sql));
  assert.match(insert.sql, /status = IF\(status = 'RESOLVED', 'OPEN', status\)/);
  assert.deepEqual(insert.values, ['BROWSER_PAYMENT_UNKNOWN', 'browser-browser_payment_unknown:order-1', 'order-1', 'critical', 't', 'm']);
  assert.deepEqual(BROWSER_ALERT_TYPES, {
    BROWSER_PAYMENT_CONFIRMED: 'info', BROWSER_ORDER_COMPLETED: 'info', BROWSER_ORDER_FAILED: 'warning',
    BROWSER_PAYMENT_UNKNOWN: 'critical', BROWSER_HUMAN_REQUIRED: 'critical', BROWSER_UPGRADE_HANDOFF: 'warning',
    BROWSER_ORDER_SUBMITTED: 'info', BROWSER_ORDER_STALLED: 'critical',
    // 人机验证：只有人能过，必须响手机。与 BROWSER_PAYMENT_UNKNOWN 分开正是为了绕开
    // PHONE_SILENT_TYPES 的静音（D-176）——2026-09-13 真单卡在验证上全程无通知就是因为
    // 两者混在一起。改这张表时请一并确认该类型没被加进静音名单。
    BROWSER_HUMAN_VERIFICATION: 'critical'
  });
  // 这一条守住上面那个意图：人机验证告警不能被静音，否则等于没有。
  assert.equal(PHONE_SILENT_TYPES_SNAPSHOT.includes('BROWSER_HUMAN_VERIFICATION'), false,
    '人机验证是唯一必须人立刻到场的情况，不能进静音名单');
  await assert.rejects(() => upsertBrowserAlertInTransaction(connection, { type: 'NOPE', orderId: 'o', title: 't', message: 'm' }), /unknown browser alert type/);
});
