const STATUS_META = Object.freeze({
  CREATED: ['已创建', 'blue'],
  CARD_PURCHASING: ['开卡中', 'blue'],
  CARD_PROVISIONING: ['等待卡片到账', 'blue'],
  CARD_READY: ['卡片就绪', 'blue'],
  CARD_FAILED: ['开卡失败', 'red'],
  WAITING_FOR_SESSION: ['等待客户更换 Session', 'orange'],
  SUBMITTING: ['提交中', 'blue'],
  SUBMIT_UNKNOWN: ['提交待确认', 'orange'],
  RECHARGE_PROCESSING: ['充值处理中', 'blue'],
  RECHARGE_SUCCESS: ['充值成功', 'green'],
  RECHARGE_FAILED: ['充值失败', 'red'],
  CANCELLATION_PENDING: ['取消续费确认中', 'blue'],
  CANCELLATION_REVIEW_REQUIRED: ['取消续费需复核', 'orange'],
  RECONCILIATION_REQUIRED: ['需要对账', 'orange'],
  CLOSED: ['已关闭', 'gray']
});

const SETTING_META = Object.freeze({
  accept_new_orders: '接收新订单',
  dispatch_new_recharges: '派发新充值',
  recharge_dispatch_mode: '充值派发模式',
  poll_existing_orders: '追踪已有订单',
  sync_card_transactions: '同步卡片交易（只读）'
});

const PERMIT_LABELS = Object.freeze({
  LOCKED: '未放行', ARMED: '已放行', CONSUMED: '已使用',
  REVOKED: '已撤销', EXPIRED: '已过期', RELEASED: '已释放'
});
const TASK_LABELS = Object.freeze({
  ASSIGN_CARD: '分配库存卡', PURCHASE_CARD: '开卡', VERIFY_CARD: '核对卡片',
  PREPARE_RECHARGE: '付款前准备', SUBMIT_RECHARGE: '提交充值', POLL_RECHARGE: '查询充值结果',
  RECHECK_CANCELLATION: '复查续费取消', SYNC_CARD_TRANSACTIONS: '同步卡片交易'
});
const TASK_STATUS_LABELS = Object.freeze({ PENDING: '等待执行', RUNNING: '执行中', COMPLETED: '已完成', DEAD: '需要人工处理' });
const REFUND_LABELS = Object.freeze({ MONITORING: '观察中', DETECTED: '疑似退款', CONFIRMED: '已确认退款', WITHDRAWN: '已提取' });
const INVENTORY_LABELS = Object.freeze({ AVAILABLE: '可分配', ASSIGNED: '已分配', DEPLETED: '已耗尽', PROVISIONING: '核对中', FAILED: '已失效', HELD_FOR_REVIEW: '已隔离，禁止自动复用' });
const RECONCILIATION_LABELS = Object.freeze({ OK: '已对账', STALE: '待同步', SYNCING: '同步中', REVIEW_REQUIRED: '需核对', MISMATCH: '不一致' });
const CARD_INTAKE_LABELS = Object.freeze({
  QUARANTINED: '待第二次稳定读取', VALIDATED: '验证通过，待接管',
  REVIEW_REQUIRED: '需人工核对', ACCEPTED: '已接管', EXISTING: '已在库存', FAILED: '验证失败'
});
const CARD_INTAKE_BATCH_LABELS = Object.freeze({
  DISCOVERED: '已发现', VALIDATING: '验证中', VALIDATED: '已验证',
  REVIEW_REQUIRED: '需人工核对', ACCEPTED: '已接管', COMPLETED: '已完成', FAILED: '失败'
});
const ORDER_RECONCILIATION_LABELS = Object.freeze({
  MATCHED: '三方一致', NOT_SUBMITTED: '尚未提交', IN_PROGRESS: '对账进行中',
  EVIDENCE_PENDING: '等待卡片证据', CONSISTENT_FAILURE: '失败结果一致', REVIEW_REQUIRED: '三方对账异常'
});
const ORDER_RECONCILIATION_CODES = Object.freeze({
  THREE_WAY_MATCHED: '充值平台金额与卡片支付交易一致，且交易已结算',
  RECHARGE_NOT_SUBMITTED: '没有充值平台创建调用，也没有成功扣款',
  SUBMISSION_IN_PROGRESS: '充值请求正在提交', RECHARGE_IN_PROGRESS: '充值平台仍在处理',
  ORDER_NOT_TERMINAL: '订单尚未进入最终状态', CARD_TRANSACTIONS_NOT_SYNCED: '等待同步卡片交易',
  CARD_PAYMENT_UNSETTLED: '卡片支付金额一致，等待结算',
  PROVIDER_PAYMENT_EVIDENCE_MISSING: '充值成功，但充值平台缺少支付金额或币种',
  PAYMENT_AMOUNT_MISMATCH: '充值平台支付金额与卡片成功交易不一致',
  CARD_PAYMENT_NOT_FOUND: '充值成功，但已同步的卡片交易中没有对应成功支付',
  CARD_CHARGED_WITHOUT_RECHARGE: '充值未提交，但关联卡片出现成功支付',
  FAILED_ORDER_HAS_SUCCESSFUL_CHARGE: '订单失败，但关联卡片出现成功支付',
  RECHARGE_ORDER_ID_MISSING: '已调用充值平台，但本地缺少外部订单号',
  SUBMIT_UNKNOWN: '充值提交结果未知', RECONCILIATION_REQUIRED: '订单状态要求人工对账',
  RECHARGE_CREATE_STALLED: '充值调用启动后超过 2 分钟没有确定结果',
  NO_SUCCESSFUL_CARD_CHARGE: '订单失败，卡片侧没有成功支付'
});

const state = {
  view: 'overview', page: 1, pageSize: 20, total: 0, status: '', query: '',
  from: '', to: '', timeField: 'CREATED',
  stockProvider: null, stockCatalog: null, stockCardTypeId: '', acceptingOrders: false,
  cdkClearTimer: null, cdkLoadSequence: 0,
  selectedOrders: new Set(), reconciliationPage: 1, reconciliationTotal: 0,
  browserPage: 1, browserTotal: 0, cardFundingPage: 1, cardFundingTotal: 0
};
const elements = {
  navItems: [...document.querySelectorAll('.nav-item')],
  views: [...document.querySelectorAll('.view')],
  viewKicker: document.querySelector('#view-kicker'),
  viewTitle: document.querySelector('#view-title'),
  syncTime: document.querySelector('#sync-time'),
  metrics: document.querySelector('#metrics-grid'),
  overviewCdkRefundStatus: document.querySelector('#overview-cdk-refund-status'),
  overviewProviderHealth: document.querySelector('#overview-provider-health'),
  statusList: document.querySelector('#status-list'),
  settingList: document.querySelector('#setting-list'),
  recentOrders: document.querySelector('#recent-orders'),
  ordersTable: document.querySelector('#orders-table'),
  filters: document.querySelector('#order-filters'),
  search: document.querySelector('#order-search'),
  orderFrom: document.querySelector('#order-from'),
  orderTo: document.querySelector('#order-to'),
  orderTimeField: document.querySelector('#order-time-field'),
  statusFilter: document.querySelector('#status-filter'),
  orderCount: document.querySelector('#order-count'),
  pageLabel: document.querySelector('#page-label'),
  prevPage: document.querySelector('#prev-page'),
  nextPage: document.querySelector('#next-page'),
  detail: document.querySelector('#detail-drawer'),
  detailKicker: document.querySelector('#detail-kicker'),
  detailTitle: document.querySelector('#detail-title'),
  detailContent: document.querySelector('#detail-content'),
  notice: document.querySelector('#page-notice')
  ,alertsCard: document.querySelector('#alerts-card'), alertsList: document.querySelector('#alerts-list'),
  cdkForm: document.querySelector('#cdk-form'), cdkCount: document.querySelector('#cdk-count'),
  cdkResult: document.querySelector('#cdk-result'), generatedCdks: document.querySelector('#generated-cdks'),
  cdkBatchLabel: document.querySelector('#cdk-batch-label'), copyCdks: document.querySelector('#copy-cdks'),
  downloadCdks: document.querySelector('#download-cdks'), cdkBatches: document.querySelector('#cdk-batches'),
  stockSummary: document.querySelector('#stock-summary'), stockJobs: document.querySelector('#stock-jobs'),
  stockCards: document.querySelector('#stock-cards'), providerSummary: document.querySelector('#provider-summary'),
  stockThresholdForm: document.querySelector('#stock-threshold-form'), stockThreshold: document.querySelector('#stock-threshold'),
  replenishmentLimitForm: document.querySelector('#replenishment-limit-form'), replenishmentDailyLimit: document.querySelector('#replenishment-daily-limit'), replenishmentUsage: document.querySelector('#replenishment-usage'),
  stockOpenForm: document.querySelector('#stock-open-form'), stockOpenCount: document.querySelector('#stock-open-count'),
  stockOpenAmount: document.querySelector('#stock-open-amount'), stockCardType: document.querySelector('#stock-card-type'),
  stockCardProfile: document.querySelector('#stock-card-profile'),
  stockConfirmation: document.querySelector('#stock-confirmation'), stockConfirmHint: document.querySelector('#stock-confirm-hint'),
  stockCost: document.querySelector('#stock-cost'),
  cardIntakeList: document.querySelector('#card-intake-list'),
  discoverNewCards: document.querySelector('#discover-new-cards'),
  selectedOrderCount: document.querySelector('#selected-order-count'),
  batchAuthorizeRecharge: document.querySelector('#batch-authorize-recharge'),
  selectPageOrders: document.querySelector('#select-page-orders'),
  reconciliationTable: document.querySelector('#reconciliation-table'),
  reconciliationCount: document.querySelector('#reconciliation-count'),
  reconciliationPage: document.querySelector('#reconciliation-page'),
  reconciliationPrev: document.querySelector('#reconciliation-prev'),
  reconciliationNext: document.querySelector('#reconciliation-next'),
  reconciliationStatus: document.querySelector('#reconciliation-status'),
  reconciliationSeverity: document.querySelector('#reconciliation-severity'),
  browserFilters: document.querySelector('#browser-filters'),
  browserPublicNo: document.querySelector('#browser-public-no'),
  browserStatus: document.querySelector('#browser-status'),
  browserPaymentState: document.querySelector('#browser-payment-state'),
  browserControlState: document.querySelector('#browser-control-state'),
  browserRunsTable: document.querySelector('#browser-runs-table'),
  browserRunsCount: document.querySelector('#browser-runs-count'),
  browserRunsPage: document.querySelector('#browser-runs-page'),
  browserRunsPrev: document.querySelector('#browser-runs-prev'),
  browserRunsNext: document.querySelector('#browser-runs-next'),
  providerRoutesTable: document.querySelector('#provider-routes-table')
  ,cardFundingTable: document.querySelector('#card-funding-table')
  ,cardFundingCount: document.querySelector('#card-funding-count')
  ,cardFundingPage: document.querySelector('#card-funding-page')
  ,cardFundingPrev: document.querySelector('#card-funding-prev')
  ,cardFundingNext: document.querySelector('#card-funding-next')
  ,cardFundingStatus: document.querySelector('#card-funding-status')
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
}

function formatMoney(value) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '—';
}

function waitingText(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '等待系统自动执行';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return '刚刚就绪，等待系统自动执行';
  if (minutes < 60) return `已等待系统执行 ${minutes} 分钟`;
  return `已等待系统执行 ${Math.floor(minutes / 60)} 小时，请检查派发与 Provider 开关`;
}

function statusChip(status) {
  const [label, tone] = STATUS_META[status] || [status || '未知', 'gray'];
  return `<span class="status-chip status-${tone}"><i></i>${escapeHtml(label)}</span>`;
}

function showNotice(message, tone = 'error') {
  elements.notice.textContent = message;
  elements.notice.dataset.tone = tone;
  elements.notice.hidden = false;
}

function hideNotice() {
  elements.notice.hidden = true;
  elements.notice.textContent = '';
  delete elements.notice.dataset.tone;
}

async function api(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.replace('/admin/login');
    throw new Error('admin_auth_required');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'request_failed');
  return payload;
}

async function requestSensitiveAccess() {
  const password = window.prompt('请输入后台密码确认敏感操作：\n\n验证后 30 分钟内的受保护操作不再重复询问。');
  if (!password) throw new Error('admin_step_up_cancelled');
  const response = await fetch('/api/v1/admin/step-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'admin_step_up_failed');
}

function cdkErrorMessage(error, action) {
  const messages = {
    admin_step_up_cancelled: '已取消操作，没有修改任何 CDK。',
    invalid_admin_credentials: '后台密码错误，没有执行操作。',
    admin_step_up_failed: '敏感操作验证失败，请重新登录后再试。',
    admin_step_up_required: '敏感操作验证已过期，请重试。',
    batch_download_unavailable: '该批次没有可恢复的明文，无法导出。',
    batch_recovery_failed: '该批次恢复数据异常，已停止导出。',
    invalid_batch: '批次编号无效，没有执行操作。',
    batch_not_found: '没有找到该批次，可能已被删除或页面数据已过期。',
    invalid_count: '生成数量必须为 1–1000 之间的整数。',
    idempotency_mismatch: '上次生成请求的参数不一致，请刷新页面后再试。'
  };
  return messages[error?.message] || `${action}失败，服务器未确认操作结果；请先刷新批次列表，不要重复点击。`;
}

async function sensitiveApi(url, options) {
  try {
    return await api(url, options);
  } catch (error) {
    if (error.message !== 'admin_step_up_required') throw error;
    await requestSensitiveAccess();
    return api(url, options);
  }
}

function orderRow(order, { selectable = false } = {}) {
  const account = order.customerEmail || order.chatgptAccountId || '—';
  const card = order.card?.cardNumber
    ? escapeHtml(order.card.cardNumber)
    : order.card?.last4 ? escapeHtml(order.card.last4) : '—';
  const canAuthorize = order.status === 'CARD_READY' && order.requiresRechargeConfirmation;
  return `<tr data-order="${escapeHtml(order.publicNo)}" tabindex="0">
    ${selectable ? `<td><input type="checkbox" data-select-order value="${escapeHtml(order.publicNo)}" aria-label="选择订单 ${escapeHtml(order.publicNo)}" ${state.selectedOrders.has(order.publicNo) ? 'checked' : ''} ${canAuthorize ? '' : 'disabled title="仅付款前已就绪订单可加入灰度许可"'}></td>` : ''}
    <td><strong class="order-link">${escapeHtml(order.publicNo)}</strong></td>
    <td><span class="cell-main">${escapeHtml(account)}</span>${order.rechargeOrderNo ? `<small>${escapeHtml(order.rechargeOrderNo)}</small>` : ''}</td>
    <td>${statusChip(order.status)}${order.requiresRechargeConfirmation ? `<small class="attention-note">${escapeHtml(waitingText(order.confirmationReadyAt))}</small>` : order.cancellationReviewRequired ? '<small class="attention-note">续费需处理</small>' : ''}<small class="${order.reconciliation?.issue ? 'attention-note' : ''}">${escapeHtml(ORDER_RECONCILIATION_LABELS[order.reconciliation?.status] || order.reconciliation?.status || '—')}</small></td>
    <td>${card}</td>
    <td>${order.card?.refundStatus ? escapeHtml(REFUND_LABELS[order.card.refundStatus] || order.card.refundStatus) : '—'}</td>
    <td>${formatTime(order.createdAt)}</td>
  </tr>`;
}

async function loadOverview() {
  const [overview, recent, alertData] = await Promise.all([
    api('/api/v1/admin/overview'),
    api('/api/v1/admin/orders?page=1&pageSize=6'),
    api('/api/v1/admin/alerts?limit=10')
  ]);
  const metrics = [
    { label: '累计订单', value: overview.metrics.totalOrders, note: '全部已创建订单', filter: 'TODAY' },
    { label: '今日订单', value: overview.metrics.todayOrders, note: '点击查看今天新订单', filter: 'TODAY' },
    { label: '成功订单', value: overview.metrics.successfulOrders, note: '已完成 Plus 开通并结束续费', filter: 'RECHARGE_SUCCESS' },
    { label: '自动处理中', value: overview.metrics.processingOrders, note: '系统正在自动流转', filter: 'PROCESSING' },
    { label: '待执行充值', value: overview.metrics.awaitingConfirmationOrders, note: '正常模式由系统自动执行', filter: 'AWAITING_CONFIRMATION' },
    { label: '需要关注', value: overview.metrics.reviewingOrders, note: '失败、未知或对账订单', filter: 'REVIEW_REQUIRED' },
    { label: '三方对账异常', value: overview.metrics.reconciliationIssues, note: '订单、充值平台、卡片证据冲突', filter: 'RECONCILIATION_ISSUES' },
    { label: '等待 Session', value: overview.metrics.waitingForSession ?? 0, note: '客户可在原订单更换 Session', filter: 'WAITING_FOR_SESSION' },
    { label: '等待补卡', value: overview.metrics.waitingForCard ?? 0, note: '库存不足，等待运营补卡', filter: 'WAITING_FOR_CARD' },
    { label: '取消续费处理中', value: overview.metrics.cancellationPending ?? 0, note: '充值成功后的终态确认', filter: 'CANCELLATION_PENDING' },
    { label: '取消续费需复核', value: overview.metrics.cancellationReview ?? 0, note: '取消状态异常，需要人工处理', filter: 'CANCELLATION_REVIEW_REQUIRED' },
    { label: '资金结果未决', value: overview.operationalBacklog?.fundsRiskPending ?? 0,
      note: '禁止自动重试或切换充值路线', filter: 'RECONCILIATION_ISSUES' },
    { label: '卡余额充值待处理', value: overview.operationalBacklog?.cardFundingRiskPending ?? 0,
      note: overview.operationalBacklog?.cardFundingManualReview
        ? `${overview.operationalBacklog.cardFundingManualReview} 个需人工复核` : '只读对账或人工复核队列', filter: 'RECONCILIATION_ISSUES' },
    { label: '待验证新卡', value: overview.operationalBacklog?.cardIntakePending ?? 0,
      note: '本地接管队列；同步接管后更新，不会分配给订单', view: 'stock' },
    { label: '本地可分配卡', value: overview.cardStock?.available ?? 0,
      note: overview.cardStock?.low ? `已到低库存线：${overview.cardStock?.lowThreshold ?? 5}` : `低库存线：${overview.cardStock?.lowThreshold ?? 5}`, view: 'stock' },
    { label: '自动补卡用量', value: `${overview.operationalBacklog?.replenishmentUsedToday ?? 0}/${overview.operationalBacklog?.replenishmentDailyLimit ?? 5}`,
      note: `今日剩余 ${overview.operationalBacklog?.replenishmentRemainingToday ?? 0} 张`, view: 'stock' },
    { label: '对账案件未结', value: overview.operationalBacklog?.reconciliationCasesOpen ?? 0, note: '待分配或待解决', view: 'reconciliation' },
    { label: '卡片同步积压', value: overview.operationalBacklog?.cardSyncBacklog ?? 0, note: '只读交易同步任务', view: 'stock' },
    { label: '订单 Worker',
      value: overview.runtimeHealth?.workerHealthy && !(overview.runtimeHealth?.expiredTaskLeases || overview.runtimeHealth?.stalledProviderCalls) ? '正常' : '需检查',
      note: overview.runtimeHealth?.stalledProviderCalls
        ? `${overview.runtimeHealth.stalledProviderCalls} 个外部调用超时未决`
        : overview.runtimeHealth?.expiredTaskLeases
          ? `${overview.runtimeHealth.expiredTaskLeases} 个任务租约已过期`
          : overview.runtimeHealth?.workerHealthy ? 'Worker 心跳正常' : 'Worker 心跳超过 1 分钟',
      filter: 'RECONCILIATION_ISSUES' },
    { label: '已完成订单成功率', value: overview.metrics.successRate == null ? '—' : `${overview.metrics.successRate}%`, note: '不计未完成订单', filter: 'RECHARGE_SUCCESS' }
  ];
  elements.metrics.innerHTML = metrics.map((item, index) => `<button type="button" class="metric-card metric-${index + 1}" ${item.filter ? `data-order-filter="${item.filter}"` : `data-target-view="${item.view}"`}>
    <span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(item.note)}</small>
  </button>`).join('');
  const distribution = (rows, labels) => rows?.length
    ? rows.map((item) => `<div><span><strong>${escapeHtml(labels[item.status] || item.status)}</strong><small>${escapeHtml(item.status)}</small></span><em>${escapeHtml(item.count)}</em></div>`).join('')
    : '<p class="empty-state">暂无记录</p>';
  elements.overviewCdkRefundStatus.innerHTML = `<p class="mini-list-heading">CDK</p>${distribution(overview.cdkStatuses, { AVAILABLE: '未使用', REDEEMED: '已兑换', REVOKED: '已作废' })}<p class="mini-list-heading">退款观察</p>${distribution(overview.refundStatuses, { MONITORING: '观察中', DETECTED: '疑似退款', CONFIRMED: '已确认退款', WITHDRAWN: '已提取' })}`;
  const health = overview.providerHealth || {};
  const providerTone = health.purchaseEnabled === true ? 'status-green' : 'status-orange';
  elements.overviewProviderHealth.innerHTML = `<div><span><strong>HNSKJ 卡台</strong><small>只读同步 ${formatTime(health.syncedAt)}</small></span><em class="status-chip ${providerTone}"><i></i>${health.purchaseEnabled === true ? '允许开卡' : health.purchaseEnabled === false ? '禁止开卡' : '未知'}</em></div><div><span><strong>卡台余额</strong><small>详见卡片库存页</small></span><em>—</em></div>`;
  const maxCount = Math.max(1, ...overview.orderStatuses.map((item) => item.count));
  elements.statusList.innerHTML = overview.orderStatuses.length
    ? overview.orderStatuses.map((item) => `<button type="button" data-status="${escapeHtml(item.status)}">
      <span>${statusChip(item.status)}<strong>${item.count}</strong></span>
      <progress class="status-bar" max="${maxCount}" value="${item.count}" aria-label="${escapeHtml(item.status)} ${item.count} 单"></progress>
    </button>`).join('')
    : '<p class="empty-state">还没有订单数据</p>';
  elements.settingList.innerHTML = overview.settings.map((setting) => {
    const enabled = setting.value === 'true';
    if (setting.key === 'accept_new_orders') state.acceptingOrders = enabled;
    const control = setting.key === 'recharge_dispatch_mode'
      ? `<em class="switch-state ${setting.value === 'AUTOMATIC' ? 'is-on' : ''}">${setting.value === 'AUTOMATIC' ? '正常自动' : '仅灰度许可'}</em>`
      : setting.key === 'accept_new_orders'
      ? `<button class="${enabled ? 'danger-small' : 'primary-small'}" type="button" id="toggle-order-acceptance" data-enabled="${enabled}">${enabled ? '停止接单' : '开始接单'}</button>`
      : `<em class="switch-state ${enabled ? 'is-on' : ''}">${enabled ? '开启' : '关闭'}</em>`;
    return `<div><span><strong>${escapeHtml(SETTING_META[setting.key] || setting.key)}</strong><small>${setting.key === 'accept_new_orders' ? (enabled ? '新订单可以提交；规则通过后自动履约' : '已停止新订单；已有订单仍可继续处理和轮询') : `${formatTime(setting.updatedAt)} 更新`}</small></span>${control}</div>`;
  }).join('');
  const alerts = alertData.alerts || [];
  elements.alertsCard.hidden = alerts.length === 0;
  elements.alertsList.innerHTML = alerts.map((alert) => `<div><span><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.message)}</small></span><em>${formatTime(alert.createdAt)}</em></div>`).join('');
  elements.recentOrders.innerHTML = recent.orders.length
    ? recent.orders.map(orderRow).join('')
    : '<tr><td colspan="6" class="empty-cell">还没有订单</td></tr>';
  elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

async function loadOrders() {
  const query = { page: state.page, pageSize: state.pageSize };
  if (state.status) query.status = state.status;
  if (state.query) query.q = state.query;
  query.timeField = state.timeField;
  if (state.from) query.from = `${state.from}T00:00:00.000+08:00`;
  if (state.to) query.to = `${state.to}T23:59:59.999+08:00`;
  const payload = await api('/api/v1/admin/orders/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query)
  });
  state.total = payload.total;
  elements.ordersTable.innerHTML = payload.orders.length
    ? payload.orders.map((order) => orderRow(order, { selectable: true })).join('')
    : payload.cdkMatches?.length
      ? payload.cdkMatches.map((cdk) => `<tr><td></td><td><strong>CDK 精确匹配</strong><small>批次 ${escapeHtml(cdk.batchNo || '—')}</small></td><td>${escapeHtml(cdk.planType || '—')}</td><td>${escapeHtml(cdk.status)}</td><td>尚未关联卡片</td><td>${payload.deliveryTrackingEnabled && cdk.status !== 'REVOKED' ? `<button type="button" class="text-button" data-search-cdk-delivery="${escapeHtml(cdk.id)}" data-cdk-batch="${escapeHtml(cdk.batchNo || '')}">记录交付</button>` : '—'}</td><td>${formatTime(cdk.createdAt)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="empty-cell">没有符合条件的订单或 CDK</td></tr>';
  const totalPages = Math.max(1, Math.ceil(payload.total / state.pageSize));
  elements.orderCount.textContent = `${payload.total} 条订单`;
  elements.pageLabel.textContent = `第 ${state.page} / ${totalPages} 页`;
  elements.prevPage.disabled = state.page <= 1;
  elements.nextPage.disabled = state.page >= totalPages;
  elements.ordersTable.querySelectorAll('[data-search-cdk-delivery]').forEach((button) => {
    button.addEventListener('click', async () => {
      await recordCdkDelivery(button.dataset.searchCdkDelivery, button.dataset.cdkBatch);
      await loadOrders();
    });
  });
  updateSelectedOrders();
  elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

async function recordCdkDelivery(cdkId, batchNo) {
  const recipientReference = window.prompt('输入客户收件标识（邮箱、手机号或内部客户号；数据库只保存 HMAC）：')?.trim();
  if (!recipientReference) return false;
  const channel = window.prompt('输入交付渠道（例如 wechat、alipay、manual）：', 'manual')?.trim();
  if (!channel) return false;
  await sensitiveApi('/api/v1/admin/cdks/deliveries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cdkId, batchNo: batchNo || undefined,
      eventType: 'DELIVERED', channel, recipientReference })
  });
  showNotice('CDK 交付记录已保存。', 'success');
  return true;
}

function updateSelectedOrders() {
  const count = state.selectedOrders.size;
  elements.selectedOrderCount.textContent = `已选 ${count} 单`;
  elements.batchAuthorizeRecharge.disabled = count === 0;
  const pageBoxes = [...elements.ordersTable.querySelectorAll('[data-select-order]:not(:disabled)')];
  elements.selectPageOrders.disabled = pageBoxes.length === 0;
  elements.selectPageOrders.checked = pageBoxes.length > 0 && pageBoxes.every((box) => box.checked);
  elements.selectPageOrders.indeterminate = pageBoxes.some((box) => box.checked) && !elements.selectPageOrders.checked;
}

async function downloadOperationsCsv(dataset) {
  const response = await fetch(`/api/v1/admin/exports/${encodeURIComponent(dataset)}.csv?limit=10000`);
  if (response.status === 401) {
    window.location.replace('/admin/login');
    return;
  }
  if (!response.ok) throw new Error('export_failed');
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `${dataset}.csv`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  const rowCount = response.headers.get('x-export-row-count') || '0';
  const reachedLimit = response.headers.get('x-export-truncated') === 'true';
  showNotice(reachedLimit
    ? `已导出 ${rowCount} 行，达到单次 10000 行上限；如需继续请按游标分批导出。`
    : `已导出 ${rowCount} 行。`, reachedLimit ? 'warning' : 'success');
}

async function authorizeSelectedOrders() {
  const publicNos = [...state.selectedOrders];
  if (!publicNos.length) return;
  if (!window.confirm(`确认为以下 ${publicNos.length} 个特殊/灰度订单创建一次性充值许可？\n\n${publicNos.join('\n')}\n\n正常订单不需要此操作。许可 10 分钟内有效；每单只允许一个资金风险活动尝试。`)) return;
  elements.batchAuthorizeRecharge.disabled = true;
  try {
    const result = await sensitiveApi('/api/v1/admin/recharge-authorizations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicNos, ttlMinutes: 10, confirmation: `确认充值${publicNos.length}单` })
    });
    state.selectedOrders.clear();
    showNotice(`已创建灰度充值许可，共 ${result.itemCount ?? publicNos.length} 单。`, 'success');
    await loadOrders();
  } catch (error) {
    const messages = {
      order_not_eligible: '所选订单中有不可充值订单，请刷新并只选择付款前已就绪订单。',
      authorization_exists: '部分订单已有有效充值许可，请刷新后核对。',
      funds_fence_exists: '部分订单已有资金风险尝试，禁止重复授权。',
      recharge_confirmation_required: '批量确认信息不匹配，没有创建许可。'
    };
    showNotice(messages[error.message] || '批量充值许可未创建，请刷新订单状态后重试。');
    updateSelectedOrders();
  }
}

const RECONCILIATION_STATUS_LABELS = Object.freeze({ OPEN: '待处理', ASSIGNED: '已分配', RESOLVED: '已解决' });
const RECONCILIATION_SEVERITY_LABELS = Object.freeze({ critical: '严重', warning: '警告', info: '提示' });

async function loadReconciliationCases() {
  const params = new URLSearchParams({ page: state.reconciliationPage, pageSize: 50 });
  if (elements.reconciliationStatus.value) params.set('status', elements.reconciliationStatus.value);
  if (elements.reconciliationSeverity.value) params.set('severity', elements.reconciliationSeverity.value);
  const payload = await api(`/api/v1/admin/reconciliation-cases?${params}`);
  state.reconciliationTotal = payload.total;
  elements.reconciliationTable.innerHTML = payload.cases.length
    ? payload.cases.map((item) => `<tr data-case-id="${escapeHtml(item.id)}" data-public-no="${escapeHtml(item.publicNo || '')}">
      <td><strong>${escapeHtml(item.id)}</strong><small>${escapeHtml(item.dedupeKey)}</small></td>
      <td>${escapeHtml(item.publicNo || '—')}</td>
      <td><span class="cell-main">${escapeHtml(item.caseType)}</span><small>${escapeHtml(RECONCILIATION_SEVERITY_LABELS[item.severity] || item.severity)}</small></td>
      <td>${escapeHtml(RECONCILIATION_STATUS_LABELS[item.status] || item.status)}</td>
      <td>${escapeHtml(item.assignedTo || '未分配')}</td>
      <td>${formatTime(item.lastSeenAt)}</td>
      <td class="case-actions">${item.publicNo ? '<button class="text-button" type="button" data-open-case-order>查看订单</button>' : ''}${item.status !== 'RESOLVED' ? '<button class="text-button" type="button" data-assign-case>分配</button><button class="danger-small" type="button" data-resolve-case>解决</button>' : escapeHtml(item.resolutionNote || '已解决')}</td>
    </tr>`).join('')
    : '<tr><td colspan="7" class="empty-cell">没有符合条件的对账案例</td></tr>';
  const totalPages = Math.max(1, Math.ceil(payload.total / 50));
  elements.reconciliationCount.textContent = `${payload.total} 个案例`;
  elements.reconciliationPage.textContent = `第 ${state.reconciliationPage} / ${totalPages} 页`;
  elements.reconciliationPrev.disabled = state.reconciliationPage <= 1;
  elements.reconciliationNext.disabled = state.reconciliationPage >= totalPages;
  elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

async function assignReconciliationCase(caseId) {
  const assignedTo = window.prompt('输入负责人名称：', 'admin')?.trim();
  if (!assignedTo) return;
  await api(`/api/v1/admin/reconciliation-cases/${encodeURIComponent(caseId)}/assign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignedTo })
  });
  showNotice('案例已分配。', 'success');
  await loadReconciliationCases();
}

async function resolveReconciliationCase(caseId) {
  const resolutionNote = window.prompt('填写处理结论（必填）：')?.trim();
  if (!resolutionNote) return;
  await sensitiveApi(`/api/v1/admin/reconciliation-cases/${encodeURIComponent(caseId)}/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolutionNote })
  });
  showNotice('案例已解决并保留处理结论。', 'success');
  await loadReconciliationCases();
}

const BROWSER_RUN_LABELS = Object.freeze({
  READY: '待运行', RUNNING: '运行中', RECONCILE_ONLY: '仅可对账',
  HUMAN_REQUIRED: '等待人工', COMPLETED: '已完成', FAILED_SAFE: '安全失败'
});
const BROWSER_PAYMENT_LABELS = Object.freeze({
  NOT_STARTED: '未开始', PAYMENT_ARMED: '已许可', PAYMENT_SUBMITTING: '提交中',
  PAYMENT_UNKNOWN: '结果未知', PAYMENT_DECLINED: '已拒绝', PAYMENT_CONFIRMED: '已确认'
});
const BROWSER_CONTROL_LABELS = Object.freeze({
  AUTOMATION: '自动化', REQUESTED: '已请求人工', FROZEN: '自动化已冻结',
  TRANSFERRED: '已转交人工', RELEASED: '已释放待对账'
});

async function loadBrowserRuns() {
  const params = new URLSearchParams({ page: state.browserPage, pageSize: 50 });
  if (elements.browserPublicNo.value.trim()) params.set('publicNo', elements.browserPublicNo.value.trim());
  if (elements.browserStatus.value) params.set('status', elements.browserStatus.value);
  if (elements.browserPaymentState.value) params.set('paymentState', elements.browserPaymentState.value);
  if (elements.browserControlState.value) params.set('controlState', elements.browserControlState.value);
  const payload = await api(`/api/v1/admin/browser/runs?${params}`);
  state.browserTotal = payload.total;
  elements.browserRunsTable.innerHTML = payload.runs.length
    ? payload.runs.map((run) => `<tr data-browser-run="${escapeHtml(run.id)}" tabindex="0">
      <td><strong class="order-link">${escapeHtml(run.publicNo)}</strong><small>Run ${escapeHtml(run.id)} · #${run.runNo}</small></td>
      <td><span class="cell-main">${escapeHtml(BROWSER_RUN_LABELS[run.status] || run.status)}</span><small>${escapeHtml(run.lastCheckpointKind || '尚无检查点')} · ${run.lastCheckpointSequence}</small></td>
      <td><span class="cell-main">${escapeHtml(BROWSER_PAYMENT_LABELS[run.paymentState] || run.paymentState)}</span><small>${escapeHtml(run.attemptStatus)} / ${escapeHtml(run.fundsRiskState)}</small></td>
      <td><span class="cell-main">${escapeHtml(BROWSER_CONTROL_LABELS[run.controlState] || run.controlState)}</span><small>${escapeHtml(run.humanOwnerId || run.automationOwnerId || '未分配')}</small></td>
      <td><span class="cell-main">${escapeHtml(run.worker?.id || '未领取')}</span><small>${formatTime(run.worker?.leaseUntil)}</small></td>
      <td><span class="cell-main">${escapeHtml(run.activeArtifact?.status || '无活动 artifact')}</span><small>${escapeHtml(run.activeArtifact?.kind || '—')} · ${formatTime(run.activeArtifact?.expiresAt)}</small></td>
      <td>${formatTime(run.updatedAt)}</td>
    </tr>`).join('')
    : '<tr><td colspan="7" class="empty-cell">没有符合条件的 Browser run</td></tr>';
  const totalPages = Math.max(1, Math.ceil(payload.total / 50));
  elements.browserRunsCount.textContent = `${payload.total} 个 run`;
  elements.browserRunsPage.textContent = `第 ${state.browserPage} / ${totalPages} 页`;
  elements.browserRunsPrev.disabled = state.browserPage <= 1;
  elements.browserRunsNext.disabled = state.browserPage >= totalPages;
  elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

function browserControlButtons(run) {
  if (!['READY', 'RUNNING', 'HUMAN_REQUIRED'].includes(run.status)) return '';
  if (run.controlState === 'AUTOMATION') {
    return '<button class="text-button" type="button" data-browser-control="REQUEST">请求人工接管</button>';
  }
  if (run.controlState === 'REQUESTED') {
    return '<button class="danger-small" type="button" data-browser-control="FREEZE">冻结自动化</button><button class="text-button" type="button" data-browser-control="CANCEL">取消请求</button>';
  }
  if (run.controlState === 'FROZEN') {
    return '<button class="primary-small" type="button" data-browser-control="TRANSFER">转交人工</button><button class="danger-small" type="button" data-browser-control="MARK_PAYMENT_UNKNOWN">标记付款未知</button>';
  }
  if (run.controlState === 'TRANSFERRED') {
    return '<button class="primary-small" type="button" data-browser-control="RELEASE_SAFE">确认未付款并恢复</button><button class="danger-small" type="button" data-browser-control="MARK_PAYMENT_UNKNOWN">标记付款未知</button>';
  }
  return '';
}

async function controlBrowserRun(run, action) {
  const confirmations = {
    REQUEST: `请求人工接管 ${run.id}`,
    FREEZE: `冻结自动化 ${run.id}`,
    TRANSFER: `转交人工 ${run.id}`,
    RELEASE_SAFE: `确认无付款动作并恢复 ${run.id}`,
    MARK_PAYMENT_UNKNOWN: `确认付款结果未知 ${run.id}`,
    CANCEL: `取消接管 ${run.id}`
  };
  const warnings = {
    REQUEST: '请求人工接管同一个 Browser run？请求本身不会点击页面。',
    FREEZE: '冻结自动化页面操作？Worker 只允许维持租约和证据，不得继续输入。',
    TRANSFER: '确认自动化已经停手，并把同一个 run 转交给指定人工？',
    RELEASE_SAFE: '只有在确认人工没有点击、回车、提交表单、钱包或 3DS 最终确认时才能恢复自动化。',
    MARK_PAYMENT_UNKNOWN: '这会把 run、attempt 和订单锁为付款结果未知，只能对账，不能自动重付。',
    CANCEL: '只允许取消尚未冻结的接管请求。'
  };
  if (!window.confirm(warnings[action])) return;
  const input = {
    action,
    operationId: `admin-browser:${action.toLowerCase()}:${crypto.randomUUID()}`,
    confirmation: confirmations[action]
  };
  if (action === 'REQUEST') {
    input.reasonCode = window.prompt('输入接管原因代码：CAPTCHA、THREE_DS、PAGE_DRIFT、SESSION_REPAIR、OPERATOR_REVIEW 或 PAYMENT_RECONCILIATION', 'OPERATOR_REVIEW')?.trim().toUpperCase();
    if (!input.reasonCode) return;
  }
  if (action === 'TRANSFER') {
    input.humanOwnerId = window.prompt('输入人工操作者标识：', 'admin')?.trim();
    if (!input.humanOwnerId) return;
  }
  await sensitiveApi(`/api/v1/admin/browser/runs/${encodeURIComponent(run.id)}/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  });
  showNotice(action === 'MARK_PAYMENT_UNKNOWN'
    ? '已锁为付款结果未知；只能进入资金证据核对，禁止重付。'
    : 'Browser 控制权状态已更新。', 'success');
  await loadBrowserRuns();
  await openBrowserRun(run.id);
}

async function openBrowserRun(runId) {
  elements.detailKicker.textContent = 'Browser 运行详情';
  elements.detailTitle.textContent = runId;
  elements.detailContent.innerHTML = '<p class="loading-state">正在读取脱敏时间线…</p>';
  if (!elements.detail.open) elements.detail.showModal();
  try {
    const data = await api(`/api/v1/admin/browser/runs/${encodeURIComponent(runId)}`);
    const run = data.run;
    elements.detailContent.innerHTML = `
      <section class="detail-section"><div class="detail-section-heading"><h3>控制权</h3><span>${browserControlButtons(run)}</span></div>${renderKeyValues([
        ['订单查询码', run.publicNo], ['Run ID', run.id], ['Attempt ID', run.rechargeAttemptId],
        ['运行状态', BROWSER_RUN_LABELS[run.status] || run.status],
        ['付款状态', BROWSER_PAYMENT_LABELS[run.paymentState] || run.paymentState],
        ['资金风险', run.fundsRiskState], ['订单状态', run.orderStatus],
        ['控制权', BROWSER_CONTROL_LABELS[run.controlState] || run.controlState],
        ['自动化 owner', run.automationOwnerId], ['人工 owner', run.humanOwnerId],
        ['Worker', run.worker?.id], ['Worker 租约', formatTime(run.worker?.leaseUntil)],
        ['执行配置', `${run.profile.code} v${run.profile.version} / ${run.profile.runtimeId} / ${run.profile.adapterVersion}`],
        ['赛道', run.selectedLane], ['最后错误', run.lastErrorCode]
      ])}</section>
      <section class="detail-section"><h3>Checkout artifact 索引</h3><div class="mini-list">${data.artifacts.length ? data.artifacts.map((item) => `<div><span><strong>${escapeHtml(item.kind)} · ${escapeHtml(item.status)}</strong><small>ID ${escapeHtml(item.id)} · 创建 ${formatTime(item.createdAt)} · 到期 ${formatTime(item.expiresAt)} · 销毁 ${formatTime(item.destroyedAt)}</small></span></div>`).join('') : '<p class="empty-state">没有 artifact；authority 从不在后台返回</p>'}</div></section>
      <section class="detail-section"><h3>资源租约</h3><div class="mini-list">${data.leases.length ? data.leases.map((item) => `<div><span><strong>${escapeHtml(item.resourceType)} · ${escapeHtml(item.ownerId)}</strong><small>到期 ${formatTime(item.leaseUntil)} · 心跳 ${formatTime(item.heartbeatAt)} · 释放 ${formatTime(item.releasedAt)} ${escapeHtml(item.releaseReason || '')}</small></span></div>`).join('') : '<p class="empty-state">没有资源租约</p>'}</div></section>
      <section class="detail-section"><h3>检查点</h3><div class="timeline">${data.checkpoints.length ? data.checkpoints.map((item) => `<article><i></i><div><strong>#${item.sequence} ${escapeHtml(item.kind)} · ${escapeHtml(item.paymentRisk)}</strong><p>${escapeHtml(item.operationId || '无 operation')}</p><small>${formatTime(item.createdAt)} · 页面签名 ${escapeHtml(item.pageSignatureHash || '—')}</small></div></article>`).join('') : '<p class="empty-state">没有检查点</p>'}</div></section>
      <section class="detail-section"><h3>幂等操作</h3><div class="mini-list">${data.operations.length ? data.operations.map((item) => `<div><span><strong>${escapeHtml(item.type)} · ${escapeHtml(item.status)}</strong><small>${escapeHtml(item.operationId)} · ${escapeHtml(item.resultCode || '—')} · ${formatTime(item.completedAt)}</small></span></div>`).join('') : '<p class="empty-state">没有操作记录</p>'}</div></section>
      <section class="detail-section"><h3>人工接管历史</h3><div class="mini-list">${data.interventions.length ? data.interventions.map((item) => `<div><span><strong>${escapeHtml(item.status)} · ${escapeHtml(item.reasonCode)}</strong><small>请求 ${escapeHtml(item.requestedBy)} · 人工 ${escapeHtml(item.humanOwnerId || '—')} · ${formatTime(item.requestedAt)} · ${escapeHtml(item.resultCode || '')}</small></span></div>`).join('') : '<p class="empty-state">没有人工接管</p>'}</div></section>
      <section class="detail-section"><h3>对账案件</h3><div class="mini-list">${data.reconciliationCases.length ? data.reconciliationCases.map((item) => `<div><span><strong>${escapeHtml(item.caseType)} · ${escapeHtml(item.status)}</strong><small>${escapeHtml(item.severity)} · ${formatTime(item.detectedAt)}</small></span></div>`).join('') : '<p class="empty-state">没有对账案件</p>'}</div></section>`;
    elements.detailContent.querySelectorAll('[data-browser-control]').forEach((button) => {
      button.addEventListener('click', () => controlBrowserRun(run, button.dataset.browserControl)
        .catch((error) => showNotice(error.message === 'reconcile_only'
          ? '检测到付款提交证据，只能进入对账，不能恢复自动化。'
          : '控制权更新失败；原状态未改变。')));
    });
  } catch {
    elements.detailContent.innerHTML = '<p class="empty-state">Browser 运行详情读取失败，请稍后重试。</p>';
  }
}

function downloadCodes(batchNo, codes) {
  const blob = new Blob([`${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${batchNo}.txt`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCdkStatusCsv(payload) {
  const labels = { AVAILABLE: '未使用', REDEEMED: '已兑换', REVOKED: '已作废' };
  const rows = [['CDK', '状态', '订单查询码', '兑换时间', '作废时间', '作废原因']];
  for (const item of payload.codes) rows.push([
    item.code, labels[item.status] || item.status, item.orderPublicNo,
    item.redeemedAt, item.revokedAt, item.revokeReason
  ]);
  const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`],
    { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${payload.batchNo}-状态清单.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function clearGeneratedCdks() {
  window.clearTimeout(state.cdkClearTimer);
  state.cdkClearTimer = null;
  elements.generatedCdks.value = '';
  elements.cdkResult.hidden = true;
}

async function loadCdkBatches() {
  const sequence = ++state.cdkLoadSequence;
  const payload = await api('/api/v1/admin/cdks/batches?limit=50');
  if (sequence !== state.cdkLoadSequence) return;
  const deliveryCapability = document.querySelector('#cdk-delivery-capability');
  if (deliveryCapability) deliveryCapability.textContent = payload.deliveryTrackingEnabled
    ? '交付记录接口已启用；只有明确的“记录交付”动作才算交付。'
    : '当前尚未启用客户交付记录；下载、复制均不会被记为已交付。';
  elements.cdkBatches.innerHTML = payload.batches.length
    ? payload.batches.map((batch) => {
      const fullyRevoked = batch.revokedCount > 0 && batch.revokedCount === batch.totalCount;
      const partlyRevoked = batch.revokedCount > 0 && !fullyRevoked;
      const batchClass = fullyRevoked ? 'cdk-batch-revoked' : partlyRevoked ? 'cdk-batch-partial' : '';
      const badge = fullyRevoked ? '<b class="cdk-state-badge is-revoked">已全部作废</b>'
        : partlyRevoked ? '<b class="cdk-state-badge is-partial">部分作废</b>'
          : batch.availableCount > 0 ? '<b class="cdk-state-badge is-available">可使用</b>' : '<b class="cdk-state-badge">已用完</b>';
      return `<div class="${batchClass}" data-cdk-batch="${escapeHtml(batch.batchNo)}">
      <span><strong>${escapeHtml(batch.batchNo)} · ${escapeHtml(batch.planType.toUpperCase())} ${badge}</strong>
      <small>总数 ${batch.totalCount} · 未使用 ${batch.availableCount} · 已兑换 ${batch.redeemedCount} · 已作废 ${batch.revokedCount} · ${formatTime(batch.createdAt)}</small></span>
      <span class="cdk-batch-actions">
        ${batch.downloadable ? `<button type="button" class="text-button" data-download-batch data-redeemed-count="${batch.redeemedCount}" data-revoked-count="${batch.revokedCount}">下载原始 TXT</button><button type="button" class="text-button" data-status-report>下载状态清单 CSV</button>` : '<em>历史批次无明文恢复副本</em>'}
        ${batch.availableCount > 0 ? '<button type="button" class="danger-small" data-revoke-batch>作废未使用</button>' : ''}
      </span></div>`;
    }).join('')
    : '<p class="empty-state">还没有 CDK 批次</p>';
  elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

async function downloadStoredBatch(batchNo, button) {
  const redeemedCount = Number(button.dataset.redeemedCount || 0);
  const revokedCount = Number(button.dataset.revokedCount || 0);
  if ((redeemedCount || revokedCount) && !window.confirm(
    `批次 ${batchNo} 的原始文件包含 ${redeemedCount} 个已兑换、${revokedCount} 个已作废 CDK。\n\n仅用于核对和留档，禁止把文件中的码重新发放。确认继续导出？`
  )) return;
  button.disabled = true;
  try {
    const payload = await sensitiveApi(`/api/v1/admin/cdks/${encodeURIComponent(batchNo)}/download`, {
      method: 'POST'
    });
    downloadCodes(payload.batchNo, payload.codes);
    showNotice(`已导出批次 ${payload.batchNo}。`, 'success');
  } catch (error) {
    showNotice(cdkErrorMessage(error, '批次导出'));
  } finally { button.disabled = false; }
}

async function downloadStoredBatchStatus(batchNo, button) {
  button.disabled = true;
  try {
    const payload = await sensitiveApi(`/api/v1/admin/cdks/${encodeURIComponent(batchNo)}/status-report`, {
      method: 'POST'
    });
    downloadCdkStatusCsv(payload);
    showNotice(`已下载批次 ${payload.batchNo} 的逐码状态清单。`, 'success');
  } catch (error) {
    showNotice(cdkErrorMessage(error, '状态清单下载'));
  } finally { button.disabled = false; }
}

async function revokeStoredBatch(batchNo, button) {
  if (!window.confirm(`确认作废批次 ${batchNo} 中所有未使用 CDK？\n\n已兑换的订单不会受影响。`)) return;
  button.disabled = true;
  let result;
  try {
    result = await sensitiveApi(`/api/v1/admin/cdks/${encodeURIComponent(batchNo)}/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '后台批次作废' })
    });
  } catch (error) {
    showNotice(cdkErrorMessage(error, '批次作废'));
    button.disabled = false;
    return;
  }
  button.textContent = '已作废';
  showNotice(result.revokedCount
    ? `已作废 ${result.revokedCount} 个未使用 CDK。`
    : '该批次已没有未使用 CDK，无需重复作废。', 'success');
  try {
    await loadCdkBatches();
  } catch {
    showNotice(`已作废 ${result.revokedCount} 个未使用 CDK，但批次列表刷新失败；请点“刷新”核对。`, 'warning');
  }
}

const STOCK_JOB_LABELS = Object.freeze({
  PENDING: '等待执行', RUNNING: '执行中', COMPLETED: '已完成', REVIEW_REQUIRED: '需要核对'
});

function selectedStockCardType() {
  return state.stockProvider?.cardTypes?.find(
    (item) => String(item.id) === String(state.stockCardTypeId)
  ) || null;
}

function renderSelectedStockCardType({ resetInvalidAmount = false } = {}) {
  const selected = selectedStockCardType();
  elements.stockCardType.disabled = !selected;
  if (!selected) {
    elements.stockCardProfile.innerHTML = '<div><span>卡段名称</span><strong>没有可用卡段</strong></div><div><span>卡段 ID / BIN</span><strong>—</strong></div><div><span>允许金额</span><strong>—</strong></div><p class="provider-warning">禁止开卡</p>';
    updateStockEstimate();
    return;
  }
  elements.stockOpenAmount.min = selected.minimumAmount;
  elements.stockOpenAmount.max = selected.maximumAmount;
  const currentAmount = Number(elements.stockOpenAmount.value);
  if (resetInvalidAmount && (!Number.isInteger(currentAmount)
    || currentAmount < Number(selected.minimumAmount)
    || currentAmount > Number(selected.maximumAmount))) {
    const configuredAmount = Number(state.stockProvider?.defaultAmount);
    elements.stockOpenAmount.value = Number.isInteger(configuredAmount)
      && configuredAmount >= Number(selected.minimumAmount)
      && configuredAmount <= Number(selected.maximumAmount)
      ? String(configuredAmount) : String(selected.minimumAmount);
  }
  elements.stockCardProfile.innerHTML = `
    <div><span>卡段名称</span><strong>${escapeHtml(selected.name)}</strong></div>
    <div><span>卡段 ID / BIN</span><strong>${escapeHtml(selected.id)} / ${escapeHtml(selected.binPrefix)}</strong></div>
    <div><span>允许金额</span><strong>$${formatMoney(selected.minimumAmount)}–$${formatMoney(selected.maximumAmount)}</strong></div>
    <p>提交时服务器会再次校验卡段 ID 和实时规则</p>`;
  updateStockEstimate();
}

async function loadStock() {
  const payload = await api('/api/v1/admin/card-stock');
  const replenishment = await api('/api/v1/admin/card-stock/replenishment-settings');
  elements.replenishmentDailyLimit.value = replenishment.dailyLimit;
  elements.replenishmentUsage.textContent = `今日已使用：${replenishment.usedToday}，剩余：${replenishment.remainingToday}`;
  state.stockProvider = payload.provider || null;
  state.stockCatalog = payload.catalog || null;
  const totals = (payload.cardTypes || []).reduce((sum, item) => ({
    available: sum.available + item.available,
    provisioning: sum.provisioning + item.provisioning,
    assigned: sum.assigned + item.assigned,
    depleted: sum.depleted + item.depleted,
    held: sum.held + (item.held || 0)
  }), { available: 0, provisioning: 0, assigned: 0, depleted: 0, held: 0 });
  elements.stockSummary.innerHTML = [
    ['可分配', totals.available], ['已分配', totals.assigned], ['耗尽卡', totals.depleted], ['隔离卡', totals.held], ['核对中', totals.provisioning]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  elements.stockThreshold.value = payload.threshold;
  const provider = state.stockProvider;
  const catalog = state.stockCatalog || {};
  const cardTypes = provider?.cardTypes || [];
  const stillAvailable = cardTypes.some((item) => String(item.id) === String(state.stockCardTypeId));
  state.stockCardTypeId = stillAvailable
    ? state.stockCardTypeId : String(provider?.defaultCardTypeId || cardTypes[0]?.id || '');
  elements.stockCardType.innerHTML = cardTypes.length
    ? cardTypes.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ID ${escapeHtml(item.id)} · BIN ${escapeHtml(item.binPrefix)}</option>`).join('')
    : '<option value="">没有可用卡段</option>';
  elements.stockCardType.value = state.stockCardTypeId;
  const providerRemaining = Number(provider?.cardLimit?.remaining);
  if (Number.isInteger(providerRemaining) && providerRemaining > 0) {
    elements.stockOpenCount.max = String(providerRemaining);
  }
  elements.providerSummary.innerHTML = provider?.syncedAt ? `
    <div><span>卡台余额</span><strong>$${formatMoney(provider.accountBalance)}</strong></div>
    <div><span>卡台 active 卡</span><strong>${escapeHtml(catalog.providerActive ?? '—')}</strong></div>
    <div><span>卡台当前 active 卡数</span><strong>${escapeHtml(catalog.providerActive ?? '—')}</strong></div>
    <div><span>剩余开卡额度</span><strong>${escapeHtml(provider.cardLimit?.remaining ?? '—')}</strong></div>
    <small class="${provider.rulesFresh && provider.purchaseEnabled && catalog.fresh && !catalog.openingBlocked ? '' : 'provider-warning'}">
      ${provider.rulesFresh ? `规则更新于 ${formatTime(provider.syncedAt)}` : '卡台规则已过期，禁止开卡'}
      ${catalog.fresh ? ` · 卡片对账 ${formatTime(catalog.syncedAt)}` : ' · 卡片对账已过期'}
      ${catalog.openingBlocked ? ' · 对账未完成，禁止新开卡' : ''}
      ${provider.purchaseEnabled ? '' : ' · 卡台当前禁止开卡'}
    </small>` : '<p class="provider-warning">尚未取得卡台规则，禁止开卡。</p>';
  renderSelectedStockCardType({ resetInvalidAmount: true });
  elements.stockJobs.innerHTML = payload.jobs?.length
    ? payload.jobs.map((job) => `<div><span><strong>${escapeHtml(STOCK_JOB_LABELS[job.status] || job.status)} · ${job.openedCount}/${job.requestedCount} 张</strong><small>${escapeHtml(job.cardTypeName || `卡段 ${job.cardTypeId}`)} · $${formatMoney(job.amount)} / 张 · 预计总扣款 $${formatMoney(job.estimatedTotal)} · ${formatTime(job.createdAt)}${job.errorMessage ? ` · ${escapeHtml(job.errorMessage)}` : ''}</small></span><em>${escapeHtml(job.status)}</em></div>`).join('')
    : '<p class="empty-state">还没有后台补卡任务</p>';
  elements.stockCards.innerHTML = payload.cards?.length
    ? payload.cards.map((card) => `<div data-card="${escapeHtml(card.providerCardId)}" data-card-account="${escapeHtml(card.providerAccountId || '')}" role="button" tabindex="0"><span><strong>${escapeHtml(card.cardNumber || card.last4 || '卡号未就绪')}</strong><small>卡台 ID ${escapeHtml(card.providerCardId)} · 余额 $${formatMoney(card.currentBalance || '0')} · ${card.publicNo ? `订单 ${escapeHtml(card.publicNo)}` : '未分配'} · 交易 ${escapeHtml(card.transactionCount)} 笔 · ${formatTime(card.lastTransactionSyncedAt)}</small></span><em>${escapeHtml(RECONCILIATION_LABELS[card.reconciliationStatus] || card.reconciliationStatus)} / ${escapeHtml(INVENTORY_LABELS[card.inventoryStatus] || card.inventoryStatus)}</em></div>`).join('')
    : '<p class="empty-state">还没有后台卡片</p>';
  await loadCardIntake().catch(() => {
    elements.cardIntakeList.innerHTML = '<p class="empty-state">新卡接管状态读取失败，请稍后刷新。</p>';
  });
  elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

async function loadCardIntake() {
  const payload = await api('/api/v1/admin/card-intake?limit=100');
  elements.discoverNewCards.disabled = !payload.configured;
  const latest = payload.batches?.[0];
  const rows = payload.discoveries || [];
  const summary = latest
    ? `<div><span><strong>最近批次 · ${escapeHtml(CARD_INTAKE_BATCH_LABELS[latest.status] || latest.status)}</strong><small>发现 ${latest.discoveredCount} · 已接管 ${latest.acceptedCount} · 待人工核对 ${latest.reviewCount} · 失败 ${latest.failedCount}</small></span><span class="case-actions"><button class="text-button card-intake-validate" type="button" data-batch-id="${escapeHtml(latest.id)}" ${['VALIDATING','ACCEPTED','COMPLETED'].includes(latest.status) ? 'disabled' : ''}>重新验证</button><button class="primary-small card-intake-accept" type="button" data-batch-id="${escapeHtml(latest.id)}" ${latest.status !== 'VALIDATED' ? 'disabled' : ''}>接管已验证卡</button></span></div>`
    : '<p class="empty-state">还没有新卡接管批次</p>';
  const details = rows.map((item) => `<div data-intake-id="${escapeHtml(item.id || '')}"><span><strong>卡台 ID ${escapeHtml(item.externalCardId)}</strong><small>验证 ${item.validationAttempts} 次${item.failureCode ? ` · ${escapeHtml(item.failureCode)}` : ''}</small></span><em>${escapeHtml(CARD_INTAKE_LABELS[item.intakeStatus] || item.intakeStatus)}</em></div>`).join('');
  elements.cardIntakeList.innerHTML = `${!payload.configured ? '<p class="provider-warning">服务器尚未配置卡台只读凭据；暂时只能查看历史接管记录。</p>' : ''}<p class="intake-explanation">这里是本地新卡接管队列，不是卡台实时总库存。新卡需要两次稳定读取并完成接管后，才会进入可分配库存；数据在点击“同步并接管新卡”后更新。</p>${summary}${details}`;
}

elements.cardIntakeList?.addEventListener('click', async (event) => {
  const validate = event.target.closest('.card-intake-validate');
  const accept = event.target.closest('.card-intake-accept');
  const button = validate || accept;
  if (!button || button.disabled) return;
  const batchId = button.dataset.batchId;
  try {
    if (validate) {
      await api(`/api/v1/admin/card-intake/${encodeURIComponent(batchId)}/validate`, { method: 'POST' });
      showNotice('卡片批次已加入验证队列。', 'success');
    } else {
      const ids = [...elements.cardIntakeList.querySelectorAll('[data-intake-id]')].map((item) => item.dataset.intakeId);
      const confirmation = window.prompt(`请输入确认词：接管卡片 ${batchId}`)?.trim();
      if (!confirmation) return;
      await sensitiveApi(`/api/v1/admin/card-intake/${encodeURIComponent(batchId)}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discoveryIds: ids, confirmation })
      });
      showNotice('已接管通过验证的卡片。', 'success');
    }
    await loadStock();
  } catch {
    showNotice(validate ? '卡片验证任务提交失败。' : '卡片接管失败，没有改变库存。');
  }
});

async function requestCardSync(providerCardId = null, button = null) {
  if (button) button.disabled = true;
  try {
    const result = await api('/api/v1/admin/cards/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(providerCardId ? { providerCardId } : {})
    });
    showNotice(`已加入 ${result.queued} 张卡的只读同步队列${result.alreadyActive ? `，${result.alreadyActive} 张正在同步` : ''}。`);
    await loadStock();
    return result;
  } catch {
    showNotice('只读同步请求失败，未修改卡片数据。');
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

async function openCard(providerCardId, providerAccountId = '') {
  elements.detailKicker.textContent = '卡片详情';
  elements.detailTitle.textContent = providerCardId;
  elements.detailContent.innerHTML = '<p class="loading-state">正在读取卡片详情…</p>';
  if (!elements.detail.open) elements.detail.showModal();
  try {
    const accountQuery = providerAccountId
      ? `?providerAccountId=${encodeURIComponent(providerAccountId)}` : '';
    const data = await api(`/api/v1/admin/cards/${encodeURIComponent(providerCardId)}${accountQuery}`);
    const card = data.card;
    elements.detailContent.innerHTML = `
      <section class="detail-section"><div class="detail-section-heading"><h3>卡片状态</h3><button type="button" class="primary-small" id="sync-one-card">只读同步</button></div>${renderKeyValues([
        ['完整卡号', card.cardNumber || card.last4], ['卡台账户 ID', card.providerAccountId],
        ['卡台卡片 ID', card.providerCardId],
        ['卡段 ID', card.cardTypeId], ['卡片状态', card.status],
        ['库存状态', INVENTORY_LABELS[card.inventoryStatus] || card.inventoryStatus],
        ['开卡金额', `${formatMoney(card.fundedAmount)} ${card.currency || ''}`],
        ['当前余额', `${formatMoney(card.currentBalance)} ${card.currency || ''}`],
        ['退款观察', REFUND_LABELS[card.refundStatus] || card.refundStatus],
        ['卡片资料同步', formatTime(card.lastSyncedAt)],
        ['交易同步', formatTime(card.lastTransactionSyncedAt)]
      ])}</section>
      <section class="detail-section"><div class="detail-section-heading"><h3>关联订单</h3>${data.order ? '<button type="button" class="text-button" id="open-linked-order">打开订单</button>' : ''}</div>${data.order ? renderKeyValues([
        ['订单号', data.order.publicNo], ['订单状态', STATUS_META[data.order.status]?.[0] || data.order.status],
        ['客户邮箱', data.order.customerEmail]
      ]) : '<p class="empty-state">这张卡尚未分配给订单</p>'}</section>
      <section class="detail-section"><h3>历史订单关系</h3><div class="mini-list">${data.assignmentHistory?.length ? data.assignmentHistory.map((assignment) => `<div data-card-order="${escapeHtml(assignment.publicNo)}" role="button" tabindex="0"><span><strong>${escapeHtml(assignment.publicNo)} · ${escapeHtml(assignment.kind)}</strong><small>${escapeHtml(assignment.customerEmail || '—')} · 分配 ${formatTime(assignment.assignedAt)}${assignment.releasedAt ? ` · 释放 ${formatTime(assignment.releasedAt)}` : ' · 当前绑定'}</small></span><em>${escapeHtml(assignment.status)}</em></div>`).join('') : '<p class="empty-state">尚无分配历史</p>'}</div></section>
      <section class="detail-section"><h3>卡片交易</h3><div class="mini-list">${data.transactions.length ? data.transactions.map((transaction) => `<div><span><strong>${escapeHtml(transaction.type)} · ${escapeHtml(transaction.amount)} ${escapeHtml(transaction.currency)}</strong><small>${escapeHtml(transaction.merchantName || transaction.relatedTransactionId || transaction.providerTransactionId)} · ${escapeHtml(transaction.tradeTimeRaw || formatTime(transaction.firstSeenAt))}</small></span><em>${escapeHtml(transaction.status)}</em></div>`).join('') : '<p class="empty-state">暂无已同步交易</p>'}</div></section>
      <section class="detail-section"><h3>同步记录</h3><div class="mini-list">${data.syncJobs.length ? data.syncJobs.map((job) => `<div><span><strong>${escapeHtml(STOCK_JOB_LABELS[job.status] || job.status)}</strong><small>${job.attempts}/${job.maxAttempts} 次 · ${formatTime(job.createdAt)}${job.errorMessage ? ` · ${escapeHtml(job.errorMessage)}` : ''}</small></span><em>${escapeHtml(job.status)}</em></div>`).join('') : '<p class="empty-state">尚未手动同步</p>'}</div></section>
      <section class="detail-section"><h3>状态变化</h3><div class="mini-list">${data.events.length ? data.events.map((event) => `<div><span><strong>${escapeHtml(event.type)}</strong><small>${formatTime(event.createdAt)} · ${escapeHtml(event.source)}</small></span></div>`).join('') : '<p class="empty-state">暂无状态变化记录</p>'}</div></section>`;
    document.querySelector('#sync-one-card')?.addEventListener('click', async (event) => {
      if (await requestCardSync(providerCardId, event.currentTarget)) await openCard(providerCardId, card.providerAccountId);
    });
    document.querySelector('#open-linked-order')?.addEventListener('click', () => openOrder(data.order.publicNo));
    elements.detailContent.querySelectorAll('[data-card-order]').forEach((item) => {
      item.addEventListener('click', () => openOrder(item.dataset.cardOrder));
    });
  } catch {
    elements.detailContent.innerHTML = '<p class="empty-state">卡片详情读取失败，请稍后重试。</p>';
  }
}

function updateStockEstimate() {
  const count = Math.max(0, Number(elements.stockOpenCount.value) || 0);
  const amount = Math.max(0, Number(elements.stockOpenAmount.value) || 0);
  const provider = state.stockProvider;
  const catalog = state.stockCatalog || {};
  const selected = selectedStockCardType();
  const cardFee = Number(selected?.effectiveCardFee || 0);
  const feeRate = Number(selected?.effectiveFeeRate || 0);
  const rateFee = amount * feeRate;
  const principal = count * amount;
  const openingFees = count * cardFee;
  const rateFees = count * rateFee;
  const total = principal + openingFees + rateFees;
  const balance = Number(provider?.accountBalance);
  const minimumBalance = selected?.requireMinimumAccountBalance
    ? Number(selected.minimumAccountBalance || 0) : 0;
  const perCard = amount + cardFee + rateFee;
  const validAmount = Boolean(selected) && Number.isInteger(amount)
    && amount >= Number(selected.minimumAmount) && amount <= Number(selected.maximumAmount);
  let projected = balance;
  let affordable = 0;
  while (
    affordable < Number(provider?.cardLimit?.remaining || 0)
    && projected >= perCard && projected >= minimumBalance
  ) {
    affordable += 1;
    projected -= perCard;
  }
  const valid = Boolean(provider?.rulesFresh && provider?.purchaseEnabled && selected
    && catalog.fresh && !catalog.openingBlocked)
    && Number.isSafeInteger(count) && count >= 1
    && validAmount && count <= affordable;
  elements.stockCost.classList.toggle('stock-cost-warning', !valid);
  elements.stockCost.dataset.total = total.toFixed(2);
  elements.stockCost.innerHTML = `
    <strong>预计总扣款：$${total.toFixed(2)}</strong>
    <small>本金 $${principal.toFixed(2)} + 开卡费 $${openingFees.toFixed(2)} + 充值费 $${rateFees.toFixed(2)}</small>
    <small>${validAmount
      ? `当前余额 $${Number.isFinite(balance) ? balance.toFixed(2) : '—'} · 按实时规则最多安全开 ${affordable} 张`
      : `当前卡段金额必须为 $${formatMoney(selected?.minimumAmount)}–$${formatMoney(selected?.maximumAmount)} 的整数`}</small>`;
  elements.stockConfirmHint.textContent = `开${count}张`;
  const submit = elements.stockOpenForm.querySelector('button[type="submit"]');
  submit.disabled = !valid;
  document.querySelectorAll('.stock-preset').forEach((button) => {
    const selected = Number(button.dataset.count) === count;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function renderKeyValues(items) {
  return `<dl class="key-values">${items.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value ?? '—')}</dd></div>`).join('')}</dl>`;
}

async function requestTransactionSync(publicNo, button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = '提交中…';
  try {
    const result = await api(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}/sync-transactions`, { method: 'POST' });
    showNotice(result.queued ? '交易同步任务已加入队列。' : '该订单已有交易同步任务在处理。');
    button.textContent = result.queued ? '已加入队列' : '已有任务';
  } catch {
    showNotice('交易同步任务提交失败，请稍后重试。');
    button.disabled = false;
    button.textContent = original;
  }
}

async function issueCompensation(publicNo, button) {
  const confirmation = `补发 ${publicNo}`;
  if (!window.confirm(`确认给订单 ${publicNo} 补发 1 个同套餐 CDK？\n\n系统将再次核对：没有卡片、没有供应商调用、任务已明确失败。原订单会关闭，且只能补发一次。`)) return;
  button.disabled = true;
  button.textContent = '核对并补发中…';
  try {
    const result = await sensitiveApi(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}/compensation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation })
    });
    downloadCodes(`补发-${publicNo}`, [result.code]);
    await navigator.clipboard?.writeText(result.code).catch(() => {});
    showNotice(result.replayed ? '已取回此前补发的 CDK，并重新下载。' : '补发成功，CDK 已下载并尝试复制。');
    await openOrder(publicNo);
  } catch (error) {
    const messages = {
      compensation_side_effect_risk: '订单已经进入开卡或充值链路，禁止补发。',
      compensation_not_eligible: '订单尚未明确失败，禁止补发。',
      compensation_order_changed: '订单状态刚刚发生变化，请刷新后重新核对。'
    };
    showNotice(messages[error.message] || '补发被服务器拒绝，未生成新 CDK。');
    button.disabled = false;
    button.textContent = '补发 CDK';
  }
}

async function cancelOrder(publicNo, button) {
  if (!window.confirm(`确认取消订单 ${publicNo}？\n\n服务器会再次确认充值从未提交。订单关闭后，卡片将释放回可用库存。此操作不可撤销。`)) return;
  button.disabled = true;
  button.textContent = '核对并取消中…';
  try {
    const result = await sensitiveApi(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}/cancellation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: `取消订单 ${publicNo}` })
    });
    showNotice(result.replayed ? '该订单此前已经取消。' : '订单已取消，卡片已释放回库存。');
    await openOrder(publicNo);
    await loadOrders();
  } catch (error) {
    const messages = {
      order_cancellation_submission_risk: '充值可能已经开始，禁止取消。',
      order_cancellation_card_not_reusable: '卡片状态、余额或同步时间不符合释放条件。',
      order_cancellation_not_eligible: '该订单当前不能取消。',
      order_cancellation_order_changed: '订单或卡片状态刚刚发生变化，请刷新后重试。'
    };
    showNotice(messages[error.message] || '取消被服务器拒绝，订单和卡片均未改变。');
    button.disabled = false;
    button.textContent = '取消并释放卡片';
  }
}

async function setOrderAcceptance(button) {
  const currentlyEnabled = button.dataset.enabled === 'true';
  const enabled = !currentlyEnabled;
  const confirmation = enabled ? '开始接单' : '停止接单';
  const message = enabled
    ? '确认开始接收新订单？\n\n新订单会自动分配库存卡；派发和 Provider 写开关同时开启时，规则通过后会自动发起真实充值。'
    : '确认停止接收新订单？\n\n已创建的订单不会被取消，仍可继续处理。';
  if (!window.confirm(message)) return;
  button.disabled = true;
  try {
    await api('/api/v1/admin/operations/order-acceptance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, confirmation })
    });
    showNotice(enabled ? '已开始接收新订单。' : '已停止接收新订单，已有订单仍可继续处理。');
    await loadOverview();
  } catch {
    showNotice('接单状态修改失败，原状态未改变。');
    button.disabled = false;
  }
}

async function setRechargePermit(publicNo, action, button) {
  const arming = action === 'arm';
  const confirmation = `${arming ? '确认充值' : '撤销充值'} ${publicNo}`;
  const customer = button.dataset.customer || '—';
  const card = button.dataset.card || '—';
  const balance = button.dataset.balance || '—';
  const tokenExpiry = button.dataset.tokenExpiry || '—';
  const message = arming
    ? `确认允许订单 ${publicNo} 发起一次真实充值？\n\n客户：${customer}\n卡片：${card}\n当前余额：$${balance}\nAccess Token 有效至：${tokenExpiry}\n\n凭证 10 分钟内有效，一旦调用上游就不会自动第二次提交。该操作可能产生真实费用。`
    : `确认撤销订单 ${publicNo} 未使用的充值凭证？`;
  if (!window.confirm(message)) return;
  button.disabled = true;
  try {
    await sensitiveApi(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}/recharge-permit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, confirmation })
    });
    showNotice(arming ? '该订单已一次性放行，服务器将在数秒内执行。' : '未使用的充值凭证已撤销。');
    elements.detail.close();
    await openOrder(publicNo);
  } catch (error) {
    const messages = {
      order_not_eligible: '该订单当前不能放行充值。',
      create_already_attempted: '该订单已调用过充值接口，禁止再次提交。',
      another_permit_active: '另一个订单已在放行中，请等它完成后再试。',
      session_invalid: '客户 Session 已失效或即将过期，请让客户重新提交后再充值。',
      card_check_stale: '卡片状态超过 15 分钟未核对，等待自动同步后再试。',
      card_not_ready: '卡片已失效、余额不足或资料不完整，未发起充值。'
    };
    showNotice(messages[error.message] || '充值凭证操作失败，未发起新的充值请求。');
    button.disabled = false;
  }
}

async function openOrder(publicNo) {
  elements.detailKicker.textContent = '订单详情';
  elements.detailTitle.textContent = publicNo;
  elements.detailContent.innerHTML = '<p class="loading-state">正在读取订单详情…</p>';
  if (!elements.detail.open) elements.detail.showModal();
  try {
    const data = await api(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}`);
    const order = data.order;
    const paymentGate = data.paymentGate || {};
    const permitStatus = paymentGate.permitStatus || 'LOCKED';
    const canArmRecharge = paymentGate.prepaymentReady
      && paymentGate.submissionTaskStatus === 'PENDING'
      && Number(paymentGate.submissionAttempts || 0) === 0
      && paymentGate.sessionValid
      && paymentGate.cardReady
      && paymentGate.cardCheckFresh
      && permitStatus !== 'ARMED';
    const permitButton = permitStatus === 'ARMED'
      ? '<button type="button" class="danger-small" id="revoke-recharge-permit">撤销灰度许可</button>'
      : canArmRecharge ? `<button type="button" class="danger-small" id="arm-recharge-permit"
          data-customer="${escapeHtml(order.customerEmail || order.chatgptAccountId || '—')}"
          data-card="${escapeHtml(data.card?.cardNumber || data.card?.last4 || '—')}"
          data-balance="${formatMoney(data.card?.currentBalance)}"
          data-token-expiry="${escapeHtml(formatTime(paymentGate.accessTokenExpiresAt))}">灰度单笔许可</button>` : '';
    const compensation = data.compensation || {};
    const compensationButton = compensation.eligible || compensation.alreadyIssued
      ? `<button type="button" class="danger-small" id="issue-compensation">${compensation.alreadyIssued ? '重新下载补发 CDK' : '补发 CDK'}</button>`
      : '';
    const compensationLabels = {
      COMPENSATION_ELIGIBLE: '符合条件：无卡片、无供应商调用、任务已明确失败',
      COMPENSATION_ALREADY_ISSUED: `已经补发 · ${formatTime(compensation.issuedAt)} · 新 CDK ${compensation.replacementStatus || '—'}`,
      COMPENSATION_ORDER_STILL_ACTIVE: '订单仍在处理，禁止补发',
      COMPENSATION_NOT_TERMINALLY_FAILED: '订单未明确失败，禁止补发',
      COMPENSATION_SIDE_EFFECT_RISK: '已进入开卡或充值链路，禁止补发'
    };
    const cancellation = data.cancellation || {};
    const cancellationButton = cancellation.eligible
      ? '<button type="button" class="danger-small" id="cancel-order">取消并释放卡片</button>' : '';
    const cancellationLabels = {
      ORDER_CANCELLATION_ELIGIBLE: '可以安全取消：充值未提交，卡片将解除绑定并进入隔离区，不会自动复用',
      ORDER_CANCELLATION_ALREADY_COMPLETED: '订单已经取消，卡片已进入隔离区',
      ORDER_CANCELLATION_REVIEW_REQUIRED: '订单或卡片关系不完整，需要人工核对',
      ORDER_CANCELLATION_SUBMISSION_RISK: '充值可能已经开始，禁止取消',
      ORDER_CANCELLATION_NOT_ELIGIBLE: '当前订单状态不能取消'
    };
    const reconciliation = data.reconciliation || {};
    const trace = data.traceability || {};
    const cost = trace.fulfillmentCost || {};
    const moneyList = (items) => items?.length
      ? items.map((item) => `${item.amount} ${item.currency}`).join('；') : '没有已记录金额';
    elements.detailContent.innerHTML = `
      <section class="detail-section"><div class="detail-section-heading"><h3>自动履约与资金栅栏</h3>${permitButton}</div>${renderKeyValues([
        ['付款前检查', paymentGate.prepaymentReady ? '已就绪' : '未就绪'],
        ['正常执行', paymentGate.prepaymentReady ? '规则通过后由系统自动执行' : '等待付款前准备'],
        ['灰度许可', paymentGate.permitStatus || 'LOCKED'],
        ['直充任务', paymentGate.submissionTaskStatus],
        ['直充执行次数', paymentGate.submissionAttempts ?? 0],
        ['灰度许可过期时间', formatTime(paymentGate.permitExpiresAt)],
        ['Session 检查', paymentGate.sessionValid ? '有效' : `不可用（${paymentGate.sessionCode || '未知原因'}）`],
        ['Session 过期时间', formatTime(paymentGate.sessionExpiresAt)],
        ['Access Token 过期时间', formatTime(paymentGate.accessTokenExpiresAt)],
        ['卡片资格', paymentGate.cardReady ? '状态、余额和资料均正常' : '不可用'],
        ['卡片核对', paymentGate.cardCheckFresh ? '15 分钟内已更新' : '数据已过期']
      ])}</section>
      <section class="detail-section"><div class="detail-section-heading"><h3>取消未充值订单</h3>${cancellationButton}</div><p class="empty-state">${escapeHtml(cancellationLabels[cancellation.code] || '当前不可取消')}</p></section>
      <section class="detail-section"><div class="detail-section-heading"><h3>失败补偿</h3>${compensationButton}</div><p class="empty-state">${escapeHtml(compensationLabels[compensation.code] || '当前不可补发')}</p></section>
      <section class="detail-section"><h3>三方对账</h3>${renderKeyValues([
        ['对账结果', ORDER_RECONCILIATION_LABELS[reconciliation.status] || reconciliation.status],
        ['判定依据', ORDER_RECONCILIATION_CODES[reconciliation.code] || reconciliation.code],
        ['充值平台订单号', order.rechargeOrderNo],
        ['充值平台确认金额', order.actualPaymentAmount ? `${order.actualPaymentAmount} ${order.actualPaymentCurrency || ''}` : null],
        ['卡片交易同步', formatTime(data.card?.lastTransactionSyncedAt)]
      ])}</section>
      <section class="detail-section"><div class="detail-status">${statusChip(order.status)}<span>${formatTime(order.updatedAt)}</span></div>${renderKeyValues([
        ['客户邮箱', order.customerEmail], ['ChatGPT 账号 ID', order.chatgptAccountId],
        ['直充订单号', order.rechargeOrderNo], ['卡段 ID', order.cardTypeId],
        ['开卡金额', order.openCardAmount], ['最低所需卡余额', order.minimumRequiredCardBalance],
        ['实际支付', order.actualPaymentAmount ? `${order.actualPaymentAmount} ${order.actualPaymentCurrency || ''}` : null],
        ['自动续费', order.subscriptionCancelled === 1 ? '已取消' : order.cancellationReviewRequired ? '需要人工处理' : order.subscriptionCancelled === 0 ? '等待确认' : '未开始'],
        ['续费复查时间', formatTime(order.cancellationCheckedAt)],
        ['客户操作原因', order.customerActionCode],
        ['Session 更换次数', `${order.sessionReplacementCount || 0} / 3`],
        ['Session 修复窗口开始', formatTime(order.sessionRepairStartedAt)],
        ['Session 修复截止', formatTime(order.sessionRepairExpiresAt)],
        ['最近更换 Session', formatTime(order.lastSessionReplacedAt)],
        ['失败代码', order.failureCode], ['失败原因', order.failureReason]
      ])}</section>
      <section class="detail-section"><div class="detail-section-heading"><h3>卡片与退款</h3>${data.card ? '<button type="button" class="primary-small" id="sync-transactions">同步交易</button>' : ''}</div>${data.card ? renderKeyValues([
        ['卡台卡片 ID', data.card.providerCardId], ['完整卡号', data.card.cardNumber || data.card.last4],
        ['卡片状态', INVENTORY_LABELS[data.card.status] || data.card.status], ['开卡金额', `${formatMoney(data.card.fundedAmount)} ${data.card.currency || ''}`],
        ['当前余额', `${formatMoney(data.card.currentBalance)} ${data.card.currency || ''}`], ['退款观察', REFUND_LABELS[data.card.refundStatus] || data.card.refundStatus],
        ['最后同步', formatTime(data.card.lastSyncedAt)]
      ]) : '<p class="empty-state">尚未绑定卡片</p>'}</section>
      <section class="detail-section"><h3>CDK、补发关系与客户付款</h3><div class="mini-list">${trace.cdks?.length ? trace.cdks.map((cdk) => `<div><span><strong>${escapeHtml(cdk.relationship === 'REPLACEMENT' ? '补发 CDK' : '原始 CDK')} · ${escapeHtml(cdk.status)}</strong><small>批次 ${escapeHtml(cdk.batchId || '—')} · 创建 ${formatTime(cdk.createdAt)} · 兑换 ${formatTime(cdk.redeemedAt)}${cdk.redeemedOrderPublicNo ? ` · 订单 ${escapeHtml(cdk.redeemedOrderPublicNo)}` : ''}</small></span>${cdk.redeemedOrderPublicNo && cdk.redeemedOrderPublicNo !== publicNo ? `<button type="button" class="text-button" data-related-order="${escapeHtml(cdk.redeemedOrderPublicNo)}">打开后续订单</button>` : trace.deliveryTrackingEnabled && cdk.status !== 'REVOKED' ? `<button type="button" class="text-button" data-record-cdk-delivery="${escapeHtml(cdk.id)}" data-cdk-batch="${escapeHtml(cdk.batchId || '')}">记录交付</button>` : ''}</div>`).join('') : '<p class="empty-state">没有 CDK 关系记录</p>'}${trace.orderRelationships?.length ? trace.orderRelationships.map((relation) => `<div><span><strong>补发链路</strong><small>原订单 ${escapeHtml(relation.originalPublicNo)} · 后续订单 ${escapeHtml(relation.replacementPublicNo || '尚未兑换')} · ${formatTime(relation.createdAt)}</small></span>${relation.originalPublicNo !== publicNo ? `<button type="button" class="text-button" data-related-order="${escapeHtml(relation.originalPublicNo)}">打开原订单</button>` : relation.replacementPublicNo ? `<button type="button" class="text-button" data-related-order="${escapeHtml(relation.replacementPublicNo)}">打开后续订单</button>` : ''}</div>`).join('') : ''}${trace.customerPayments?.length ? trace.customerPayments.map((payment) => `<div><span><strong>客户付款 · ${escapeHtml(payment.status)} · ${escapeHtml(payment.amount || '金额未记录')} ${escapeHtml(payment.currency || '')}</strong><small>${escapeHtml(payment.channel)} · ${escapeHtml(payment.externalReference || '无外部参考号')} · ${payment.paidAt ? `实际付款 ${formatTime(payment.paidAt)}` : `确认记录 ${formatTime(payment.createdAt)}（实际付款时间未补录）`}</small></span>${payment.amount == null ? '<button type="button" class="text-button" data-complete-customer-payment>补录付款</button>' : ''}</div>`).join('') : '<p class="empty-state">客户在系统外付款；当前尚未补录付款金额</p>'}${trace.deliveries?.length ? trace.deliveries.map((delivery) => `<div><span><strong>CDK ${escapeHtml(delivery.type)} · ${escapeHtml(delivery.channel || '未注明渠道')}</strong><small>收件人仅保存隐私哈希 · ${formatTime(delivery.createdAt)}</small></span></div>`).join('') : ''}</div></section>
      <section class="detail-section"><h3>卡片分配历史</h3><div class="mini-list">${trace.cardAssignments?.length ? trace.cardAssignments.map((assignment) => `<div data-trace-card="${escapeHtml(assignment.providerCardId)}" data-trace-card-account="${escapeHtml(assignment.providerAccountId || '')}" role="button" tabindex="0"><span><strong>${escapeHtml(assignment.cardNumber || assignment.last4 || assignment.providerCardId)} · ${escapeHtml(assignment.kind)}</strong><small>分配 ${formatTime(assignment.assignedAt)}${assignment.releasedAt ? ` · 释放 ${formatTime(assignment.releasedAt)}` : ' · 当前绑定'} · ${escapeHtml(assignment.assignmentReason || assignment.releaseReason || '')}</small></span><em>${escapeHtml(assignment.status)}</em></div>`).join('') : '<p class="empty-state">尚无卡片分配历史</p>'}</div></section>
      <section class="detail-section"><h3>Session 更换记录</h3><div class="mini-list">${trace.sessionReplacements?.length ? trace.sessionReplacements.map((replacement) => `<div><span><strong>第 ${replacement.replacementNo} 次更换 · ${escapeHtml(replacement.reasonCode || '客户重新提交')}</strong><small>${escapeHtml(replacement.previousCustomerEmail || replacement.previousChatgptAccountId || '原账号未识别')} → ${escapeHtml(replacement.newCustomerEmail || replacement.newChatgptAccountId || '新账号未识别')} · ${formatTime(replacement.createdAt)}</small></span></div>`).join('') : '<p class="empty-state">尚无 Session 更换记录</p>'}</div></section>
      <section class="detail-section"><h3>客户收款与履约成本（原币种）</h3>${renderKeyValues([
        ['客户付款', moneyList(cost.customerPayments)],
        ['卡片开卡/入金', moneyList(cost.cardFundedAmount)],
        ['充值平台确认支付', moneyList(cost.providerConfirmedPayment)],
        ['卡片成功消费', moneyList(cost.successfulCardPurchases)],
        ['卡片交易手续费', moneyList(cost.cardTransactionFees)]
      ])}<p class="empty-state">${escapeHtml(cost.note || '不同币种不自动换算。')}</p></section>
      <section class="detail-section"><div class="detail-section-heading"><h3>运营标签与备注</h3><span><button type="button" class="text-button" id="add-order-tag">添加标签</button><button type="button" class="text-button" id="add-order-note">添加备注</button></span></div><div class="mini-list">${trace.tags?.length ? trace.tags.map((item) => `<div><span><strong>${escapeHtml(item.tag)}</strong><small>${formatTime(item.createdAt)} · ${escapeHtml(item.createdBy)}</small></span></div>`).join('') : '<p class="empty-state">暂无标签</p>'}${trace.notes?.length ? trace.notes.map((note) => `<div><span><strong>${escapeHtml(note.text)}</strong><small>${formatTime(note.createdAt)} · ${escapeHtml(note.createdBy)}</small></span></div>`).join('') : '<p class="empty-state">暂无备注</p>'}</div></section>
      <section class="detail-section"><h3>卡片交易</h3><div class="mini-list">${data.transactions?.length ? data.transactions.map((transaction) => `<div><span><strong>${escapeHtml(transaction.type)} · ${escapeHtml(transaction.amount)} ${escapeHtml(transaction.currency)}</strong><small>${escapeHtml(transaction.merchantName || transaction.relatedTransactionId || transaction.providerTransactionId)} · ${escapeHtml(transaction.tradeTimeRaw || formatTime(transaction.firstSeenAt))}</small></span><em>${escapeHtml(transaction.status)}</em></div>`).join('') : '<p class="empty-state">暂无已同步交易</p>'}</div></section>
      <section class="detail-section"><h3>订单时间线</h3><div class="timeline">${data.events.length ? data.events.map((event) => `<article><i></i><div><strong>${escapeHtml(STATUS_META[event.toStatus]?.[0] || event.toStatus)}</strong><p>${escapeHtml(event.reason)}</p><small>${formatTime(event.createdAt)} · ${escapeHtml(event.actorType)}</small></div></article>`).join('') : '<p class="empty-state">暂无事件</p>'}</div></section>
      <section class="detail-section"><h3>后台任务</h3><div class="mini-list">${data.tasks.length ? data.tasks.map((task) => `<div><span><strong>${escapeHtml(TASK_LABELS[task.type] || task.type)}</strong><small>${task.attempts}/${task.maxAttempts} 次尝试</small></span><em>${escapeHtml(TASK_STATUS_LABELS[task.status] || task.status)}</em></div>`).join('') : '<p class="empty-state">暂无任务</p>'}</div></section>`;
    document.querySelector('#sync-transactions')?.addEventListener('click', (event) => requestTransactionSync(publicNo, event.currentTarget));
    document.querySelector('#arm-recharge-permit')?.addEventListener('click', (event) => setRechargePermit(publicNo, 'arm', event.currentTarget));
    document.querySelector('#revoke-recharge-permit')?.addEventListener('click', (event) => setRechargePermit(publicNo, 'revoke', event.currentTarget));
    document.querySelector('#issue-compensation')?.addEventListener('click', (event) => issueCompensation(publicNo, event.currentTarget));
    document.querySelector('#cancel-order')?.addEventListener('click', (event) => cancelOrder(publicNo, event.currentTarget));
    document.querySelector('#add-order-tag')?.addEventListener('click', async () => {
      const tag = window.prompt('输入订单标签（最多 64 个字符）：')?.trim();
      if (!tag) return;
      await api(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}/tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag })
      });
      showNotice('标签已保存。', 'success');
      await openOrder(publicNo);
    });
    document.querySelector('#add-order-note')?.addEventListener('click', async () => {
      const note = window.prompt('输入运营备注（最多 2000 个字符）：')?.trim();
      if (!note) return;
      await api(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note })
      });
      showNotice('备注已追加。', 'success');
      await openOrder(publicNo);
    });
    elements.detailContent.querySelectorAll('[data-trace-card]').forEach((item) => {
      item.addEventListener('click', () => openCard(item.dataset.traceCard, item.dataset.traceCardAccount));
    });
    elements.detailContent.querySelectorAll('[data-record-cdk-delivery]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (await recordCdkDelivery(button.dataset.recordCdkDelivery, button.dataset.cdkBatch)) {
          await openOrder(publicNo);
        }
      });
    });
    elements.detailContent.querySelectorAll('[data-related-order]').forEach((button) => {
      button.addEventListener('click', () => openOrder(button.dataset.relatedOrder));
    });
    elements.detailContent.querySelector('[data-complete-customer-payment]')?.addEventListener('click', async () => {
      const amount = window.prompt('输入客户实际付款金额：')?.trim();
      if (!amount) return;
      const currency = window.prompt('输入付款币种（例如 CNY）：', 'CNY')?.trim();
      if (!currency) return;
      const channel = window.prompt('输入付款渠道（例如 ALIPAY、WECHAT）：', 'ALIPAY')?.trim();
      if (!channel) return;
      const paidAt = window.prompt('输入实际付款时间（必须包含时区，例如 2026-08-21T12:30:00+08:00）：')?.trim();
      if (!paidAt) return;
      const externalReference = window.prompt('输入外部交易参考号（可留空；只保存 HMAC 和尾号）：', '')?.trim() || '';
      await sensitiveApi(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}/customer-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency, channel, paidAt, externalReference })
      });
      showNotice('客户付款详情已补录。', 'success');
      await openOrder(publicNo);
    });
  } catch {
    elements.detailContent.innerHTML = '<p class="empty-state">订单详情读取失败，请稍后重试。</p>';
  }
}

async function switchView(view, { status = '' } = {}) {
  if (state.view === 'cdks' && view !== 'cdks') clearGeneratedCdks();
  if (state.view === 'orders' && view !== 'orders') state.selectedOrders.clear();
  state.view = view === 'exceptions' ? 'orders' : view;
  state.status = view === 'exceptions' ? 'REVIEW_REQUIRED' : status;
  state.page = 1;
  elements.navItems.forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
  elements.views.forEach((panel) => { panel.hidden = panel.id !== `${state.view}-view`; });
  if (view === 'overview') {
    elements.viewKicker.textContent = '运营概览';
    elements.viewTitle.textContent = '今天的运行情况';
    await loadOverview();
  } else if (view === 'cdks') {
    elements.viewKicker.textContent = '卡密管理';
    elements.viewTitle.textContent = '生成客户兑换码';
    await loadCdkBatches();
  } else if (view === 'stock') {
    elements.viewKicker.textContent = '资金与库存';
    elements.viewTitle.textContent = '卡片库存与人工补卡';
    await loadStock();
  } else if (view === 'reconciliation') {
    elements.viewKicker.textContent = '运营核对';
    elements.viewTitle.textContent = '对账案例队列';
    await loadReconciliationCases();
  } else if (view === 'card-funding') {
    elements.viewKicker.textContent = '资金安全';
    elements.viewTitle.textContent = '卡余额充值队列';
    await loadCardFundingAttempts();
  } else if (view === 'provider-routes') {
    elements.viewKicker.textContent = '容灾与切换';
    elements.viewTitle.textContent = 'Plus 卡台路线';
    await loadProviderRoutes();
  } else if (view === 'browser') {
    elements.viewKicker.textContent = 'Browser 控制面';
    elements.viewTitle.textContent = '运行、租约与人工接管';
    await loadBrowserRuns();
  } else {
    elements.viewKicker.textContent = view === 'exceptions' ? '人工处理' : '订单中心';
    elements.viewTitle.textContent = view === 'exceptions' ? '需要关注的订单' : '全部订单';
    elements.statusFilter.value = state.status;
    await loadOrders();
  }
}

function routeHealth(route) {
  const retrying = route.retryAfterUntil && Date.parse(route.retryAfterUntil) > Date.now();
  if (!route.readEnabled) return ['只读检查关闭', 'status-red'];
  if (route.circuitState !== 'CLOSED') return [`熔断 ${route.circuitState || '未知'}`, 'status-red'];
  if (retrying) return [`重试窗口至 ${formatTime(route.retryAfterUntil)}`, 'status-orange'];
  return ['只读检查正常', 'status-green'];
}

async function loadProviderRoutes() {
  const payload = await api('/api/v1/admin/provider-routes');
  const routes = Array.isArray(payload.routes) ? payload.routes : [];
  elements.providerRoutesTable.innerHTML = routes.length ? routes.map((route) => {
    const [health, tone] = routeHealth(route);
    const active = route.acceptsNewOrders && !route.retiredAt;
    const canSwitch = !active && route.readEnabled && route.circuitState === 'CLOSED'
      && !(route.retryAfterUntil && Date.parse(route.retryAfterUntil) > Date.now());
    return `<tr>
      <td><strong class="cell-main">${escapeHtml(route.routeCode || '—')}</strong><small>版本 ${escapeHtml(route.routeVersion)}</small></td>
      <td>${active ? '<span class="status-chip status-green"><i></i>当前接单</span>' : '<span class="status-chip status-gray"><i></i>备用</span>'}</td>
      <td><span class="cell-main">${escapeHtml(route.accountCode || '未绑定')}</span><small>账户 ID ${escapeHtml(route.cardProviderAccountId || '—')}</small></td>
      <td>${route.readEnabled ? '开启' : '关闭'} / ${route.writeEnabled ? '开启' : '关闭'}</td>
      <td><span class="status-chip ${tone}"><i></i>${escapeHtml(health)}</span></td>
      <td>${active ? '<small>新订单使用中</small>' : `<button class="primary-small route-switch-button" type="button" data-route-id="${escapeHtml(route.id)}" data-route-label="${escapeHtml(route.routeCode)}:${escapeHtml(route.routeVersion)}" ${canSwitch ? '' : 'disabled'}>切换为当前</button>`}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-state">暂无 Plus 卡台路线配置</td></tr>';
}

async function loadCardFundingAttempts() {
  const params = new URLSearchParams({ page: state.cardFundingPage, pageSize: 20 });
  if (elements.cardFundingStatus.value) params.set('status', elements.cardFundingStatus.value);
  const payload = await api(`/api/v1/admin/card-funding-attempts?${params}`);
  state.cardFundingTotal = payload.total;
  elements.cardFundingTable.innerHTML = payload.attempts.length ? payload.attempts.map((item) => `<tr>
    <td><small>${escapeHtml(item.id)}</small><br>${escapeHtml(item.fundsRiskState)}</td>
    <td>${escapeHtml(item.last4 || item.providerCardId || '—')}</td>
    <td>${escapeHtml(item.amount)} ${escapeHtml(item.currency)}</td>
    <td>${escapeHtml(item.status)}${item.fundsRiskState === 'UNKNOWN' ? `<div class="case-actions"><button class="text-button card-funding-resolve" type="button" data-attempt-id="${escapeHtml(item.id)}" data-action="CONFIRM_SETTLED">确认已扣款</button><button class="text-button card-funding-resolve" type="button" data-attempt-id="${escapeHtml(item.id)}" data-action="CONFIRM_NOT_CHARGED">确认未扣款</button></div>` : ''}</td>
    <td>${escapeHtml(item.providerCallOutcome || '—')}${item.providerBusinessCode ? `<small>${escapeHtml(item.providerBusinessCode)}</small>` : ''}</td>
    <td>${escapeHtml(item.publicNo || '—')}</td>
    <td>${formatTime(item.updatedAt || item.createdAt)}</td>
  </tr>`).join('') : '<tr><td colspan="7" class="empty-state">暂无记录</td></tr>';
  const pages = Math.max(1, Math.ceil(payload.total / 20));
  elements.cardFundingCount.textContent = `${payload.total} 条记录`;
  elements.cardFundingPage.textContent = `第 ${state.cardFundingPage} / ${pages} 页`;
  elements.cardFundingPrev.disabled = state.cardFundingPage <= 1;
  elements.cardFundingNext.disabled = state.cardFundingPage >= pages;
}

elements.cardFundingTable?.addEventListener('click', async (event) => {
  const button = event.target.closest('.card-funding-resolve');
  if (!button) return;
  const attemptId = button.dataset.attemptId;
  const confirmation = window.prompt(`请输入确认词：确认卡充值对账 ${attemptId}`)?.trim();
  if (!confirmation) return;
  const note = window.prompt('请输入对账依据（至少 10 个字符；只记录结论，不会自动重充）：')?.trim();
  if (!note) return;
  button.disabled = true;
  try {
    await sensitiveApi(`/api/v1/admin/card-funding-attempts/${encodeURIComponent(attemptId)}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: button.dataset.action, confirmation, note })
    });
    showNotice('资金核对结论已保存；没有执行重充或退款。', 'success');
    await loadCardFundingAttempts();
  } catch (error) {
    const messages = {
      card_funding_manual_confirmation_required: '确认词不匹配，没有修改资金状态。',
      card_funding_not_unknown: '该记录已不在未知风险状态，请先刷新。',
      invalid_card_funding_manual_resolution: '对账结论或说明不完整，没有修改资金状态。',
      admin_step_up_cancelled: '已取消操作，没有修改资金状态。'
    };
    showNotice(messages[error.message] || '资金核对失败，没有确认任何变更。');
    await loadCardFundingAttempts().catch(() => {});
  } finally {
    button.disabled = false;
  }
});

for (const [status, [label]] of Object.entries(STATUS_META)) {
  elements.statusFilter.insertAdjacentHTML('beforeend', `<option value="${status}">${escapeHtml(label)}</option>`);
}

elements.navItems.forEach((item) => item.addEventListener('click', () => switchView(item.dataset.view).catch(() => showNotice('数据读取失败，请稍后重试。'))));
document.querySelectorAll('[data-open-orders]').forEach((button) => button.addEventListener('click', () => switchView('orders')));
elements.statusList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-status]');
  if (button) switchView('orders', { status: button.dataset.status });
});
elements.metrics.addEventListener('click', (event) => {
  const filterButton = event.target.closest('[data-order-filter]');
  const viewButton = event.target.closest('[data-target-view]');
  if (filterButton) switchView('orders', { status: filterButton.dataset.orderFilter });
  else if (viewButton) switchView(viewButton.dataset.targetView);
});
elements.filters.addEventListener('submit', (event) => {
  event.preventDefault();
  state.selectedOrders.clear();
  state.page = 1;
  state.query = elements.search.value.trim();
  state.status = elements.statusFilter.value;
  state.from = elements.orderFrom.value;
  state.to = elements.orderTo.value;
  state.timeField = elements.orderTimeField.value;
  loadOrders().catch(() => showNotice('订单查询失败，请稍后重试。'));
});
elements.prevPage.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadOrders(); } });
elements.nextPage.addEventListener('click', () => { if (state.page * state.pageSize < state.total) { state.page += 1; loadOrders(); } });
elements.ordersTable.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-select-order]');
  if (!checkbox) return;
  if (checkbox.checked) state.selectedOrders.add(checkbox.value);
  else state.selectedOrders.delete(checkbox.value);
  updateSelectedOrders();
});
elements.selectPageOrders.addEventListener('change', () => {
  elements.ordersTable.querySelectorAll('[data-select-order]:not(:disabled)').forEach((checkbox) => {
    checkbox.checked = elements.selectPageOrders.checked;
    if (checkbox.checked) state.selectedOrders.add(checkbox.value);
    else state.selectedOrders.delete(checkbox.value);
  });
  updateSelectedOrders();
});
elements.batchAuthorizeRecharge.addEventListener('click', () => authorizeSelectedOrders());
document.querySelector('#export-orders')?.addEventListener('click', () => downloadOperationsCsv('orders').catch(() => showNotice('订单导出失败。')));
document.querySelector('#export-reconciliation')?.addEventListener('click', () => downloadOperationsCsv('reconciliation_cases').catch(() => showNotice('对账案例导出失败。')));
document.querySelector('#reconciliation-filters')?.addEventListener('submit', (event) => {
  event.preventDefault();
  state.reconciliationPage = 1;
  loadReconciliationCases().catch(() => showNotice('对账案例读取失败。'));
});
elements.reconciliationPrev?.addEventListener('click', () => {
  if (state.reconciliationPage > 1) { state.reconciliationPage -= 1; loadReconciliationCases(); }
});
elements.reconciliationNext?.addEventListener('click', () => {
  if (state.reconciliationPage * 50 < state.reconciliationTotal) { state.reconciliationPage += 1; loadReconciliationCases(); }
});
elements.reconciliationTable?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-case-id]');
  if (!row) return;
  const button = event.target.closest('button');
  if (!button) return;
  if (button.matches('[data-open-case-order]')) {
    openOrder(row.dataset.publicNo);
  } else if (button.matches('[data-assign-case]')) {
    button.disabled = true;
    assignReconciliationCase(row.dataset.caseId)
      .then(() => { button.disabled = false; })
      .catch(() => { button.disabled = false; showNotice('案例分配失败。'); });
  } else if (button.matches('[data-resolve-case]')) {
    button.disabled = true;
    resolveReconciliationCase(row.dataset.caseId)
      .then(() => { button.disabled = false; })
      .catch(() => { button.disabled = false; showNotice('案例解决失败。'); });
  }
});
elements.browserFilters?.addEventListener('submit', (event) => {
  event.preventDefault();
  state.browserPage = 1;
  loadBrowserRuns().catch(() => showNotice('Browser 运行队列读取失败。'));
});
elements.browserRunsPrev?.addEventListener('click', () => {
  if (state.browserPage > 1) { state.browserPage -= 1; loadBrowserRuns(); }
});
elements.browserRunsNext?.addEventListener('click', () => {
  if (state.browserPage * 50 < state.browserTotal) { state.browserPage += 1; loadBrowserRuns(); }
});
elements.browserRunsTable?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-browser-run]');
  if (row) openBrowserRun(row.dataset.browserRun);
});
elements.browserRunsTable?.addEventListener('keydown', (event) => {
  const row = event.target.closest('[data-browser-run]');
  if (row && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openBrowserRun(row.dataset.browserRun);
  }
});
elements.providerRoutesTable?.addEventListener('click', async (event) => {
  const button = event.target.closest('.route-switch-button');
  if (!button || button.disabled) return;
  const label = button.dataset.routeLabel;
  const confirmation = window.prompt(`请输入确认词：切换卡台 ${label}`)?.trim();
  if (!confirmation) return;
  const note = window.prompt('请输入切换原因（至少 10 个字符）：')?.trim();
  if (!note) return;
  button.disabled = true;
  try {
    await sensitiveApi(`/api/v1/admin/provider-routes/${encodeURIComponent(button.dataset.routeId)}/switch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation, note })
    });
    showNotice('卡台路线已切换；只影响新订单。', 'success');
    await loadProviderRoutes();
  } catch (error) {
    const messages = {
      route_switch_confirmation_required: '确认词不匹配，没有切换。',
      route_switch_note_required: '切换原因至少需要 10 个字符。',
      route_not_healthy: '目标卡台健康检查未通过，没有切换。',
      admin_step_up_cancelled: '已取消操作，没有切换。'
    };
    showNotice(messages[error.message] || '卡台路线切换失败，没有确认任何变更。');
    await loadProviderRoutes().catch(() => {});
  } finally {
    button.disabled = false;
  }
});
document.querySelector('#refresh-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  hideNotice();
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = '刷新中…';
  elements.syncTime.textContent = '正在刷新…';
  try {
    await (state.view === 'overview' ? loadOverview()
    : state.view === 'stock' ? loadStock()
      : state.view === 'cdks' ? loadCdkBatches()
        : state.view === 'reconciliation' ? loadReconciliationCases()
          : state.view === 'card-funding' ? loadCardFundingAttempts()
          : state.view === 'provider-routes' ? loadProviderRoutes()
          : state.view === 'browser' ? loadBrowserRuns() : loadOrders());
    showNotice('刷新完成。', 'success');
  } catch {
    showNotice('刷新失败，请稍后重试。');
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.textContent = '刷新';
  }
});
document.querySelector('#card-funding-filters')?.addEventListener('submit', (event) => {
  event.preventDefault(); state.cardFundingPage = 1; loadCardFundingAttempts().catch(() => showNotice('卡余额充值队列读取失败。'));
});
elements.cardFundingPrev?.addEventListener('click', () => {
  if (state.cardFundingPage > 1) { state.cardFundingPage -= 1; loadCardFundingAttempts(); }
});
elements.cardFundingNext?.addEventListener('click', () => {
  if (state.cardFundingPage * 20 < state.cardFundingTotal) { state.cardFundingPage += 1; loadCardFundingAttempts(); }
});
document.querySelector('#refresh-stock')?.addEventListener('click', () => loadStock().catch(() => showNotice('库存读取失败。')));
document.querySelector('#sync-all-cards')?.addEventListener('click', (event) => requestCardSync(null, event.currentTarget));
elements.discoverNewCards?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = '正在发现并验证…';
  try {
    const result = await api('/api/v1/admin/card-intake/discover', { method: 'POST' });
    const accepted = Number(result.firstPass?.accepted || 0) + Number(result.secondPass?.accepted || 0);
    const review = Number(result.secondPass?.reviewRequired || 0);
    showNotice(`新卡接管完成：已入库 ${accepted} 张${review ? `，${review} 张留在隔离区待核对` : ''}。`, 'success');
    await loadStock();
  } catch {
    showNotice('新卡接管失败；没有通过验证的卡不会进入可用库存。');
  } finally {
    button.disabled = false;
    button.textContent = '同步并接管新卡';
  }
});
document.querySelectorAll('.stock-preset').forEach((button) => button.addEventListener('click', () => {
  elements.stockOpenCount.value = button.dataset.count;
  updateStockEstimate();
}));
elements.stockOpenCount?.addEventListener('input', updateStockEstimate);
elements.stockOpenAmount?.addEventListener('input', updateStockEstimate);
elements.stockCardType?.addEventListener('change', () => {
  state.stockCardTypeId = elements.stockCardType.value;
  renderSelectedStockCardType({ resetInvalidAmount: true });
});
elements.stockThresholdForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/v1/admin/card-stock/threshold', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: Number(elements.stockThreshold.value) })
    });
    showNotice('补卡提醒阈值已保存。');
    await loadStock();
  } catch { showNotice('阈值保存失败。'); }
});
elements.replenishmentLimitForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const dailyLimit = Number(elements.replenishmentDailyLimit.value);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 500) {
    showNotice('每日上限必须是 0 到 500 的整数。');
    return;
  }
  if (!window.confirm(`确认将每日自动补卡上限调整为 ${dailyLimit} 张？\n\n只影响后续自动补卡，不影响已创建任务。`)) return;
  try {
    await sensitiveApi('/api/v1/admin/card-stock/replenishment-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dailyLimit, reason: 'admin replenishment policy update' })
    });
    showNotice('每日自动补卡上限已保存。');
    await loadStock();
  } catch { showNotice('每日自动补卡上限保存失败。'); }
});
elements.stockOpenForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const count = Number(elements.stockOpenCount.value);
  const amount = Number(elements.stockOpenAmount.value);
  const cardTypeId = state.stockCardTypeId;
  const cardTypeName = selectedStockCardType()?.name || `卡段 ${cardTypeId}`;
  const expected = `开${count}张`;
  if (elements.stockConfirmation.value.trim() !== expected) {
    showNotice(`请输入确认词“${expected}”。`);
    return;
  }
  const riskThreshold = Number(state.stockProvider?.riskConfirmThreshold || 10);
  const largeBatchConfirmed = count > riskThreshold;
  const confirmationMessage = largeBatchConfirmed
    ? `此次将在“${cardTypeName}”（ID ${cardTypeId}）一次性创建 ${count} 张卡，超过 ${riskThreshold} 张风险提示阈值。\n\n每张充值 $${amount}，预计总扣款 $${elements.stockCost.dataset.total}。\n\n确认继续吗？`
    : `确认在“${cardTypeName}”（ID ${cardTypeId}）创建 ${count} 张、每张充值 $${amount} 的开卡任务？预计总扣款 $${elements.stockCost.dataset.total}。`;
  if (!window.confirm(confirmationMessage)) return;
  const button = elements.stockOpenForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await sensitiveApi('/api/v1/admin/card-stock/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, amount, cardTypeId, confirmation: expected, largeBatchConfirmed })
    });
    elements.stockConfirmation.value = '';
    showNotice('开卡任务已创建，服务器将在约 10 秒内开始执行。');
    await loadStock();
  } catch (error) {
    const messages = {
      card_stock_rules_stale: '卡台规则已过期，等待自动刷新后重试。',
      card_stock_amount_out_of_range: '金额不在当前卡段允许范围内。',
      card_stock_balance_insufficient: '卡台余额不足以安全完成整批开卡。',
      card_stock_limit_insufficient: '卡台剩余卡片额度不足。',
      card_stock_card_type_unavailable: '所选卡段 ID 不存在、不可用或已变更。',
      card_stock_purchase_disabled: '卡台当前禁止开卡。',
      card_stock_job_active: '已有补卡任务正在执行。',
      card_catalog_stale: '卡台卡片对账已过期，等待自动同步后再试。',
      card_catalog_unresolved: '卡台存在未核对的有效卡，已禁止新开卡。'
    };
    showNotice(messages[error.message] || '任务创建失败，未产生新的开卡请求。');
  }
  finally { button.disabled = false; }
});
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/v1/admin/session', { method: 'DELETE' }).catch(() => {});
  window.location.replace('/admin/login');
});
document.querySelector('#close-detail').addEventListener('click', () => elements.detail.close());
elements.detail.addEventListener('click', (event) => { if (event.target === elements.detail) elements.detail.close(); });
window.setInterval(() => {
  const editing = document.activeElement?.matches?.('input, textarea, select') || elements.detail.open;
  if (document.hidden || editing) return;
  const refresh = state.view === 'overview' ? loadOverview
    : state.view === 'orders' ? loadOrders
      : state.view === 'stock' ? loadStock
        : state.view === 'cdks' ? loadCdkBatches
          : state.view === 'reconciliation' ? loadReconciliationCases
            : state.view === 'browser' ? loadBrowserRuns : null;
  refresh?.().catch(() => {});
}, 10_000);
elements.cdkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideNotice();
  const button = elements.cdkForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = '生成中…';
  const count = Number(elements.cdkCount.value);
  if (count > 10 && !window.confirm(`确认一次生成 ${count} 个 CDK？\n\n生成只创建批次，不会自动下载或交付。`)) {
    button.disabled = false;
    button.textContent = '生成 CDK';
    return;
  }
  const storedRequest = JSON.parse(sessionStorage.getItem('cdk-generation-request') || 'null');
  const requestKey = storedRequest?.count === count
    ? storedRequest.key : crypto.randomUUID();
  sessionStorage.setItem('cdk-generation-request', JSON.stringify({ count, key: requestKey }));
  let payload;
  try {
    payload = await sensitiveApi('/api/v1/admin/cdks/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
      body: JSON.stringify({ count })
    });
    elements.generatedCdks.value = payload.codes.join('\n');
    elements.generatedCdks.rows = Math.min(Math.max(payload.codes.length, 3), 18);
    elements.cdkBatchLabel.textContent = `批次 ${payload.batchNo} · ${payload.count} 个`;
    elements.cdkResult.hidden = false;
    sessionStorage.removeItem('cdk-generation-request');
    window.clearTimeout(state.cdkClearTimer);
    state.cdkClearTimer = window.setTimeout(() => {
      clearGeneratedCdks();
      showNotice('CDK 明文已从页面自动清除；需要时可从批次记录重新下载。', 'warning');
    }, 10 * 60 * 1000);
  } catch (error) {
    showNotice(cdkErrorMessage(error, 'CDK 生成'));
    button.disabled = false;
    button.textContent = '生成 CDK';
    return;
  }
  showNotice(`已生成批次 ${payload.batchNo}，共 ${payload.count} 个 CDK；尚未下载。`, 'success');
  try {
    await loadCdkBatches();
  } catch {
    showNotice(`批次 ${payload.batchNo} 已生成，但列表刷新失败；请点“刷新”核对，不要再次生成。`, 'warning');
  } finally {
    button.disabled = false;
    button.textContent = '生成 CDK';
  }
});
elements.downloadCdks.addEventListener('click', () => {
  const batchNo = elements.cdkBatchLabel.textContent.match(/^批次\s+(\S+)/)?.[1] || 'cdks';
  downloadCodes(batchNo, elements.generatedCdks.value.split(/\r?\n/).filter(Boolean));
});
document.querySelector('#refresh-cdk-batches')?.addEventListener('click', () => loadCdkBatches().catch(() => showNotice('批次记录读取失败。')));
elements.cdkBatches.addEventListener('click', (event) => {
  const row = event.target.closest('[data-cdk-batch]');
  if (!row) return;
  const batchNo = row.dataset.cdkBatch;
  if (event.target.closest('[data-download-batch]')) downloadStoredBatch(batchNo, event.target.closest('button'));
  if (event.target.closest('[data-status-report]')) downloadStoredBatchStatus(batchNo, event.target.closest('button'));
  if (event.target.closest('[data-revoke-batch]')) revokeStoredBatch(batchNo, event.target.closest('button'));
});
elements.copyCdks.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.generatedCdks.value);
    elements.copyCdks.textContent = '已复制';
    setTimeout(() => { elements.copyCdks.textContent = '复制全部'; }, 1500);
  } catch {
    elements.generatedCdks.select();
    showNotice('自动复制失败，已选中卡密，请手动复制。');
  }
});
document.addEventListener('click', (event) => {
  const intakeButton = event.target.closest('#toggle-order-acceptance');
  if (intakeButton) {
    setOrderAcceptance(intakeButton);
    return;
  }
  const row = event.target.closest('tr[data-order]');
  if (row && !event.target.closest('input, button, a')) openOrder(row.dataset.order);
  const card = event.target.closest('[data-card]');
  if (card) openCard(card.dataset.card, card.dataset.cardAccount);
});
document.addEventListener('keydown', (event) => {
  const row = event.target.closest?.('tr[data-order]');
  if (row && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openOrder(row.dataset.order);
  }
  const card = event.target.closest?.('[data-card]');
  if (card && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openCard(card.dataset.card, card.dataset.cardAccount);
  }
});

api('/api/v1/admin/session')
  .then(() => switchView('overview'))
  .catch((error) => { if (error.message !== 'admin_auth_required') showNotice('后台暂时无法加载。'); });
