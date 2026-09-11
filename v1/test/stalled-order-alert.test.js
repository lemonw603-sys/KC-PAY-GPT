import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_ALERT_TYPES, upsertBrowserAlertInTransaction } from '../src/db/repositories/browser-alert-repository.js';

const fakeConnection = (publicNo) => {
  const calls = [];
  return { calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT public_no FROM orders/.test(sql)) return [publicNo ? [{ public_no: publicNo }] : []];
      return [{ affectedRows: 1 }];
    } };
};

test('D-175: the two new alert types are registered with a severity', () => {
  assert.equal(BROWSER_ALERT_TYPES.BROWSER_ORDER_SUBMITTED, 'info');
  assert.equal(BROWSER_ALERT_TYPES.BROWSER_ORDER_STALLED, 'critical');
});

test('every browser alert carries the order number, because the push shows nothing else', async () => {
  const connection = fakeConnection('PJV1-DEMO123');
  await upsertBrowserAlertInTransaction(connection, {
    type: 'BROWSER_ORDER_STALLED', orderId: 'order-1',
    title: '客户卡住了，没人在处理', message: '已排队 4 分钟没有被执行。',
  });
  const insert = connection.calls.find(({ sql }) => /INSERT INTO operator_alerts/.test(sql));
  // params: type, dedupeKey, orderId, severity, title, message
  assert.match(insert.params[4], /客户卡住了/);
  assert.match(insert.params[5], /^订单 PJV1-DEMO123｜/, 'the operator must be able to tell WHICH customer');
  assert.match(insert.params[5], /已排队 4 分钟/);
});

test('an order whose number cannot be read still produces a usable alert', async () => {
  const connection = fakeConnection(null);
  await upsertBrowserAlertInTransaction(connection, {
    type: 'BROWSER_ORDER_SUBMITTED', orderId: 'order-2', title: '客户提交了充值', message: '正在分卡。',
  });
  const insert = connection.calls.find(({ sql }) => /INSERT INTO operator_alerts/.test(sql));
  assert.equal(insert.params[5], '正在分卡。');
});

test('an unknown alert type is refused rather than silently pushed', async () => {
  await assert.rejects(
    () => upsertBrowserAlertInTransaction(fakeConnection('X'), { type: 'NOT_A_TYPE', orderId: 'o', title: 't', message: 'm' }),
    /unknown browser alert type/,
  );
});
