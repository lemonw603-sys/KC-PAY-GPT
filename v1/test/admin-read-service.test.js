import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminReadService } from '../src/services/admin-read-service.js';
import { encryptSecret } from '../src/security/secret-box.js';
import { sessionFixture } from '../test-support/session-fixture.js';

const adminCardKey = Buffer.alloc(32, 19);
const adminCdkKey = Buffer.alloc(32, 23);

function queuedPool(results) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (!results.length) throw new Error('Unexpected query');
      return [results.shift(), []];
    }
  };
}

test('admin overview maps aggregate values without exposing raw records', async () => {
  const pool = queuedPool([
    [{ total: 10, today: 2, successful: 8, completed_failed: 2,
      recent_successful: 1, recent_finished: 2, processing: 1,
      awaiting_confirmation: 1, reviewing: 1, waiting_for_card: 3 }],
    [{ status: 'RECHARGE_SUCCESS', count: 8 }],
    [{ status: 'AVAILABLE', count: 20 }],
    [{ setting_key: 'accept_new_orders', setting_value: 'false', updated_at: new Date('2026-08-17T00:00:00Z') }],
    [{ status: 'REFUND_DETECTED', count: 1 }],
    [{ count: 1 }],
    [{ available: 7, provisioning: 1, assigned: 2, depleted: 1, held: 1, needs_funding: 1 }],
    [{ setting_key: 'card_stock_low_threshold', setting_value: '5' },
      { setting_key: 'card_auto_replenishment_enabled', setting_value: 'false' }],
    [{ card_intake_pending: 2, funds_risk_pending: 1,
      card_funding_risk_pending: 2, card_funding_manual_review: 1,
      reconciliation_cases_open: 3, card_sync_backlog: 4, card_sync_review_required: 2 }],
    [{ provider_account_id: 'pa-hnskj', provider_code: 'legacy-primary', provider_kind: 'hnskj', total: 14, in_stock: 2, stock_available: 2, bindable_now: 0, in_use: 0, any_used: 6, product_used: 6, remaining_orders: 5, plus_target_available: 2 },
      { provider_account_id: 'pa-backup-a', provider_code: 'backup-a', provider_kind: 'manual_excel', total: 16, in_stock: 7, stock_available: 2, bindable_now: 2, in_use: 0, any_used: 6, product_used: 6, plus_target_available: 2 }],
    // ⚠️ fixture 必须是真实 SQL 可能产出的形状：any_used **不分产品**，三个产品查出来必然
    // 完全相同（2026-09-20 生产实测都是 6）；按产品的用量在 product_used 里。
    // 初版 fixture 手工造了「20X any_used=1、5X any_used=0」这种真实 SQL 产不出的数据，
    // 于是断言全绿、把「byProduct.used 取错列」这个 bug 盖住了。
    // 5X：两台水位都是 0（生产实情，Lemon 2026-09-20 确认正常 —— 前期没给它做库存卡）
    [{ provider_account_id: 'pa-hnskj', stock_available: 0, bindable_now: 0, any_used: 6, product_used: 0, plus_target_available: 0 },
      { provider_account_id: 'pa-backup-a', stock_available: 0, bindable_now: 0, any_used: 6, product_used: 0, plus_target_available: 0 }],
    // 20X：水位也是 0，但已经有卡在服务（生产 backup-a 有 1 张）
    [{ provider_account_id: 'pa-hnskj', stock_available: 0, bindable_now: 0, any_used: 6, product_used: 0, plus_target_available: 0 },
      { provider_account_id: 'pa-backup-a', stock_available: 0, bindable_now: 0, any_used: 6, product_used: 1, plus_target_available: 0 }],
    [{ provider_account_id: 'pa-hnskj', spent_today: '16.000000', currency: 'USD' },
      { provider_account_id: 'pa-backup-a', spent_today: '33.250000', currency: 'USD' }],
    // 两台钱包的上次余额（latestProviderBalancesSql，2026-09-24）：hnskj 有、backup-a 这次没有
    [{ provider_account_id: 'pa-hnskj', available_balance: '104.710000', currency: 'USD', observed_at: new Date('2026-09-24T02:23:36.671Z') }],
    [{ active: 1, writes_on: 0 }]
  ]);
  const result = await createAdminReadService({ pool }).getOverview();
  assert.match(pool.queries[0].sql, /o\.status = 'RECHARGE_FAILED' AND \(EXISTS \(/);
  assert.doesNotMatch(pool.queries[0].sql, /'CARD_FAILED','SUBMIT_UNKNOWN','RECHARGE_FAILED'/);
  assert.deepEqual(result.decisions, {
    acceptNewOrders: false, dispatchNewRecharges: false,
    browserPaymentWritesEnabled: false, browserProfileWritesEnabled: false,
    cardAutoReplenishmentEnabled: false, cardBalanceRechargeEnabled: false,
    supplyAutomationEnabled: false, supplyAutomationMixed: false
  });
  assert.match(pool.queries.find(({ sql }) => /^\s*SELECT COUNT\(\*\) AS active/.test(sql)).sql, /productionWritesEnabled/);
  // 卡与钱按台按产品（D-283 原规划）：三个产品都要在，水位 0 的要标成「不自动补」
  const hnskj = result.cardStockByProvider.find((r) => r.providerKind === 'hnskj');
  assert.deepEqual(hnskj.byProduct.map((p) => p.productCode), ['plus', 'pro_5x', 'pro_20x']);
  assert.deepEqual(hnskj.byProduct.map((p) => p.label), ['Plus', '5X', '20X']);
  assert.equal(hnskj.byProduct[0].autoReplenished, true, 'Plus 水位 2 → 会自动补');
  assert.equal(hnskj.byProduct[2].autoReplenished, false, '20X 水位 0 → 不会自动补，断了要人工开');
  assert.equal(hnskj.byProduct[2].used, 0, 'hnskj 没有 20X 用量');
  const backup = result.cardStockByProvider.find((r) => r.providerKind === 'manual_excel');
  assert.equal(backup.byProduct[2].used, 1, 'backup-a 有 1 张卡服务过 20X');
  // 三个产品的 used 不能因为 any_used 相同而相同 —— 它们必须来自 product_used
  assert.deepEqual(backup.byProduct.map((p) => p.used), [6, 0, 1]);
  // D-355 ⑦：工作台显示「剩 N 张 · 能充 N 单」，能充几单来自 remaining_orders（库存卡按产品上限 − 已用 之和）
  assert.equal(hnskj.byProduct[0].remainingOrders, 5);
  assert.equal(hnskj.byProduct[2].remainingOrders, 0, 'fixture 没给 remaining_orders 的按 0 算');
  // 今日花费按台（消费 + 开卡费，不含 card_recharge —— 算了会和消费重复）
  assert.equal(hnskj.spentToday, '16.000000');
  assert.deepEqual(hnskj.wallet, { balance: '104.710000', currency: 'USD', observedAt: '2026-09-24T02:23:36.671Z' });
  assert.equal(result.cardStockByProvider.find((r) => r.providerKind === 'manual_excel').wallet, null, '没有余额观察就是 null，不是 0');
  assert.match(pool.queries[13].sql, /FROM provider_balance_snapshots s[\s\S]*MAX\(observed_at\)/);
  assert.equal(result.cardStockByProvider.find((r) => r.providerKind === 'manual_excel').spentToday, '33.250000');
  // 有多少人在等卡：库存讲「有多少」，这个讲「有多少人在等」
  // 等卡数来自 orderCounts 里早就存在的 waiting_for_card（SUM(status='WAITING_FOR_CARD')），
  // 不另起一条查询 —— 初版重复造了一个，还把状态值写错。
  assert.equal(result.ordersWaitingForCard, result.metrics.waitingForCard);
  const waitingSqls = pool.queries.filter(({ sql }) => /AS waiting_for_card/.test(sql));
  assert.equal(waitingSqls.length, 1, '算等卡的 SQL 只能有一条');
  assert.match(waitingSqls[0].sql, /o\.status = 'WAITING_FOR_CARD'/);
  // 今日花费必须用 first_seen_at（occurred_at 生产全为 NULL）并含拒付
  const spendSql = pool.queries.find(({ sql }) => /card_issue_fee/.test(sql)).sql;
  assert.match(spendSql, /first_seen_at/);
  assert.doesNotMatch(spendSql, /t\.occurred_at/);
  // 直接断言类型列表本身 —— 按关键词匹配会被 SQL 注释里的文字干扰
  // （注释里写着「不含 card_recharge」，doesNotMatch(/card_recharge/) 因此误报）
  assert.match(spendSql, /IN \('card_issue_fee', 'chargeback', 'chargeback_fee'\)/);
  assert.equal(result.metrics.successRate, 80);
  assert.equal(result.metrics.recentSuccessRate, 50);
  assert.equal(result.metrics.recentSuccessfulOrders, 1);
  assert.equal(result.metrics.recentFinishedOrders, 2);
  assert.match(pool.queries[0].sql, /created_at >= TIMESTAMP\(DATE\(CONVERT_TZ\(UTC_TIMESTAMP\(\), '\+00:00', '\+08:00'\)\)\) - INTERVAL 6 DAY - INTERVAL 8 HOUR/);
  assert.match(pool.queries[0].sql, /closeRehearsalOrder[\s\S]*= 'true'/);
  assert.equal(result.metrics.todayOrders, 2);
  assert.equal(result.metrics.awaitingConfirmationOrders, 1);
  assert.deepEqual(result.orderStatuses, [{ status: 'RECHARGE_SUCCESS', count: 8 }]);
  assert.deepEqual(result.cardStock, {
    available: 7, provisioning: 1, assigned: 2, depleted: 1, held: 1,
    needsFunding: 1, lowThreshold: 5, autoReplenishmentEnabled: false,
    balanceFundingEnabled: false, low: false
  });
  // 整行比对：byProduct / spentToday / 故障态由上面各自的断言管，这里只钉「不多不少哪些字段」
  // 与标量值，免得整块对象一改就得重抄一遍（但字段集合仍然被钉死）。
  assert.deepEqual(result.cardStockByProvider.map((r) => Object.keys(r).sort()), [
    ['anyUsed', 'bindableNow', 'byProduct', 'inStock', 'inUse', 'label', 'providerAccountId',
      'providerCode', 'providerKind', 'spentCurrency', 'spentToday', 'stockAvailable',
      'supplyFaultReason', 'supplyFaultState', 'total', 'wallet'],
    ['anyUsed', 'bindableNow', 'byProduct', 'inStock', 'inUse', 'label', 'providerAccountId',
      'providerCode', 'providerKind', 'spentCurrency', 'spentToday', 'stockAvailable',
      'supplyFaultReason', 'supplyFaultState', 'total', 'wallet']
  ]);
  assert.deepEqual(result.cardStockByProvider.map((r) => ({
    providerAccountId: r.providerAccountId, providerCode: r.providerCode,
    providerKind: r.providerKind, label: r.label, total: r.total,
    inStock: r.inStock, stockAvailable: r.stockAvailable, bindableNow: r.bindableNow, inUse: r.inUse, anyUsed: r.anyUsed
  })), [
    // label 由 domain/provider-labels 给，页面不自己拼（2026-09-20 一致性摸排第 5 条）
    { providerAccountId: 'pa-hnskj', providerCode: 'legacy-primary', providerKind: 'hnskj', label: 'HNSKJ', total: 14, inStock: 2, stockAvailable: 2, bindableNow: 0, inUse: 0, anyUsed: 6 },
    { providerAccountId: 'pa-backup-a', providerCode: 'backup-a', providerKind: 'manual_excel', label: 'highvcc', total: 16, inStock: 7, stockAvailable: 2, bindableNow: 2, inUse: 0, anyUsed: 6 }
  ]);
  assert.deepEqual(result.operationalBacklog, {
    cardIntakePending: 2, fundsRiskPending: 1,
    cardFundingRiskPending: 2, cardFundingManualReview: 1,
    reconciliationCasesOpen: 3, cardSyncBacklog: 4,
    cardSyncOldestAgeSeconds: 0, cardSyncAvgLatencySeconds: 0,
    cardSyncFailureRate: 0, cardSyncReviewRequired: 2,
    replenishmentUsedToday: 0, replenishmentDailyLimit: 5,
    replenishmentRemainingToday: 5
  });
  assert.deepEqual(result.providerHealth, {
    provider: 'hnskj', routeLabel: '当前 Plus 卡台路线未配置', accountCode: null,
    syncedAt: null, accountBalance: null, currency: 'USD', purchaseEnabled: null,
    rechargeMethod: null, browserWorkerHeartbeatAt: null, browserRechargeReady: false
  });
  assert.equal(pool.queries.some(({ sql }) => /session_ciphertext|recharge_card_key/i.test(sql)), false);
  assert.match(pool.queries.find(({ sql }) => /COUNT\(\*\) AS count FROM operator_alerts/.test(sql)).sql,
    /severity IN \('warning','critical'\)/);
});

test('admin internal reminders expose only actionable warning and critical alerts', async () => {
  const pool = queuedPool([[]]);
  const result = await createAdminReadService({ pool }).listAlerts({ limit: 20 });
  assert.deepEqual(result, { alerts: [] });
  assert.match(pool.queries[0].sql, /a\.severity IN \('warning','critical'\)/);
});

test('admin order list validates filters, maps card summaries, and supports CDK lookup', async () => {
  const pool = queuedPool([
    [{ total: 1 }],
    [{
      public_no: 'PJV1-DEMO', status: 'SUBMIT_UNKNOWN', customer_email: 'a@example.com',
      chatgpt_account_id: 'acct', recharge_order_no: null, failure_code: 'TIMEOUT',
      actual_payment_amount: '1150.000000', actual_payment_currency: 'PHP',
      created_at: new Date('2026-08-17T00:00:00Z'), updated_at: new Date('2026-08-17T00:01:00Z'),
      finished_at: null, last4: '4242', current_balance: '25.000000', currency: 'USD',
      provider_account_id: 'test-highvcc', provider_card_id: 'test-card', card_provider_code: 'manual_excel',
      refund_status: 'MONITORING',
      card_number_ciphertext: encryptSecret('4242424242424242', adminCardKey)
    }], []
  ]);
  const result = await createAdminReadService({
    pool, sessionEncryptionKey: adminCardKey, cdkHashKey: adminCdkKey
  }).listOrders({
    page: '1', pageSize: '20', status: 'REVIEW_REQUIRED', q: 'PJV1'
  });
  assert.equal(result.total, 1);
  assert.deepEqual(result.orders[0].card, {
    cardNumber: '4242424242424242', last4: '4242', currentBalance: '25.000000',
    providerAccountId: 'test-highvcc', providerCardId: 'test-card', providerLabel: 'highvcc',
    currency: 'USD', refundStatus: 'MONITORING'
  });
  assert.equal(result.orders[0].actualPaymentAmount, '1150.000000');
  assert.equal(result.orders[0].actualPaymentCurrency, 'PHP');
  assert.equal(result.orders[0].stage.stage, 'PAYMENT_UNKNOWN');
  assert.match(result.orders[0].stage.action, /先对账/);
  assert.equal(result.orders[0].browserRun, null);
  assert.match(pool.queries[1].sql, /LEFT JOIN LATERAL[\s\S]*FROM browser_runs lbr/);
  assert.match(pool.queries[1].sql, /LEFT JOIN products prod ON prod\.id = o\.product_id/);
  assert.deepEqual(result.cdkMatches, []);
  assert.deepEqual(pool.queries[0].values.slice(0, 5), [
    'CARD_FAILED', 'WAITING_FOR_SESSION', 'SUBMIT_UNKNOWN',
    'CANCELLATION_REVIEW_REQUIRED', 'RECONCILIATION_REQUIRED'
  ]);
  assert.match(pool.queries[0].sql, /o\.status = 'RECHARGE_FAILED' AND \(EXISTS \(/);
  assert.match(pool.queries[0].sql, /funds_risk_state IN \('UNKNOWN','SETTLED'\)/);
  assert.match(pool.queries[0].sql, /payment_state IN \('PAYMENT_CONFIRMED','PAYMENT_UNKNOWN'\)/);
  assert.equal(pool.queries.some(({ sql }) => /session_ciphertext|recharge_card_key/i.test(sql)), false);
  assert.match(pool.queries[0].sql, /EXISTS \(\s*SELECT 1 FROM cdks cdk/i);
  // 关键词搜索少了「标签」那一个 LIKE（D-367 删 order_tags）：22 → 21
  assert.equal(pool.queries[0].values.length, 21);
  assert.match(pool.queries[0].sql, /card_assignment_history/i);
  assert.match(pool.queries[0].sql, /customer_payments/i);

  await assert.rejects(
    () => createAdminReadService({ pool: queuedPool([]) }).listOrders({ status: 'NOT_A_STATUS' }),
    /Invalid status/
  );
});

test('admin order list supports the 进行中 / 已完成 / 近7天统计样本 virtual filters', async () => {
  const active = queuedPool([[{ total: 0 }], []]);
  await createAdminReadService({ pool: active }).listOrders({ status: 'ACTIVE' });
  assert.match(active.queries[0].sql, /o\.status NOT IN \(\?, \?, \?\)/);
  assert.deepEqual(active.queries[0].values.slice(0, 3), ['RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'CLOSED']);
  const finished = queuedPool([[{ total: 0 }], []]);
  await createAdminReadService({ pool: finished }).listOrders({ status: 'FINISHED' });
  assert.match(finished.queries[0].sql, /o\.status IN \(\?, \?, \?\)/);
  const recent = queuedPool([[{ total: 0 }], [], []]);
  await createAdminReadService({ pool: recent }).listOrders({ status: 'RECENT_FINISHED' });
  assert.match(recent.queries[0].sql, /o\.status IN \('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED'\)/);
  assert.match(recent.queries[0].sql, /o\.created_at >=[\s\S]*INTERVAL 6 DAY - INTERVAL 8 HOUR/);
  assert.match(recent.queries[0].sql, /closeRehearsalOrder[\s\S]*= 'true'/);
  assert.deepEqual(recent.queries[0].values, []);
});

test('admin order detail exposes the full PAN but not CVV or Session', async () => {
  const nowMs = Date.parse('2026-08-19T08:00:00.000Z');
  const pool = queuedPool([
    [{
      id: 'order-1', public_no: 'PJV1-DEMO', status: 'CARD_READY', plan_type: 'plus',
      open_card_amount: '16.000000', minimum_required_card_balance: '15.500000',
      actual_payment_amount: null, actual_payment_currency: null,
      provider_card_id: 'card-1', last4: '4242', card_status: 'active',
      current_balance: '16.000000',
      session_ciphertext: encryptSecret(JSON.stringify(sessionFixture({ nowMs })), adminCardKey),
      card_credentials_ciphertext: encryptSecret(JSON.stringify({
        cardNumber: '4242424242424242', expMonth: 12, expYear: 2032, cvv: '123'
      }), adminCardKey),
      card_number_ciphertext: encryptSecret('4242424242424242', adminCardKey),
      last_synced_at: new Date(nowMs - 60_000),
      created_at: new Date(nowMs), updated_at: new Date(nowMs)
    }],
    [], [{
      task_type: 'PREPARE_RECHARGE', status: 'COMPLETED', attempts: 1, max_attempts: 5,
      permit_status: null, permit_expires_at: null
    }, {
      task_type: 'SUBMIT_RECHARGE', status: 'PENDING', attempts: 0, max_attempts: 5,
      permit_status: null, permit_expires_at: null
    }], [], [], [], [], [], [], [], [], [], [],
    [{ id: 'attempt-1', executor_kind: 'BROWSER', status: 'PREPARED', funds_risk_state: 'CLEARED',
      external_order_id: null, submit_intent_at: null, submitted_at: null, last_reconciled_at: null,
      finished_at: null, created_at: new Date(nowMs) }],
    [{ status: 'RESERVED', amount: '20.000000', currency: 'USD', provider_transaction_id: null,
      reserved_at: new Date(nowMs), consumed_at: null, released_at: null, release_reason: null,
      recharge_attempt_id: 'attempt-1' }],
    [{ browser_run_id: 'run-1', operation_type: 'MANUAL_20X_HANDOFF', status: 'COMMITTED', result_code: 'AWAITING_MANUAL_20X_UPGRADE',
      prepared_at: new Date(nowMs), completed_at: new Date(nowMs),
      public_result_json: JSON.stringify({ evidenceHash: 'x', humanOwnerId: 'admin', publicResult: { upgradeReason: null,
        upgradeDialog: { plan: 'pro_20x', subscriptionAmount: '₱8,919.64', adjustmentAmount: '-₱973.87', totalDueToday: '₱7,945.77',
          paymentMethod: { brand: 'VISA', last4: '5501' }, stoppedBefore: 'PAY_NOW', recovery: { recovered: true, recoveryStep: 'clear-login-cookies' } } } }) }],
    [{ id: 'case-1', case_type: 'SUBMIT_UNKNOWN', status: 'OPEN', severity: 'warning',
      assigned_to: null, resolution_note: null, detected_at: new Date(nowMs), last_seen_at: new Date(nowMs),
      resolved_at: null }]
  ]);
  const result = await createAdminReadService({
    pool, sessionEncryptionKey: adminCardKey, now: () => nowMs
  }).getOrder('PJV1-DEMO');
  assert.equal(result.order.publicNo, 'PJV1-DEMO');
  assert.equal(result.stage.stage, 'QUEUED');
  assert.equal(result.browserRun, null);
  assert.deepEqual(result.money.attempts.map((item) => [item.id, item.status, item.fundsRiskState]),
    [['attempt-1', 'PREPARED', 'CLEARED']]);
  assert.deepEqual(result.money.ledger.map((item) => [item.status, item.amount, item.currency]),
    [['RESERVED', '20.000000', 'USD']]);
  assert.deepEqual(result.money.operations.map((item) => [item.type, item.upgradeDialog]), [['MANUAL_20X_HANDOFF', {
    reason: null, plan: 'pro_20x', subscriptionAmount: '₱8,919.64', adjustmentAmount: '-₱973.87', totalDueToday: '₱7,945.77',
    paymentMethod: { brand: 'VISA', last4: '5501' }, stoppedBefore: 'PAY_NOW', recoveryStep: 'clear-login-cookies'
  }]]);
  assert.deepEqual(result.reconciliationCases.map((item) => [item.id, item.status]), [['case-1', 'OPEN']]);
  assert.match(pool.queries.find(({ sql }) => /FROM card_consumption_ledger l/.test(sql)).sql, /BINARY o\.public_no = \?/);
  assert.match(pool.queries[0].sql, /LEFT JOIN LATERAL/);
  assert.equal(result.order.minimumRequiredCardBalance, '15.500000');
  assert.equal(result.card.cardNumber, '4242424242424242');
  assert.equal(Object.hasOwn(result.card, 'cvv'), false);
  assert.deepEqual(result.paymentGate, {
    prepaymentReady: true,
    submissionLocked: true,
    permitStatus: 'LOCKED',
    permitExpiresAt: null,
    authorizationId: null,
    rechargeAttemptStatus: null,
    fundsRiskState: null,
    submissionTaskStatus: 'PENDING',
    submissionAttempts: 0,
    sessionValid: true,
    sessionCode: null,
    sessionExpiresAt: '2026-08-19T09:00:00.000Z',
    accessTokenExpiresAt: '2026-08-19T09:00:00.000Z',
    cardReady: true,
    cardCheckFresh: true
  });
  // 补发随 D-367 删除：详情不再给补发资格（前端从未使用），标签与订单关联两块同删。
  assert.equal(Object.hasOwn(result, 'compensation'), false);
  assert.deepEqual(result.cancellation, {
    eligible: true, alreadyCancelled: false, code: 'ORDER_CANCELLATION_ELIGIBLE',
    cardWillBeReleased: true
  });
  assert.deepEqual(result.transactions, []);
  assert.deepEqual(result.traceability, {
    deliveryTrackingEnabled: false,
    cdks: [], deliveries: [], customerPayments: [], cardAssignments: [], notes: [],
    sessionReplacements: [],
    fulfillmentCost: {
      customerPayments: [], cardFundedAmount: [], providerConfirmedPayment: [],
      successfulCardPurchases: [], cardTransactionFees: [], exchangeRateApplied: false,
      note: '各币种保留原值；未留存的历史费用显示为空，不推算汇率或成本。'
    }
  });
  assert.equal(JSON.stringify(result).includes('fixture-signature'), false);
  assert.equal(JSON.stringify(result).includes('sessionToken'), false);
  assert.equal(pool.queries.some(({ sql }) => /\bcvv\b/i.test(sql)), false);
});

test('admin order detail prefers the Provider attempt failure reason over a generic order reason', async () => {
  const nowMs = Date.parse('2026-09-01T07:30:00.000Z');
  const pool = queuedPool([
    [{
      id: 'order-failed', public_no: 'PJV1-FAILED', status: 'RECHARGE_FAILED', plan_type: 'plus',
      failure_code: 'PROVIDER_CONFIRMED_FAILURE',
      failure_reason: 'Recharge provider confirmed failure',
      recharge_attempt_result_summary_json: JSON.stringify({
        status: 'failed', failureReason: '卡片被拒，请换卡后重提'
      }),
      created_at: new Date(nowMs - 60_000), updated_at: new Date(nowMs),
      finished_at: new Date(nowMs)
    }],
    [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []
  ]);
  const result = await createAdminReadService({ pool, now: () => nowMs })
    .getOrder('PJV1-FAILED');
  assert.equal(result.stage.stage, 'CLOSED_NO_PAYMENT');
  assert.equal(result.order.failureCode, 'PROVIDER_CONFIRMED_FAILURE');
  assert.equal(result.order.failureReason, '卡片被拒，请换卡后重提');
  assert.equal(result.order.failureReasonSource, 'PROVIDER_ATTEMPT');
  assert.match(pool.queries[0].sql, /recharge_attempt_result_summary_json/);
});

test('admin unified search supports exact PAN HMAC and bounded time filters (tag filter retired, D-367)', async () => {
  const panKey = Buffer.alloc(32, 31);
  const pool = queuedPool([[{ total: 0 }], []]);
  await createAdminReadService({ pool, panHmacKey: panKey }).listOrders({
    q: '4242-4242-4242-4242', tag: '补发', // 旧参数：传了也被忽略
    from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z'
  });
  const countQuery = pool.queries[0];
  assert.match(countQuery.sql, /sc\.pan_hmac = \?/i);
  assert.doesNotMatch(countQuery.sql, /order_tags|order_compensations/i);
  assert.equal(countQuery.values.includes('补发'), false);
  assert.match(countQuery.sql, /o\.created_at >= \?/i);
  assert.match(countQuery.sql, /o\.created_at <= \?/i);
  const expectedHmac = (await import('node:crypto')).default
    .createHmac('sha256', panKey).update('4242424242424242').digest('hex');
  assert.ok(countQuery.values.includes(expectedHmac));

  await assert.rejects(
    () => createAdminReadService({ pool: queuedPool([]) }).listOrders({
      from: '2026-09-01', to: '2026-08-01'
    }),
    /Invalid time range/
  );
});

test('manual transaction sync queues only a read task and deduplicates active work', async () => {
  const queries = [];
  const responses = [
    [[{ setting_value: 'true' }], []],
    [[{ id: 'order-1', card_id: 'card-1' }], []],
    [[], []],
    [{ affectedRows: 1 }, []]
  ];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      const result = responses.shift();
      if (!result) throw new Error('Unexpected query');
      return result;
    }
  };
  const pool = { async getConnection() { return connection; } };
  const result = await createAdminReadService({ pool }).requestCardTransactionSync('PJV1-DEMO');
  assert.deepEqual(result, { queued: true, taskStatus: 'PENDING' });
  assert.match(queries[3].sql, /SYNC_CARD_TRANSACTIONS/);
  assert.equal(queries[3].values[0], 'order-1');
  assert.match(queries[3].values[1], /^manual-sync:order-1:/);

  const activeConnection = {
    ...connection,
    async query(sql, values = []) {
      if (/SELECT setting_value/.test(sql)) return [[{ setting_value: 'true' }], []];
      if (/SELECT o\.id/.test(sql)) return [[{ id: 'order-1', card_id: 'card-1' }], []];
      if (/SELECT status FROM tasks/.test(sql)) return [[{ status: 'RUNNING' }], []];
      throw new Error('should not insert while active');
    }
  };
  const activeResult = await createAdminReadService({ pool: { async getConnection() { return activeConnection; } } })
    .requestCardTransactionSync('PJV1-DEMO');
  assert.deepEqual(activeResult, { queued: false, taskStatus: 'RUNNING' });
});

test('card consumption read view reports reserved, consumed and reconciliation counts without writes', async () => {
  const queries = [];
  const pool = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/GROUP BY c\.id/.test(sql)) return [[{
        provider_card_id: 'card-6807', last4: '6807', card_status: 'active',
        total_records: 3, reserved_count: 1, consumed_count: 1,
        reconciliation_count: 1, released_count: 0
      }], []];
      if (/FROM card_consumption_ledger l/.test(sql)) return [[{
        id: 'ledger-1', provider_card_id: 'card-6807', last4: '6807', order_id: 'order-1',
        recharge_attempt_id: 'attempt-1', product_id: 'plus', status: 'RECONCILIATION',
        amount: '20.00', currency: 'USD', provider_transaction_id: null,
        reserved_at: new Date(), consumed_at: null, released_at: null, release_reason: null
      }], []];
      if (/card_max_successful_payments/.test(sql)) return [[{ setting_value: '3' }], []];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const result = await createAdminReadService({ pool }).getCardConsumption({ providerCardId: 'card-6807' });
  assert.equal(result.maxSuccessfulPayments, 3);
  assert.deepEqual(result.cards[0].consumed, 1);
  assert.equal(result.records[0].status, 'RECONCILIATION');
  assert.equal(queries.every((query) => !/^\s*(INSERT|UPDATE|DELETE)/i.test(query.sql)), true);
});

// 审查 #1b 的防回潮：「今天(UTC+8)」只许有一份定义。
// 原先 admin-read-service 里两处手写了同样的表达式（今日订单计数 / TODAY 过滤），
// 当前结果一致所以没人发现，但改「今天」定义时就会漂移——工作台说今天 3 单、
// 订单页 TODAY 却筛出 5 单这种不一致，查起来极难。
test('「今天(UTC+8)」窗口只有一份定义，src 里不得再手写 CONVERT_TZ 日界表达式', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const OWNER = 'card-inventory-eligibility.js'; // todayCst8WindowSql 的家
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js') || entry.name === OWNER) continue;
      const text = fs.readFileSync(full, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (line.includes("CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')")) {
          offenders.push(`${path.relative(srcDir, full)}:${i + 1}`);
        }
      });
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, [],
    `这些地方又手写了「今天」的日界，请改用 todayCst8WindowSql()：\n  ${offenders.join('\n  ')}`);
});

test('admin order detail: a card-less Session-waiting order (card released per D-355) is cancellable, card not released', async () => {
  const nowMs = Date.parse('2026-09-24T00:00:00.000Z');
  const pool = queuedPool([
    [{
      id: 'order-2', public_no: 'PJV1-WAIT', status: 'WAITING_FOR_SESSION', plan_type: 'plus',
      open_card_amount: '16.000000', minimum_required_card_balance: '15.500000',
      actual_payment_amount: null, actual_payment_currency: null,
      provider_card_id: null, last4: null, card_status: null, current_balance: null,
      recharge_order_no: null, recharge_card_key: null,
      session_ciphertext: null, card_credentials_ciphertext: null, card_number_ciphertext: null,
      created_at: new Date(nowMs), updated_at: new Date(nowMs)
    }],
    [], [{ task_type: 'SUBMIT_RECHARGE', status: 'DEAD', attempts: 1, max_attempts: 5, permit_status: null, permit_expires_at: null }],
    [], [], [], [], [], [], [], [], [], [],
    [{ id: 'attempt-9', executor_kind: 'BROWSER', status: 'CANCELLED', funds_risk_state: 'CLEARED',
      external_order_id: null, submit_intent_at: null, submitted_at: null, last_reconciled_at: null,
      finished_at: new Date(nowMs), created_at: new Date(nowMs) }],
    [], [], []
  ]);
  const result = await createAdminReadService({ pool, sessionEncryptionKey: adminCardKey, now: () => nowMs }).getOrder('PJV1-WAIT');
  assert.deepEqual(result.cancellation, {
    eligible: true, alreadyCancelled: false, code: 'ORDER_CANCELLATION_ELIGIBLE', cardWillBeReleased: false
  });
  assert.match(pool.queries[0].sql, /o\.recharge_card_key/);
});

test('admin order detail: a card-less Session-waiting order with a live funds attempt is NOT cancellable', async () => {
  const nowMs = Date.parse('2026-09-24T00:00:00.000Z');
  const pool = queuedPool([
    [{ id: 'order-3', public_no: 'PJV1-RISK', status: 'WAITING_FOR_SESSION', plan_type: 'plus',
      open_card_amount: '16.000000', minimum_required_card_balance: '15.500000',
      actual_payment_amount: null, actual_payment_currency: null, provider_card_id: null,
      recharge_order_no: null, recharge_card_key: null, session_ciphertext: null,
      created_at: new Date(nowMs), updated_at: new Date(nowMs) }],
    [], [], [], [], [], [], [], [], [], [], [], [],
    [{ id: 'attempt-8', executor_kind: 'BROWSER', status: 'SUBMIT_UNKNOWN', funds_risk_state: 'UNKNOWN',
      external_order_id: null, submit_intent_at: null, submitted_at: null, last_reconciled_at: null,
      finished_at: null, created_at: new Date(nowMs) }],
    [], [], []
  ]);
  const result = await createAdminReadService({ pool, sessionEncryptionKey: adminCardKey, now: () => nowMs }).getOrder('PJV1-RISK');
  assert.equal(result.cancellation.eligible, false);
});

