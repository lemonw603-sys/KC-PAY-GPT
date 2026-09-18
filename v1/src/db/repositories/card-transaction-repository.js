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

/**
 * 只把一条交易行写进 `card_transactions`，不做任何别的事。
 *
 * 从 persistCardTransactions 里原样提出来的（SQL 与参数一字未改），因为开卡费用行
 * 需要「只插这一行」：persistCardTransactions 还会刷 cards.last_transaction_synced_at，
 * 而那个时间戳是非 MANUAL_IMPORT 卡的分配资格判据（card-inventory-eligibility.js）。
 * 开卡时我们并没有同步这张卡的交易，把它刷新等于伪造一个「刚对过账」的新鲜度。
 */
/**
 * 第⑤步（面四①，D-249「拒付必推」）：拒付以前**一条告警都没有**。
 * 原因是它从两边都掉了出去：`classifyCardTransaction` 的 `REFUND_CANDIDATE_TYPES` 里没有
 * `chargeback`，而 `persistRefundCandidate` 还要求 `status='success'`——hnskj 拒付行的 status
 * 是中文串「平台监控已登记拒付」。生产 4 笔拒付、`operator_alerts` 里 0 条（2026-09-18 实查）。
 *
 * 所以这里**只按类型判，不按 status 判**：status 是卡台的自由文本，拿它当判据正是上一版失效的原因。
 * 只对**本次新插入**的流水行告警，否则每次同步都会把历史拒付重推一遍。
 * 拒付手续费（`chargeback_fee`）不单独推，金额并进同一条消息由运营在后台看。
 */
// 只留生产真实见过的（D-277）：CHARGE_BACK / DISPUTE 是猜出来的名字、无样本，删掉——按类型判就不能
// 塞没见过的值。highvcc 侧拒付告警等首个真实样本再按真值加。
const CHARGEBACK_TYPES = new Set(['CHARGEBACK']);

async function persistChargebackAlert(connection, { cardId, transaction }) {
  const type = String(transaction?.type ?? '').trim().toUpperCase();
  if (!CHARGEBACK_TYPES.has(type)) return;
  const [rows] = await connection.query(
    'SELECT last4, provider_card_id FROM cards WHERE id = ? LIMIT 1', [cardId]
  );
  const label = rows[0]?.last4 ? `尾号 ${rows[0].last4}` : `卡 ${rows[0]?.provider_card_id || cardId}`;
  await connection.query(
    `INSERT INTO operator_alerts
     (id, alert_type, dedupe_key, severity, title, message, status)
     VALUES (UUID(), 'CARD_CHARGEBACK', ?, 'critical', '发生拒付，钱被扣走了', ?, 'OPEN')
     ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
       message = VALUES(message),
       status = IF(status = 'RESOLVED', 'OPEN', status),
       acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
    [`card-chargeback:${cardId}:${transaction.id}`,
      `${label} 发生拒付：${transaction.amount} ${transaction.currency}`
      + `${transaction.merchantName ? `，商户 ${String(transaction.merchantName).slice(0, 40)}` : ''}`
      + `${transaction.tradeTime ? `，卡台时间 ${transaction.tradeTime}` : ''}。`
      + '这笔钱已从卡台账户扣走，系统不会自动追回。请去卡台核对这张卡还能不能用。']
  );
}

export async function insertCardTransactionRow(connection, { cardId, transaction }) {
  const [result] = await connection.query(
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
  // MySQL 的 INSERT ... ON DUPLICATE KEY UPDATE：新插入 = 1，更新既有行 = 2，无变化 = 0。
  // 调用方靠它区分「第一次看到这笔流水」与「又同步了一遍」。
  return { inserted: Number(result?.affectedRows || 0) === 1 };
}

export async function persistCardTransactions(connection, {
  cardId,
  orderId = null,
  transactions,
  cardSnapshot = null
}) {
  const freshlyInserted = [];
  for (const transaction of transactions) {
    const { inserted } = await insertCardTransactionRow(connection, { cardId, transaction });
    if (inserted) freshlyInserted.push(transaction);
  }
  for (const transaction of transactions) {
    await persistRefundCandidate(connection, { cardId, orderId, transaction });
  }
  for (const transaction of freshlyInserted) {
    await persistChargebackAlert(connection, { cardId, transaction });
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

  // Provider failure alone is not enough to release a submitted card. Once a
  // successful transaction sync independently confirms that no purchase was
  // observed, close the reconciliation hold and its active assignment.
  await connection.query(
    `UPDATE card_consumption_ledger l
     INNER JOIN orders o ON o.id = l.order_id AND o.assigned_card_id = l.card_id
     INNER JOIN recharge_attempts ra ON ra.id = l.recharge_attempt_id
     INNER JOIN cards c ON c.id = l.card_id
     SET l.status = 'RELEASED',
         l.released_at = COALESCE(l.released_at, CURRENT_TIMESTAMP(3)),
         l.release_reason = 'provider failure confirmed; card sync found no successful purchase',
         l.evidence_json = JSON_MERGE_PATCH(COALESCE(l.evidence_json, JSON_OBJECT()), JSON_OBJECT(
           'source', 'post_failure_card_transaction_sync',
           'orderStatus', o.status,
           'attemptStatus', ra.status,
           'fundsRiskState', ra.funds_risk_state
         ))
     WHERE l.card_id = ? AND l.status = 'RECONCILIATION'
       AND o.status = 'RECHARGE_FAILED'
       AND o.failure_code = 'PROVIDER_CONFIRMED_FAILURE'
       AND ra.status = 'FAILED' AND ra.funds_risk_state = 'CLEARED'
       AND ra.finished_at IS NOT NULL
       AND c.last_transaction_synced_at >= ra.finished_at
       AND c.current_balance >= l.amount
       AND NOT EXISTS (
         SELECT 1 FROM card_transactions purchase
         WHERE purchase.card_id = l.card_id
           AND purchase.transaction_type = 'PURCHASE'
           AND LOWER(purchase.status) = 'success'
           AND purchase.first_seen_at >= l.reserved_at
       )`,
    [cardId]
  );
  await connection.query(
    `UPDATE card_assignment_history h
     INNER JOIN card_consumption_ledger l
       ON l.card_id = h.card_id AND l.order_id = h.order_id
     SET h.status = 'RELEASED', h.released_by = 'worker:post-failure-card-sync',
         h.release_reason = 'provider failure confirmed; card sync found no successful purchase',
         h.released_at = COALESCE(h.released_at, CURRENT_TIMESTAMP(3))
     WHERE h.card_id = ? AND h.status = 'ACTIVE' AND l.status = 'RELEASED'
       AND l.release_reason = 'provider failure confirmed; card sync found no successful purchase'`,
    [cardId]
  );
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
