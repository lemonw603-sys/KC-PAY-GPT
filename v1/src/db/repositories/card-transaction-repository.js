async function persistRefundCandidate(connection, { cardId, orderId, transaction }) {
  if (!orderId || transaction.classification !== 'REFUND_CANDIDATE'
    || String(transaction.status).toLowerCase() !== 'success') return;
  const [refundRows] = await connection.query(
    `SELECT id FROM card_transactions
     WHERE card_id = ? AND provider_transaction_id = ? LIMIT 1`,
    [cardId, transaction.id]
  );
  let originalId = null;
  let expectedAmount = null;
  if (transaction.relatedTxnId) {
    const [originalRows] = await connection.query(
      `SELECT id, ABS(amount) AS expected_amount FROM card_transactions
       WHERE card_id = ? AND provider_transaction_id = ? LIMIT 1`,
      [cardId, transaction.relatedTxnId]
    );
    originalId = originalRows[0]?.id ?? null;
    expectedAmount = originalRows[0]?.expected_amount ?? null;
  }
  await connection.query(
    `INSERT INTO refund_cases
     (id, order_id, card_id, status, original_transaction_id,
      refund_transaction_id, expected_amount, currency, detected_at)
     VALUES (UUID(), ?, ?, 'REFUND_DETECTED', ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       status = IF(status = 'MONITORING', 'REFUND_DETECTED', status),
       original_transaction_id = COALESCE(original_transaction_id, VALUES(original_transaction_id)),
       refund_transaction_id = COALESCE(refund_transaction_id, VALUES(refund_transaction_id)),
       expected_amount = COALESCE(expected_amount, VALUES(expected_amount)),
       detected_at = COALESCE(detected_at, CURRENT_TIMESTAMP(3))`,
    [orderId, cardId, originalId, refundRows[0]?.id ?? null,
      expectedAmount, transaction.currency]
  );
  const [caseRows] = await connection.query(
    'SELECT id FROM refund_cases WHERE order_id = ? LIMIT 1', [orderId]
  );
  const [orderRows] = await connection.query(
    'SELECT public_no, customer_email, recharge_order_no FROM orders WHERE id = ? LIMIT 1', [orderId]
  );
  const order = orderRows[0] || {};
  await connection.query(
    `INSERT INTO operator_alerts
     (id, alert_type, dedupe_key, order_id, refund_case_id, severity, title, message)
     VALUES (UUID(), 'REFUND_CANDIDATE', ?, ?, ?, 'warning', ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), message = VALUES(message)`,
    [
      `refund-candidate:${orderId}:${transaction.id}`,
      orderId,
      caseRows[0]?.id || null,
      '发现疑似退款，需要核对',
      `订单 ${order.public_no || orderId}（${order.customer_email || '无邮箱'}）发现疑似退款；` +
      `退款交易 ${transaction.id}，金额 ${transaction.amount} ${transaction.currency}` +
      `${order.recharge_order_no ? `，直充单号 ${order.recharge_order_no}` : ''}。` +
      '系统未自动确认退款。'
    ]
  );
  await connection.query(
    `UPDATE cards SET refund_status = 'REFUND_DETECTED' WHERE id = ?`, [cardId]
  );
}

export async function persistCardTransactions(connection, {
  cardId,
  orderId = null,
  transactions,
  cardSnapshot = null
}) {
  for (const transaction of transactions) {
    await connection.query(
      `INSERT INTO card_transactions
       (card_id, provider_transaction_id, transaction_type, status,
        amount, currency, fee, trade_time_raw, related_txn_id,
        settlement_status, original_amount, original_currency,
        merchant_name, merchant_country, merchant_mcc, occurred_at, raw_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE
         transaction_type = VALUES(transaction_type), status = VALUES(status),
         amount = VALUES(amount), currency = VALUES(currency),
         fee = VALUES(fee), trade_time_raw = VALUES(trade_time_raw),
         related_txn_id = VALUES(related_txn_id), settlement_status = VALUES(settlement_status),
         original_amount = VALUES(original_amount), original_currency = VALUES(original_currency),
         merchant_name = VALUES(merchant_name), merchant_country = VALUES(merchant_country),
         merchant_mcc = VALUES(merchant_mcc), raw_hash = VALUES(raw_hash),
         last_seen_at = CURRENT_TIMESTAMP(3)`,
      [cardId, transaction.id, transaction.type, transaction.status,
        transaction.amount, transaction.currency, transaction.fee ?? null,
        transaction.tradeTime ?? null, transaction.relatedTxnId || null,
        transaction.settlementStatus || null, transaction.originalAmount ?? null,
        transaction.originalCurrency || null, transaction.merchantName || null,
        transaction.merchantCountry || null, transaction.merchantMcc || null,
        transaction.rawHash]
    );
  }
  for (const transaction of transactions) {
    await persistRefundCandidate(connection, { cardId, orderId, transaction });
  }
  const balance = cardSnapshot?.currentBalance;
  const currency = cardSnapshot?.currency;
  if (balance != null && Number.isFinite(Number(balance))) {
    await connection.query(
      `UPDATE cards SET current_balance = ?, currency = COALESCE(?, currency),
         last_synced_at = CURRENT_TIMESTAMP(3),
         last_transaction_synced_at = CURRENT_TIMESTAMP(3),
         updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [String(balance), currency || null, cardId]
    );
  } else {
    await connection.query(
      `UPDATE cards SET last_transaction_synced_at = CURRENT_TIMESTAMP(3),
         updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [cardId]
    );
  }
}

export async function commitCardTransactionsForCard(pool, input) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await persistCardTransactions(connection, input);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
