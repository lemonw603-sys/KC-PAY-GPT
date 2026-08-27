import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { encryptSecret } from '../src/security/secret-box.js';
import { createWorkflowRepository } from '../src/db/repositories/workflow-repository.js';

if (process.env.ALLOW_TRANSACTION_SYNC_SMOKE !== 'I_UNDERSTAND') {
  throw new Error('Set ALLOW_TRANSACTION_SYNC_SMOKE=I_UNDERSTAND to run this temporary production smoke test');
}

const providerCardId = String(process.argv[2] || '').trim();
if (!/^[A-Za-z0-9_-]{1,128}$/.test(providerCardId)) throw new Error('A valid provider card ID is required');

const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = Buffer.from(process.env.SESSION_ENCRYPTION_KEY_BASE64 || '', 'base64');
if (!databaseUrl || encryptionKey.length !== 32) throw new Error('Runtime database and encryption configuration is required');

const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, timezone: 'Z' });
const suffix = crypto.randomUUID();
const cdkId = crypto.randomUUID();
const orderId = crypto.randomUUID();
const cardId = crypto.randomUUID();
const publicNo = `SMOKE-${suffix}`;

async function waitForTask(dedupeKey, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [rows] = await pool.query(
      'SELECT status, attempts, last_error_code, last_error_message FROM tasks WHERE dedupe_key = ?', [dedupeKey]
    );
    if (rows[0]?.status === 'COMPLETED') return rows[0];
    if (rows[0]?.status === 'DEAD') {
      throw new Error(`Sync task failed: ${rows[0].last_error_code || 'unknown'}: ${rows[0].last_error_message || 'no detail'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${dedupeKey}`);
}

async function enqueue(label) {
  const dedupeKey = `smoke-sync:${label}:${suffix}`;
  await pool.query(
    `INSERT INTO tasks (order_id, task_type, status, dedupe_key, max_attempts)
     VALUES (?, 'SYNC_CARD_TRANSACTIONS', 'PENDING', ?, 3)`, [orderId, dedupeKey]
  );
  return waitForTask(dedupeKey);
}

try {
  await pool.query(
    `INSERT INTO cdks (id, code_hash, status, batch_no, order_id, redeemed_at)
     VALUES (?, ?, 'REDEEMED', 'PRODUCTION-SMOKE', NULL, CURRENT_TIMESTAMP(3))`,
    [cdkId, crypto.createHash('sha256').update(`smoke:${suffix}`).digest('hex')]
  );
  await pool.query(
    `INSERT INTO orders
     (id, public_no, cdk_id, status, plan_type, card_type_id, open_card_amount,
      minimum_required_card_balance, session_ciphertext, card_purchase_idempotency_key,
      finished_at)
     VALUES (?, ?, ?, 'RECHARGE_SUCCESS', 'plus', '1', 16, 16, ?, ?, CURRENT_TIMESTAMP(3))`,
    [orderId, publicNo, cdkId, encryptSecret('{}', encryptionKey), `smoke-purchase:${suffix}`]
  );
  await pool.query('UPDATE cdks SET order_id = ? WHERE id = ?', [orderId, cdkId]);
  await pool.query(
    `INSERT INTO cards
     (id, order_id, provider_card_id, card_type_id, last4, status, funded_amount,
      current_balance, currency, refund_status)
     VALUES (?, ?, ?, '1', NULL, 'active', 16, NULL, 'USD', 'MONITORING')`,
    [cardId, orderId, providerCardId]
  );

  const firstTask = await enqueue('first');
  const [firstCountResult, firstTypesResult, refundCountResult, cardResult] = await Promise.all([
    pool.query('SELECT COUNT(*) AS count FROM card_transactions WHERE card_id = ?', [cardId]),
    pool.query(`SELECT transaction_type, status, fee, trade_time_raw, related_txn_id,
      settlement_status, original_amount, original_currency
      FROM card_transactions WHERE card_id = ? ORDER BY id`, [cardId]),
    pool.query('SELECT COUNT(*) AS count FROM refund_cases WHERE order_id = ?', [orderId]),
    pool.query('SELECT current_balance, currency, last_synced_at FROM cards WHERE id = ?', [cardId])
  ]);
  const firstCount = firstCountResult[0][0];
  const firstTypes = firstTypesResult[0];
  const refundCount = refundCountResult[0][0];
  const syncedCard = cardResult[0][0];
  const secondTask = await enqueue('second');
  const [[secondCount]] = await pool.query(
    'SELECT COUNT(*) AS count FROM card_transactions WHERE card_id = ?', [cardId]
  );

  const workflow = createWorkflowRepository(pool, { sessionEncryptionKey: encryptionKey });
  await workflow.commitCardTransactions(orderId, [{
    id: `smoke-purchase:${suffix}`, type: 'PURCHASE', status: 'success', amount: '-15.97',
    currency: 'USD', originalAmount: '982.14', originalCurrency: 'PHP',
    classification: 'UNKNOWN', rawHash: crypto.createHash('sha256').update(`purchase:${suffix}`).digest('hex')
  }, {
    id: `smoke-refund:${suffix}`, type: 'REFUND', status: 'success', amount: '15.97',
    currency: 'USD', relatedTxnId: `smoke-purchase:${suffix}`,
    classification: 'REFUND_CANDIDATE', rawHash: crypto.createHash('sha256').update(`refund:${suffix}`).digest('hex')
  }]);
  const [[syntheticRefund]] = await pool.query(
    `SELECT r.status, o.public_no, c.provider_card_id,
            original.provider_transaction_id AS original_provider_transaction_id,
            refund.provider_transaction_id AS refund_provider_transaction_id
     FROM refund_cases r
     INNER JOIN orders o ON o.id = r.order_id
     INNER JOIN cards c ON c.id = r.card_id
     LEFT JOIN card_transactions original ON original.id = r.original_transaction_id
     LEFT JOIN card_transactions refund ON refund.id = r.refund_transaction_id
     WHERE r.order_id = ?`, [orderId]
  );

  const result = {
    firstTask: firstTask.status,
    secondTask: secondTask.status,
    firstTransactionCount: Number(firstCount.count),
    secondTransactionCount: Number(secondCount.count),
    transactionTypes: firstTypes.map((row) => ({ type: row.transaction_type, status: row.status })),
    evidenceRows: firstTypes.filter((row) => (
      row.trade_time_raw || row.related_txn_id || row.settlement_status
      || row.original_amount != null || row.original_currency
    )).length,
    evidenceAvailable: Number(firstCount.count) > 0,
    syncedBalance: syncedCard?.current_balance == null ? null : String(syncedCard.current_balance),
    syncedCurrency: syncedCard?.currency || null,
    balanceSyncedAt: Boolean(syncedCard?.last_synced_at),
    refundCaseCount: Number(refundCount.count),
    syntheticRefundCandidate: syntheticRefund ? {
      status: syntheticRefund.status,
      linkedOrder: syntheticRefund.public_no === publicNo,
      linkedCard: syntheticRefund.provider_card_id === providerCardId,
      linkedOriginal: syntheticRefund.original_provider_transaction_id === `smoke-purchase:${suffix}`,
      linkedRefund: syntheticRefund.refund_provider_transaction_id === `smoke-refund:${suffix}`
    } : null,
    idempotent: Number(firstCount.count) === Number(secondCount.count)
  };
  if (
    !result.idempotent || result.refundCaseCount !== 0 || !result.balanceSyncedAt
    || (result.evidenceAvailable && result.evidenceRows === 0)
    || !result.syntheticRefundCandidate
    || result.syntheticRefundCandidate.status !== 'REFUND_DETECTED'
    || Object.values(result.syntheticRefundCandidate).some((value) => value === false)
  ) {
    throw new Error(`Smoke assertions failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} finally {
  await pool.query('DELETE FROM tasks WHERE order_id = ?', [orderId]).catch(() => {});
  await pool.query('DELETE FROM provider_calls WHERE order_id = ?', [orderId]).catch(() => {});
  await pool.query('DELETE FROM refund_cases WHERE order_id = ?', [orderId]).catch(() => {});
  await pool.query('DELETE FROM card_transactions WHERE card_id = ?', [cardId]).catch(() => {});
  await pool.query('DELETE FROM cards WHERE id = ?', [cardId]).catch(() => {});
  await pool.query('UPDATE cdks SET order_id = NULL WHERE id = ?', [cdkId]).catch(() => {});
  await pool.query('DELETE FROM orders WHERE id = ?', [orderId]).catch(() => {});
  await pool.query('DELETE FROM cdks WHERE id = ?', [cdkId]).catch(() => {});
  await pool.end();
}
