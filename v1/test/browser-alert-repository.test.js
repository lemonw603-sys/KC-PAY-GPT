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
  assert.match(queries[0].sql, /SELECT public_no FROM orders/);
  const insert = queries.find(({ sql }) => /INSERT INTO operator_alerts/.test(sql));
  assert.match(insert.sql, /status = IF\(status = 'RESOLVED', 'OPEN', status\)/);
  assert.deepEqual(insert.values, ['BROWSER_PAYMENT_UNKNOWN', 'browser-browser_payment_unknown:order-1', 'order-1', 'critical', 't', 'm']);
  assert.deepEqual(BROWSER_ALERT_TYPES, {
    BROWSER_PAYMENT_CONFIRMED: 'info', BROWSER_ORDER_COMPLETED: 'info', BROWSER_ORDER_FAILED: 'warning',
    BROWSER_PAYMENT_UNKNOWN: 'critical', BROWSER_HUMAN_REQUIRED: 'critical', BROWSER_UPGRADE_HANDOFF: 'warning',
    BROWSER_ORDER_SUBMITTED: 'info', BROWSER_ORDER_STALLED: 'critical'
  });
  await assert.rejects(() => upsertBrowserAlertInTransaction(connection, { type: 'NOPE', orderId: 'o', title: 't', message: 'm' }), /unknown browser alert type/);
});
