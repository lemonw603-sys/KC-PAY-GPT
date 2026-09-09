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
  dispatch_new_recharges: '自动充值（对已接订单自动购买 Plus）',
  recharge_dispatch_mode: '自动充值模式',
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
const STAGE_LABELS = Object.freeze({
  RECEIVED: ['已收到', 'blue'], SESSION_INVALID: ['等客户重贴 Session', 'orange'], QUEUED: ['排队中', 'blue'],
  LOGIN: ['登录核对中', 'blue'], CHECKOUT: ['填写结账中', 'blue'], PAYING: ['付款中', 'blue'],
  VERIFYING: ['核实开通中', 'blue'], UPGRADING: ['升级 Pro 中', 'blue'], DONE: ['已完成', 'green'],
  CLOSED_NO_PAYMENT: ['付款前关闭', 'gray'], PAYMENT_UNKNOWN: ['付款结果不明', 'orange'],
  FAILED_AFTER_PAYMENT: ['已付款未交付', 'red']
});
const CUSTOMER_ACTION_LABELS = Object.freeze({
  ACCOUNT_ALREADY_PLUS: '账号已是 Plus，需换免费账号', SESSION_INVALID: 'Session 无效'
});
const ATTEMPT_STATUS_LABELS = Object.freeze({
  PREPARED: '已准备', SUBMITTED: '已提交', UNKNOWN: '结果未知', SUCCESS: '成功', FAILED: '失败', SETTLED: '已结算'
});
const LEDGER_STATUS_LABELS = Object.freeze({
  RESERVED: '已占用', CONSUMED: '已消费', RECONCILIATION: '对账中', RELEASED: '已释放'
});
const ORDER_FILTER_TITLES = Object.freeze({
  REVIEW_REQUIRED: '需要处理的订单', ACTIVE: '进行中的订单', FINISHED: '已完成的订单', TODAY: '今日订单',
  PROCESSING: '自动处理中的订单', WAITING_FOR_SESSION: '等 Session 的订单'
});
const REFUND_LABELS = Object.freeze({ MONITORING: '观察中', DETECTED: '疑似退款', CONFIRMED: '已确认退款', WITHDRAWN: '已提取' });
const INVENTORY_LABELS = Object.freeze({ AVAILABLE: '可分配', ASSIGNED: '已分配', DEPLETED: '已耗尽', PROVISIONING: '核对中', FAILED: '已失效', HELD_FOR_REVIEW: '已隔离，禁止自动复用', RETIRED: '永久停用', PRODUCT_ONLY: '限定产品' });
const STOCK_CATEGORY_LABELS = Object.freeze({ READY: '可分配', IN_USE: '使用中', BLOCKED: '暂不可用', RETIRED: '永久停用' });
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
  EVIDENCE_PENDING: '证据待同步', CONSISTENT_FAILURE: '失败结果一致', REVIEW_REQUIRED: '需要人工核对'
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
  view: 'overview', nav: 'overview', page: 1, pageSize: 20, total: 0, status: '', query: '',
  from: '', to: '', timeField: 'CREATED',
  stockProvider: null, stockCatalog: null, stockCardTypeId: '', acceptingOrders: false,
  cdkLoadSequence: 0, cdkBatchCursor: null, cdkBatchRows: [],
  reconciliationPage: 1, reconciliationTotal: 0,
  browserPage: 1, browserTotal: 0, cardFundingPage: 1, cardFundingTotal: 0
};
const elements = {
  navItems: [...document.querySelectorAll('.nav-item')],
  views: [...document.querySelectorAll('.view')],
  viewKicker: document.querySelector('#view-kicker'),
  viewTitle: document.querySelector('#view-title'),
  syncTime: document.querySelector('#sync-time'),
  metrics: document.querySelector('#metrics-grid'),
  readinessList: document.querySelector('#admin-readiness-list'),
  diagnosticsReadiness: document.querySelector('#diagnostics-readiness-list'),
  diagnosticsHeartbeat: document.querySelector('#diagnostics-heartbeat'),
  decisionsGrid: document.querySelector('#decisions-grid'),
  attentionOrders: document.querySelector('#attention-orders'),
  ordersTable: document.querySelector('#orders-table'),
  filters: document.querySelector('#order-filters'),
  search: document.querySelector('#order-search'),
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
  ,startBusiness: document.querySelector('#start-business')
  ,alertsCard: document.querySelector('#alerts-card'), alertsList: document.querySelector('#alerts-list'),
  cdkForm: document.querySelector('#cdk-form'), cdkCount: document.querySelector('#cdk-count'),
  cdkResult: document.querySelector('#cdk-result'), generatedCdks: document.querySelector('#generated-cdks'),
  cdkBatchLabel: document.querySelector('#cdk-batch-label'), copyCdks: document.querySelector('#copy-cdks'),
  downloadCdks: document.querySelector('#download-cdks'), cdkBatches: document.querySelector('#cdk-batches'),
  cdkBatchFilters: document.querySelector('#cdk-batch-filters'), cdkBatchPlan: document.querySelector('#cdk-batch-plan'), cdkBatchStatus: document.querySelector('#cdk-batch-status'), cdkBatchFrom: document.querySelector('#cdk-batch-from'), cdkBatchTo: document.querySelector('#cdk-batch-to'), cdkBatchMore: document.querySelector('#cdk-batch-more'), cdkBatchPageInfo: document.querySelector('#cdk-batch-page-info'), exportCdkBatches: document.querySelector('#export-cdk-batches'), exportCdkTrace: document.querySelector('#export-cdk-trace'),
  stockSummary: document.querySelector('#stock-summary'), stockJobs: document.querySelector('#stock-jobs'),
  stockCards: document.querySelector('#stock-cards'), providerSummary: document.querySelector('#provider-summary'),
  cardCapacityForm: document.querySelector('#card-capacity-form'), cardCapacity: document.querySelector('#card-capacity'),
  minimumBalanceForm: document.querySelector('#minimum-balance-form'), minimumBalance: document.querySelector('#minimum-balance'),
  minimumBalancePlan: document.querySelector('#minimum-balance-plan'), cdkPlan: document.querySelector('#cdk-plan'),
  stockOpenForm: document.querySelector('#stock-open-form'), stockOpenCount: document.querySelector('#stock-open-count'),
  stockOpenAmount: document.querySelector('#stock-open-amount'), stockCardType: document.querySelector('#stock-card-type'),
  refreshCardProviderRules: document.querySelector('#refresh-card-provider-rules'),
  stockCardProfile: document.querySelector('#stock-card-profile'),
  stockCost: document.querySelector('#stock-cost'),
  cardIntakeList: document.querySelector('#card-intake-list'),
  discoverNewCards: document.querySelector('#discover-new-cards'),
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
  browserDispatchTable: document.querySelector('#browser-dispatch-table'),
  browserDispatchCount: document.querySelector('#browser-dispatch-count'),
  browserRunsTable: document.querySelector('#browser-runs-table'),
  browserRunsCount: document.querySelector('#browser-runs-count'),
  browserRunsPage: document.querySelector('#browser-runs-page'),
  browserRunsPrev: document.querySelector('#browser-runs-prev'),
  browserRunsNext: document.querySelector('#browser-runs-next'),
  providerRoutesTable: document.querySelector('#provider-routes-table')
  ,cardSourceSummary: document.querySelector('#card-source-summary')
  ,manualCardSourceForm: document.querySelector('#manual-card-source-form')
  ,manualCardSourceCode: document.querySelector('#manual-card-source-code')
  ,manualCardSourceName: document.querySelector('#manual-card-source-name')
  ,cardFundingTable: document.querySelector('#card-funding-table')
  ,cardFundingCount: document.querySelector('#card-funding-count')
  ,cardFundingPage: document.querySelector('#card-funding-page')
  ,cardFundingPrev: document.querySelector('#card-funding-prev')
  ,cardFundingNext: document.querySelector('#card-funding-next')
  ,cardFundingStatus: document.querySelector('#card-funding-status')
  ,manualCardImportForm: document.querySelector('#manual-card-import-form')
  ,manualCardImportFile: document.querySelector('#manual-card-import-file')
  ,manualCardImportSource: document.querySelector('#manual-card-import-source')
  ,manualCardImportPreview: document.querySelector('#manual-card-import-preview')
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
  return `已等待系统执行 ${Math.floor(minutes / 60)} 小时，请检查自动充值与对外扣款开关`;
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
  if (!response.ok) {
    const error = new Error(payload?.error || 'request_failed');
    error.payload = payload;
    throw error;
  }
  return payload;
}

function renderReadiness(readiness = {}, target = elements.readinessList) {
  if (!target) return;
  const statusLabels = { READY: '已就绪', AUTO_HEAL: '自动处理', ACTION_REQUIRED: '需要处理', BLOCKED: '暂不可用' };
  // Five pages only: card matters go to 卡片, execution and reconciliation to 诊断.
  const actionViews = {
    REFRESH_PROVIDER_RULES: 'stock', OPEN_CARD_STOCK: 'stock', OPEN_CARD_FUNDING: 'stock',
    OPEN_BROWSER_STATUS: 'diagnostics', OPEN_RECONCILIATION: 'diagnostics',
    OPEN_PROVIDER_ROUTES: 'stock'
  };
  target.innerHTML = (readiness.checks || []).map((item) => `<div class="readiness-row readiness-${String(item.status || '').toLowerCase()}"><span><strong>${escapeHtml(item.message || item.checkId)}</strong><small>${escapeHtml(statusLabels[item.status] || item.status || '未知')}</small></span>${item.actionId ? `<button type="button" class="text-button readiness-action" data-readiness-action="${escapeHtml(item.actionId)}">去处理</button>` : '<span class="readiness-ok">✓</span>'}</div>`).join('') || '<p class="empty-state">暂无检查项</p>';
  target.querySelectorAll('[data-readiness-action]').forEach((button) => button.addEventListener('click', () => {
    const target = actionViews[button.dataset.readinessAction];
    if (target) document.querySelector(`.nav-item[data-view="${target}"]`)?.click();
  }));
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

// D-119: money and production actions confirm once in the dialog; no second password.
async function sensitiveApi(url, options) {
  return api(url, options);
}

function stageChip(stage = {}) {
  const [label, tone] = STAGE_LABELS[stage.stage] || [stage.label || '未知', stage.tone || 'gray'];
  return `<span class="status-chip status-${tone}"><i></i>${escapeHtml(label)}</span>`;
}

function productLabel(order) {
  return order.productName || (order.planType ? String(order.planType).toUpperCase() : '—');
}

// The resident pool writes the identity into worker_id as `pool:<lane>`; the
// read-only worker writes its own name; selected_lane is not written today.
function identityLabel(run) {
  const worker = String(run?.workerId || '');
  if (worker.startsWith('pool:')) return worker.slice('pool:'.length);
  return worker || run?.lane || run?.profileCode || '—';
}

function identityCell(order) {
  const run = order.browserRun;
  if (run) {
    return `<span class="cell-main">${escapeHtml(identityLabel(run))}</span><small>${escapeHtml(BROWSER_RUN_LABELS[run.status] || run.status)}${run.profileCode ? ` · ${escapeHtml(run.profileCode)}` : ''}</small>`;
  }
  if (order.attempt?.executorKind === 'API') return '<span class="cell-main">API 路线</span>';
  return '<span class="cell-main">—</span>';
}

function orderRow(order) {
  const stage = order.stage || {};
  return `<tr data-order="${escapeHtml(order.publicNo)}" tabindex="0">
    <td><strong class="order-link">${escapeHtml(order.publicNo)}</strong><small>${escapeHtml(order.customerEmail || order.chatgptAccountId || '—')}</small></td>
    <td>${escapeHtml(productLabel(order))}</td>
    <td>${stageChip(stage)}</td>
    <td>${stage.action ? `<small class="attention-note">${escapeHtml(stage.action)}</small>` : '<small>—</small>'}</td>
    <td>${order.card?.last4 ? `尾号 ${escapeHtml(order.card.last4)}` : '—'}</td>
    <td>${identityCell(order)}</td>
    <td>${formatTime(order.createdAt)}</td>
  </tr>`;
}

function renderDecisions(overview, cardSources) {
  if (!elements.decisionsGrid) return;
  const d = overview.decisions || {};
  state.decisions = d;
  state.acceptingOrders = Boolean(d.acceptNewOrders);
  const health = overview.providerHealth || {};
  const intake = !d.acceptNewOrders ? 'stop' : d.dispatchNewRecharges ? 'run' : 'pause';
  const intakeButton = (key, label) => `<button type="button" class="${intake === key ? 'primary-small' : 'ghost-button'}" data-intake="${key}" ${intake === key ? 'disabled' : ''}>${label}</button>`;
  const rechargeMethod = String(health.rechargeMethod || '').toUpperCase();
  const routeButton = (method, label, ready = true, title = '') => `<button class="${rechargeMethod === method ? 'primary-small' : 'ghost-button'} default-recharge-method" type="button" data-method="${method}" ${rechargeMethod === method || !ready ? 'disabled' : ''} title="${escapeHtml(title)}">${label}</button>`;
  const sources = (cardSources?.sources || []).filter((item) => item.supportsBrowserRecharge && item.operationalEnabled);
  const currentSource = cardSources?.browserProviderAccountId || '';
  const sourceOptions = sources.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === currentSource ? 'selected' : ''}>${escapeHtml(item.displayName)}</option>`).join('');
  const payOn = Boolean(d.browserPaymentWritesEnabled);
  const payMismatch = d.browserProfileWritesEnabled != null && d.browserProfileWritesEnabled !== payOn;
  const supplyOn = Boolean(d.supplyAutomationEnabled);
  const supplyMixed = Boolean(d.supplyAutomationMixed);
  // Server toggle is all-or-nothing (both auto-open + auto-topup). In the mixed
  // state (one on, one off) offer BOTH resolutions so the on-half can be turned
  // off too, not only turned fully on.
  const supplyBtn = (enable) => `<button type="button" class="${enable ? 'primary-small' : 'danger-small'}" data-supply-toggle data-enable="${enable}">${enable ? '开启' : '关闭'}</button>`;
  const supplyControls = supplyOn ? supplyBtn(false) : (supplyMixed ? `${supplyBtn(true)}${supplyBtn(false)}` : supplyBtn(true));
  const supplyLabel = supplyOn ? '自动开卡与补余额' : (supplyMixed ? '部分开启' : '全部人工');
  const supplyHint = supplyOn ? '没有合格卡时按真实订单需求自动开卡、自动补足余额' : (supplyMixed ? '开卡与补余额一个开一个关；「开启」两个都开，「关闭」两个都关' : '开卡与补余额都由人工在卡片页操作');
  elements.decisionsGrid.innerHTML = `
    <div class="decision"><strong>接不接单</strong><span class="segmented-actions">${intakeButton('run', '接单并处理')}${intakeButton('pause', '接单但暂停处理')}${intakeButton('stop', '停止接单')}</span><small>${intake === 'run' ? '新订单可以提交，规则通过后自动履约' : intake === 'pause' ? '新订单可以提交，但不派发充值，已有订单继续追踪' : '客户页拒绝新订单，已有订单继续追踪'}</small></div>
    <div class="decision"><strong>走哪条路线</strong><span class="segmented-actions">${routeButton('API', 'API 充值')}${routeButton('BROWSER', '浏览器自动化充值', Boolean(health.browserRechargeReady), health.browserRechargeReady ? '' : 'Browser 执行器尚未就绪')}</span><small>只影响切换后新建的订单；执行中的订单保持原路线</small></div>
    <div class="decision"><strong>用哪个卡台</strong><span class="segmented-actions"><select id="decision-card-source" aria-label="Browser 卡台">${sourceOptions || '<option value="">没有可用卡台</option>'}</select><button type="button" class="primary-small" id="decision-card-source-apply" ${sources.length ? '' : 'disabled'}>切换</button></span><small>Browser 路线的卡台；切换只影响之后的新订单，不自动回退</small></div>
    <div class="decision"><strong>能不能付钱</strong><span class="segmented-actions"><em class="switch-state ${payOn ? 'is-on' : ''}">${payOn ? '允许自动付款' : '禁止自动付款'}</em><button type="button" class="${payOn ? 'danger-small' : 'primary-small'}" id="decision-payment" data-enabled="${payOn}">${payOn ? '关闭' : '开启'}</button></span><small>${payMismatch ? '执行器配置与开关不一致，点一次开启/关闭会同步' : payOn ? '浏览器会真实点击付款；每单仍受单笔许可与唯一提交保护' : '所有 Browser 单停在付款前，不会扣款'}</small></div>
    <div class="decision"><strong>能不能开卡补钱</strong><span class="segmented-actions"><em class="switch-state ${supplyOn ? 'is-on' : ''}">${supplyLabel}</em>${supplyControls}</span><small>${supplyHint}</small></div>`;
}

async function loadOverview() {
  const [overview, attention, alertData, cardSources] = await Promise.all([
    api('/api/v1/admin/overview'),
    api('/api/v1/admin/orders?page=1&pageSize=8&status=REVIEW_REQUIRED'),
    api('/api/v1/admin/alerts?limit=10'),
    api('/api/v1/admin/card-sources').catch(() => ({ sources: [] }))
  ]);
  renderReadiness(overview.readiness);
  renderDecisions(overview, cardSources);
  const metrics = [
    { label: '今日订单', value: overview.metrics.todayOrders, note: '今天新建', filter: 'TODAY' },
    { label: '自动处理中', value: overview.metrics.processingOrders, note: '正常模式由系统自动执行', filter: 'PROCESSING' },
    { label: '需要处理', value: overview.metrics.reviewingOrders, note: '失败、未知或对账订单', filter: 'REVIEW_REQUIRED' },
    { label: '等待 Session', value: overview.metrics.waitingForSession ?? 0, note: '客户可随时重新提供', filter: 'WAITING_FOR_SESSION' },
    { label: 'Plus 可分配卡', value: overview.cardStock?.available ?? 0, note: overview.cardStock?.available ? '合格且未占用' : '没有合格卡，新订单会等卡', view: 'stock' }
  ];
  elements.metrics.innerHTML = metrics.map((item, index) => `<button type="button" class="metric-card metric-${index + 1}" ${item.filter ? `data-order-filter="${item.filter}"` : `data-target-view="${item.view}"`}><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(item.note)}</small></button>`).join('');
  elements.attentionOrders.innerHTML = attention.orders?.length
    ? attention.orders.map(orderRow).join('')
    : '<tr><td colspan="6" class="empty-cell">没有需要处理的订单</td></tr>';
  const alerts = alertData.alerts || [];
  elements.alertsCard.hidden = alerts.length === 0;
  elements.alertsList.innerHTML = alerts.map((alert) => `<div><span><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.message)}</small></span><span class="case-actions"><em>${formatTime(alert.createdAt)}</em><button type="button" class="ghost-button" data-close-alert="${escapeHtml(alert.id)}">关闭</button></span></div>`).join('');
  elements.alertsList.querySelectorAll('[data-close-alert]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api(`/api/v1/admin/alerts/${encodeURIComponent(button.dataset.closeAlert)}/close`, { method: 'POST' });
      showNotice('提醒已关闭；不会改变任何订单、卡片或开关。', 'success');
      await loadOverview();
    } catch {
      showNotice('提醒关闭失败，请刷新后重试。');
      button.disabled = false;
    }
  }));
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
    ? payload.orders.map((order) => orderRow(order)).join('')
    : payload.cdkMatches?.length
      ? payload.cdkMatches.map((cdk) => `<tr><td><strong>CDK 精确匹配</strong><small>批次 ${escapeHtml(cdk.batchNo || '—')}</small></td><td>${escapeHtml(String(cdk.planType || '—').toUpperCase())}</td><td>${escapeHtml(cdk.status)}</td><td>${cdk.orderPublicNo ? '已被订单使用' : '尚未下单'}</td><td>—</td><td>—</td><td>${formatTime(cdk.createdAt)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="empty-cell">没有符合条件的订单或 CDK</td></tr>';
  const totalPages = Math.max(1, Math.ceil(payload.total / state.pageSize));
  elements.orderCount.textContent = `${payload.total} 条订单`;
  elements.pageLabel.textContent = `第 ${state.page} / ${totalPages} 页`;
  elements.prevPage.disabled = state.page <= 1;
  elements.nextPage.disabled = state.page >= totalPages;
  elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
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


const RECONCILIATION_STATUS_LABELS = Object.freeze({ OPEN: '待处理', ASSIGNED: '已分配', RESOLVED: '已解决' });
const RECONCILIATION_SEVERITY_LABELS = Object.freeze({ critical: '严重', warning: '警告', info: '提示' });
const RECONCILIATION_TYPE_LABELS = Object.freeze({
  PROVIDER_PAYMENT_EVIDENCE_MISSING: '缺少充值平台付款证据',
  PAYMENT_AMOUNT_MISMATCH: '付款金额不一致',
  CARD_PAYMENT_NOT_FOUND: '找不到卡片付款记录',
  SUBMIT_UNKNOWN: '提交结果未知',
  PROVIDER_ORDER_MISSING: '缺少充值平台订单号',
  EVIDENCE_PENDING: '交易证据尚未同步'
});

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
      <td><span class="cell-main">${escapeHtml(RECONCILIATION_TYPE_LABELS[item.caseType] || item.caseType)}</span><small>${escapeHtml(item.caseType)} · ${escapeHtml(RECONCILIATION_SEVERITY_LABELS[item.severity] || item.severity)}</small></td>
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
  const assignedTo = (await askForm({
    title: '分配对账案例', fields: [{ name: 'assignedTo', label: '负责人名称', type: 'text', value: 'admin', required: true }], confirmLabel: '分配'
  }))?.assignedTo;
  if (!assignedTo) return;
  await api(`/api/v1/admin/reconciliation-cases/${encodeURIComponent(caseId)}/assign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignedTo })
  });
  showNotice('案例已分配。', 'success');
  await loadReconciliationCases();
}

async function resolveReconciliationCase(caseId, { after = null } = {}) {
  const resolutionNote = (await askForm({
    title: '关闭对账案例', fields: [{ name: 'note', label: '处理结论（必填）', type: 'textarea', required: true }], confirmLabel: '关闭案例'
  }))?.note;
  if (!resolutionNote) return;
  await sensitiveApi(`/api/v1/admin/reconciliation-cases/${encodeURIComponent(caseId)}/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolutionNote })
  });
  showNotice('案例已解决并保留处理结论。', 'success');
  if (after) await after(); else await loadReconciliationCases();
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
const BROWSER_DISPATCH_LABELS = Object.freeze({
  QUEUED: '排队中', CLAIMED: '已领取', COMPLETED: '已完成', CANCELLED: '已安全收口'
});

async function loadBrowserDispatchJobs() {
  const params = new URLSearchParams({ page: 1, pageSize: 50 });
  if (elements.browserPublicNo.value.trim()) params.set('publicNo', elements.browserPublicNo.value.trim());
  const payload = await api(`/api/v1/admin/browser/dispatch-jobs?${params}`);
  elements.browserDispatchTable.innerHTML = payload.jobs.length
    ? payload.jobs.map((job) => `<tr>
      <td><strong>${escapeHtml(job.publicNo)}</strong><small>Dispatch ${escapeHtml(job.id)} · ${escapeHtml(job.jobKey)}</small></td>
      <td><span class="cell-main">${escapeHtml(BROWSER_DISPATCH_LABELS[job.status] || job.status)}</span><small>领取 ${job.attemptCount} 次${job.lastErrorCode ? ` · ${escapeHtml(job.lastErrorCode)}` : ''}</small></td>
      <td><span class="cell-main">${escapeHtml(job.attemptStatus)} / ${escapeHtml(job.fundsRiskState)}</span><small>${escapeHtml(job.orderStatus)} · ${escapeHtml(job.rechargeAttemptId)}</small></td>
      <td><span class="cell-main">${escapeHtml(job.lease?.owner || '未领取')}</span><small>${formatTime(job.lease?.until)}</small></td>
      <td><span class="cell-main">${escapeHtml(job.profile?.code || '领取时绑定')}</span><small>${job.latestRun ? `Run ${escapeHtml(job.latestRun.id)} · ${escapeHtml(job.latestRun.status)}` : '尚未创建 Run'}</small></td>
      <td><span class="cell-main">${formatTime(job.queuedAt)}</span><small>${formatTime(job.updatedAt)}</small></td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="empty-cell">没有符合条件的 Browser dispatch 任务</td></tr>';
  elements.browserDispatchCount.textContent = payload.hasMore
    ? `至少 ${payload.jobs.length} / ${payload.total} 个任务`
    : `${payload.total} 个任务`;
}

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

// Offered only while the system has not submitted and automation is not live:
// the operator finished the Checkout by hand, so the order must be closed from
// their confirmation instead of staying RECHARGE_PROCESSING with the card held.
function manualPaymentEligible(run) {
  const paymentUntouched = ['NOT_STARTED', 'PAYMENT_ARMED'].includes(run.paymentState);
  const leaseLive = Boolean(run.worker?.leaseUntil) && new Date(run.worker.leaseUntil).getTime() > Date.now();
  const automationStopped = ['FROZEN', 'TRANSFERRED'].includes(run.controlState)
    || (run.controlState === 'AUTOMATION' && !leaseLive);
  return paymentUntouched && automationStopped;
}
function manualPaymentButton(run) {
  return manualPaymentEligible(run)
    ? '<button class="primary-small" type="button" data-browser-control="CONFIRM_MANUAL_PAYMENT">人工付款已完成</button>'
    : '';
}
function upgradeConfirmEligible(run) {
  return run.controlState === 'TRANSFERRED' && run.status === 'HUMAN_REQUIRED'
    && run.paymentState === 'PAYMENT_CONFIRMED' && run.postPaymentState === 'PLUS_CONFIRMED';
}

function browserControlButtons(run) {
  if (!['READY', 'RUNNING', 'HUMAN_REQUIRED'].includes(run.status)) return '';
  if (run.controlState === 'AUTOMATION') {
    return `${manualPaymentButton(run)}<button class="text-button" type="button" data-browser-control="REQUEST">请求人工接管</button>`;
  }
  if (run.controlState === 'REQUESTED') {
    return '<button class="danger-small" type="button" data-browser-control="FREEZE">冻结自动化</button><button class="text-button" type="button" data-browser-control="CANCEL">取消请求</button>';
  }
  if (run.controlState === 'FROZEN') {
    return `${manualPaymentButton(run)}<button class="primary-small" type="button" data-browser-control="TRANSFER">转交人工</button><button class="danger-small" type="button" data-browser-control="MARK_PAYMENT_UNKNOWN">标记付款未知</button>`;
  }
  if (run.controlState === 'TRANSFERRED') {
    if (run.status === 'HUMAN_REQUIRED' && run.paymentState === 'PAYMENT_CONFIRMED'
      && run.postPaymentState === 'PLUS_CONFIRMED') {
      return '<button class="primary-small" type="button" data-browser-control="COMPLETE_20X">确认 20X 已升级</button>';
    }
    return `${manualPaymentButton(run)}<button class="primary-small" type="button" data-browser-control="RELEASE_SAFE">确认未付款并恢复</button><button class="danger-small" type="button" data-browser-control="MARK_PAYMENT_UNKNOWN">标记付款未知</button>`;
  }
  return '';
}

// 一个对话框收完一次操作需要的全部输入（替代连环 window.confirm/prompt）。
// 返回 {字段: 值} 或 null（取消/Esc）。required 字段为空时不允许提交。
let askDialogElement = null;
function askForm({ title, message = '', fields = [], confirmLabel = '确认', danger = false }) {
  return new Promise((resolve) => {
    if (!askDialogElement) {
      askDialogElement = document.createElement('dialog');
      askDialogElement.className = 'ask-dialog';
      document.body.appendChild(askDialogElement);
    }
    const dialog = askDialogElement;
    const control = (field) => {
      const id = `ask-${field.name}`;
      const required = field.required ? ' required' : '';
      if (field.type === 'select') {
        return `<label class="ask-field" for="${id}">${escapeHtml(field.label)}<select id="${id}" name="${escapeHtml(field.name)}"${required}>${
          (field.options || []).map((option) => `<option value="${escapeHtml(option.value)}"${option.value === field.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')
        }</select></label>`;
      }
      if (field.type === 'textarea') {
        return `<label class="ask-field" for="${id}">${escapeHtml(field.label)}<textarea id="${id}" name="${escapeHtml(field.name)}" rows="3" placeholder="${escapeHtml(field.placeholder || '')}"${required}>${escapeHtml(field.value || '')}</textarea></label>`;
      }
      return `<label class="ask-field" for="${id}">${escapeHtml(field.label)}<input id="${id}" name="${escapeHtml(field.name)}" type="text" value="${escapeHtml(field.value || '')}" placeholder="${escapeHtml(field.placeholder || '')}"${required}></label>`;
    };
    dialog.innerHTML = `<form class="ask-form">
      <h3>${escapeHtml(title)}</h3>
      ${message ? `<p class="ask-message">${escapeHtml(message)}</p>` : ''}
      ${fields.map(control).join('')}
      <div class="ask-actions"><button type="button" class="ghost-button" data-ask-cancel>取消</button><button type="submit" class="${danger ? 'danger-small' : 'primary-small'}">${escapeHtml(confirmLabel)}</button></div>
    </form>`;
    const form = dialog.querySelector('form');
    const finish = (value) => { dialog.removeEventListener('cancel', onCancel); if (dialog.open) dialog.close(); resolve(value); };
    const onCancel = (event) => { event.preventDefault(); finish(null); };
    dialog.addEventListener('cancel', onCancel);
    dialog.querySelector('[data-ask-cancel]').addEventListener('click', () => finish(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const answers = {};
      for (const field of fields) {
        const value = String(form.elements[field.name]?.value ?? '').trim();
        if (field.required && !value) { form.elements[field.name].focus(); return; }
        answers[field.name] = value;
      }
      finish(answers);
    });
    dialog.showModal();
    (dialog.querySelector('select, input, textarea') || dialog.querySelector('button[type="submit"]'))?.focus();
  });
}

async function controlBrowserRun(run, action, { after = null } = {}) {
  const confirmations = {
    REQUEST: `请求人工接管 ${run.id}`,
    FREEZE: `冻结自动化 ${run.id}`,
    TRANSFER: `转交人工 ${run.id}`,
    RELEASE_SAFE: `确认无付款动作并恢复 ${run.id}`,
    MARK_PAYMENT_UNKNOWN: `确认付款结果未知 ${run.id}`,
    CONFIRM_MANUAL_PAYMENT: `确认人工付款已完成 ${run.id}`,
    COMPLETE_20X: `确认20X升级完成 ${run.id}`,
    CANCEL: `取消接管 ${run.id}`
  };
  const warnings = {
    REQUEST: '请求人工接管同一个 Browser run？请求本身不会点击页面。',
    FREEZE: '冻结自动化页面操作？Worker 只允许维持租约和证据，不得继续输入。',
    TRANSFER: '确认自动化已经停手，并把同一个 run 转交给指定人工？',
    RELEASE_SAFE: '只有在确认人工没有点击、回车、提交表单、钱包或 3DS 最终确认时才能恢复自动化。',
    MARK_PAYMENT_UNKNOWN: '这会把 run、attempt 和订单锁为付款结果未知，只能对账，不能自动重付。',
    CONFIRM_MANUAL_PAYMENT: '仅在你已经亲手完成付款、并看到订阅生效后点击。系统会把这笔单记为人工付款成功、释放卡片占用，之后不会再自动付款；系统本身没有点击过付款，不会伪造自动付款记录。',
    COMPLETE_20X: '仅在你已经亲眼确认 20X 升级完成后点击；系统会把客户订单收口为充值成功。',
    CANCEL: '只允许取消尚未冻结的接管请求。'
  };
  const fieldsByAction = {
    REQUEST: [{
      name: 'reasonCode', label: '接管原因', type: 'select', value: 'OPERATOR_REVIEW', required: true,
      options: ['CAPTCHA', 'THREE_DS', 'PAGE_DRIFT', 'SESSION_REPAIR', 'OPERATOR_REVIEW', 'PAYMENT_RECONCILIATION'].map((value) => ({ value, label: value }))
    }],
    TRANSFER: [{ name: 'humanOwnerId', label: '人工操作者标识', type: 'text', value: 'admin', required: true }],
    CONFIRM_MANUAL_PAYMENT: [
      {
        name: 'manualOutcome', label: '人工付款结果', type: 'select', value: 'UPGRADED_20X', required: true,
        options: [
          { value: 'UPGRADED_20X', label: '20X：Plus 与 20X 均已完成，订单收口为成功' },
          { value: 'PLUS_ACTIVE', label: 'PLUS：只完成 Plus，等待人工升级 20X' }
        ]
      },
      { name: 'evidenceNote', label: '你看到的付款证据（金额、卡尾号、时间；不要输入完整卡号或安全码）', type: 'textarea', required: true }
    ]
  };
  const answers = await askForm({
    title: confirmations[action], message: warnings[action], fields: fieldsByAction[action] || [],
    confirmLabel: '确认执行', danger: ['FREEZE', 'MARK_PAYMENT_UNKNOWN'].includes(action)
  });
  if (!answers) return;
  const input = {
    action,
    operationId: `admin-browser:${action.toLowerCase()}:${crypto.randomUUID()}`,
    confirmation: confirmations[action]
  };
  if (action === 'REQUEST') input.reasonCode = answers.reasonCode.toUpperCase();
  if (action === 'TRANSFER') input.humanOwnerId = answers.humanOwnerId;
  if (action === 'CONFIRM_MANUAL_PAYMENT') {
    input.manualOutcome = answers.manualOutcome;
    input.evidenceNote = answers.evidenceNote;
  }
  await sensitiveApi(`/api/v1/admin/browser/runs/${encodeURIComponent(run.id)}/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  });
  showNotice(action === 'MARK_PAYMENT_UNKNOWN'
    ? '已锁为付款结果未知；只能进入资金证据核对，禁止重付。'
    : action === 'CONFIRM_MANUAL_PAYMENT'
      ? (input.manualOutcome === 'UPGRADED_20X'
        ? '人工付款与 20X 升级已记录，订单已收口为充值成功，卡片占用已释放。'
        : '人工 Plus 付款已记录，卡片占用已释放；20X 升级完成后再点“确认 20X 已升级”。')
      : 'Browser 控制权状态已更新。', 'success');
  if (after) { await after(); return; }
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
        ['付款后阶段', run.postPaymentState],
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
        .catch((error) => showNotice({
          reconcile_only: '检测到付款提交证据，只能进入对账，不能恢复自动化。',
          automation_still_active: '自动化租约仍在有效期内；等租约过期或先冻结自动化，再确认人工付款。',
          control_state_conflict: '当前 run 不在可执行该动作的状态；请刷新后核对付款、attempt 与订单状态。'
        }[error.message] || '控制权更新失败；原状态未改变。')));
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

async function loadCdkBatches() {
  const sequence = ++state.cdkLoadSequence;
  const query = new URLSearchParams({ limit: '50' });
  if (state.cdkBatchCursor) query.set('cursor', state.cdkBatchCursor);
  if (elements.cdkBatchPlan?.value) query.set('planType', elements.cdkBatchPlan.value);
  if (elements.cdkBatchStatus?.value) query.set('status', elements.cdkBatchStatus.value);
  if (elements.cdkBatchFrom?.value) query.set('fromDate', elements.cdkBatchFrom.value);
  if (elements.cdkBatchTo?.value) query.set('toDate', elements.cdkBatchTo.value);
  const payload = await api(`/api/v1/admin/cdks/batches?${query}`);
  if (sequence !== state.cdkLoadSequence) return;
  state.cdkBatchRows = state.cdkBatchCursor ? [...state.cdkBatchRows, ...payload.batches] : payload.batches;
  state.cdkBatchCursor = payload.nextCursor || null;
  elements.cdkBatches.innerHTML = state.cdkBatchRows.length
    ? state.cdkBatchRows.map((batch) => {
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
    : '<p class="empty-state">还没有符合条件的 CDK 批次</p>';
  if (elements.cdkBatchMore) elements.cdkBatchMore.hidden = !state.cdkBatchCursor;
  if (elements.cdkBatchPageInfo) elements.cdkBatchPageInfo.textContent = `${state.cdkBatchRows.length} 个批次${state.cdkBatchCursor ? ' · 还有更多' : ''}`;
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
    const payload = await api(`/api/v1/admin/cdks/${encodeURIComponent(batchNo)}/download`, {
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
    const payload = await api(`/api/v1/admin/cdks/${encodeURIComponent(batchNo)}/status-report`, {
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
    result = await api(`/api/v1/admin/cdks/${encodeURIComponent(batchNo)}/revoke`, {
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
    showNotice(`已作废 ${result.revokedCount} 个未使用 CDK，但批次列表刷新失败；请点“刷新批次列表”核对。`, 'warning');
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
  state.stockProvider = payload.provider || null;
  state.stockCatalog = payload.catalog || null;
  const summary = payload.operationalSummary || { ready: 0, inUse: 0, blocked: 0, retired: 0 };
  elements.stockSummary.innerHTML = [
    ['可分配', summary.ready], ['使用中', summary.inUse],
    ['暂不可用', summary.blocked], ['永久停用', summary.retired]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  elements.cardCapacity.value = String(payload.maxSuccessfulPayments || 3);
  state.minimumRequiredCardBalanceByPlan = payload.minimumRequiredCardBalanceByPlan || { plus: payload.minimumRequiredCardBalance };
  if (elements.minimumBalance && payload.minimumRequiredCardBalance != null) {
    const plan = elements.minimumBalancePlan?.value || 'plus';
    elements.minimumBalance.value = String(state.minimumRequiredCardBalanceByPlan[plan] ?? payload.minimumRequiredCardBalance);
  }
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
    <div><span>当前默认卡段</span><strong>${escapeHtml(provider.selectedCardType?.name || '未选择')}</strong></div>
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
  if (payload.cards?.length) {
    const groups = new Map();
    for (const card of payload.cards) { const key = `${card.providerAccountId || 'external'}:${card.providerLabel || '未知卡台'}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(card); }
    elements.stockCards.innerHTML = [...groups.values()].map((cards) => `<div class="mini-list-heading">${escapeHtml(cards[0].providerLabel || '未知卡台')} · ${cards.length} 张</div>${cards.map((card) => `${card.externalOnly ? '<div>' : `<div data-card="${escapeHtml(card.providerCardId)}" data-card-account="${escapeHtml(card.providerAccountId || '')}" role="button" tabindex="0">`}<span><strong>${escapeHtml(card.cardNumber || card.last4 || `卡台卡片 ${card.providerCardId}`)}</strong><small>${escapeHtml(card.reason || '当前不满足 Plus 安全分配条件')}${card.currentBalance != null ? ` · 余额 $${formatMoney(card.currentBalance)}` : ''}${card.publicNo ? ` · 订单 ${escapeHtml(card.publicNo)}` : ''}</small></span><em>${escapeHtml(STOCK_CATEGORY_LABELS[card.category] || card.category || '暂不可用')}</em></div>`).join('')}`).join('');
  } else elements.stockCards.innerHTML = '<p class="empty-state">还没有后台卡片</p>';
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
      if (!window.confirm(`接管批次 ${batchId} 中已通过验证的 ${ids.length} 张卡进入库存？`)) return;
      await sensitiveApi(`/api/v1/admin/card-intake/${encodeURIComponent(batchId)}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discoveryIds: ids })
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
    showNotice(`已加入 ${result.queued} 张卡的完整只读同步队列（资料、余额和交易）${result.alreadyActive ? `，${result.alreadyActive} 张正在同步` : ''}。`);
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
      <section class="detail-section"><div class="detail-section-heading"><h3>卡片状态</h3><button type="button" class="primary-small" id="sync-one-card">完整只读同步</button></div>${renderKeyValues([
        ['完整卡号', card.cardNumber || card.last4], ['卡台账户 ID', card.providerAccountId],
        ['卡台卡片 ID', card.providerCardId],
        ['卡段 ID', card.cardTypeId], ['卡片状态', card.status],
        ['有效运营状态', INVENTORY_LABELS[card.effectiveInventoryStatus] || card.effectiveInventoryStatus],
        ['运营限制', card.allocationReason || (card.allocationProductCode ? `仅限 ${card.allocationProductCode}` : '无')],
        ['原始库存状态', INVENTORY_LABELS[card.inventoryStatus] || card.inventoryStatus],
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


// 付款已成功但自动取消续费没被确认的单：运营亲自在账号里关掉续费后，在这里记录事实并收口。
async function confirmManualCancellation(publicNo, { after = null } = {}) {
  const answers = await askForm({
    title: `已在账号里取消续费 ${publicNo}`,
    message: '仅在你已经亲自在这个 ChatGPT 账号的订阅设置里关闭自动续费、并看到生效后确认。系统只记录这一事实并把订单收口为成功，不会再去问供应商或碰页面。',
    fields: [{ name: 'note', label: '备注（可选：账号邮箱、取消时间等）', type: 'text' }],
    confirmLabel: '确认已取消续费'
  });
  if (!answers) return;
  const result = await sensitiveApi(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}/cancellation-confirmed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: `已取消续费 ${publicNo}`, note: answers.note })
  });
  showNotice(result.replayed ? '该订单此前已记录为已取消续费。' : '已记录：自动续费已人工取消，订单收口为成功。', 'success');
  if (after) { await after(); return; }
  await openOrder(publicNo);
  await loadOrders();
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
    ? '确认开始接收新订单？\n\n新订单会自动分配库存卡；自动充值和对外扣款开关同时开启时，规则通过后会自动发起真实充值。'
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

async function setRechargeDispatch(button) {
  const currentlyEnabled = button.dataset.enabled === 'true';
  const enabled = !currentlyEnabled;
  const confirmation = enabled ? '开始自动充值' : '停止自动充值';
  const message = enabled
    ? '确认开始自动充值？\n\n只会处理符合规则且已接收的订单；已有资金风险或未知结果的订单不会自动重试。'
    : '确认停止自动充值？\n\n不会取消或停止已有订单的状态追踪。';
  if (!window.confirm(message)) return;
  button.disabled = true;
  try {
    await api('/api/v1/admin/operations/recharge-dispatch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, confirmation })
    });
    showNotice(enabled ? '已开始自动充值。' : '已停止自动充值，已有订单仍可继续追踪。');
    await loadOverview();
  } catch {
    showNotice('自动充值状态修改失败，原状态未改变。');
    button.disabled = false;
  }
}

async function setDefaultRechargeMethod(button) {
  const method = String(button.dataset.method || '').toUpperCase();
  if (!['API', 'BROWSER'].includes(method)) return;
  const label = method === 'API' ? 'API 充值' : '浏览器自动化充值';
  if (!window.confirm(`确认将默认充值方式切换为“${label}”？\n\n只影响切换后新建订单；已经创建或正在执行的订单不会改线。`)) return;
  button.disabled = true;
  try {
    await api('/api/v1/admin/operations/default-recharge-method', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, confirmation: `切换默认充值方式为 ${method}` })
    });
    showNotice(`默认充值方式已切换为${label}；只影响之后新建的订单。`, 'success');
    await loadOverview();
  } catch (error) {
    const messages = {
      browser_recharge_not_ready: 'Browser 执行器尚未就绪，默认充值方式没有改变。',
      default_recharge_route_unavailable: '对应充值路线不可用，默认充值方式没有改变。',
      default_recharge_method_confirmation_required: '确认信息不匹配，默认充值方式没有改变。'
    };
    showNotice(messages[error.message] || '默认充值方式切换失败，原设置未改变。');
    await loadOverview().catch(() => {});
  } finally {
    button.disabled = false;
  }
}


const TIMELINE_ACTION_LABELS = {
  'observe-page': '开始执行', 'session-bootstrap': '注入会话', 'session-replaced': '替换常驻会话', 'page-reset': '页面复位',
  'account-readonly-probe': '身份核对', 'page-signature': '页面签名', 'card-material-preflight': '卡资料就绪',
  'checkout-navigation': '创建结账', 'session-released': '释放登录态', 'fail-closed': '安全停止',
};
function timelineFacts(facts = {}) {
  const parts = [];
  if (facts.reason) parts.push(`原因 ${facts.reason}`);
  if (facts.previousReason) parts.push(`原会话 ${facts.previousReason}`);
  if (facts.plan) parts.push(`套餐 ${facts.plan}`);
  if (facts.checkoutCreated != null) parts.push(facts.checkoutCreated ? '已建新结账' : '沿用结账');
  if (facts.identityMatched != null) parts.push(facts.identityMatched ? '身份一致' : '身份不一致');
  if (facts.subscriptionStatus) parts.push(`套餐状态 ${facts.subscriptionStatus}`);
  if (facts.cookieCount != null) parts.push(`cookie ${facts.cookieCount}`);
  if (facts.clearedLoginCookieCount != null) parts.push(`清登录态 ${facts.clearedLoginCookieCount}`);
  if (facts.ready != null) parts.push(facts.ready ? '资料就绪' : '资料未就绪');
  return parts.join(' · ');
}
async function renderOrderTimeline(publicNo) {
  const host = elements.detailContent.querySelector('#order-timeline');
  if (!host) return;
  try {
    const data = await api(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}/timeline`);
    const events = Array.isArray(data.events) ? data.events : [];
    host.innerHTML = events.length
      ? `<ol class="timeline">${events.map((event) => `<li class="timeline-item timeline-${escapeHtml(event.type)}"><time>${escapeHtml(formatTime(event.at))}</time><strong>${escapeHtml(TIMELINE_ACTION_LABELS[event.action] || event.action || event.type)}</strong><small>${escapeHtml([event.jobKind === 'preflight' ? '预检' : event.jobKind === 'run' ? '执行' : '', event.workerId || '', timelineFacts(event.facts)].filter(Boolean).join(' · '))}</small></li>`).join('')}</ol>`
      : '<p class="empty-state">还没有 Browser 执行记录。</p>';
  } catch { host.innerHTML = '<p class="empty-state">执行时间线读取失败。</p>'; }
}
async function openOrder(publicNo) {
  elements.detailKicker.textContent = '订单';
  elements.detailTitle.textContent = publicNo;
  elements.detailContent.innerHTML = '<p class="loading-state">正在读取订单详情…</p>';
  if (!elements.detail.open) elements.detail.showModal();
  try {
    const data = await api(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}`);
    const order = data.order;
    const stage = data.stage || {};
    const run = data.browserRun || null;
    const controlRun = run ? { ...run, publicNo, worker: { id: run.workerId, leaseUntil: run.leaseUntil } } : null;
    const gate = data.paymentGate || {};
    const money = data.money || { attempts: [], ledger: [], operations: [] };
    const cases = data.reconciliationCases || [];
    const openCases = cases.filter((item) => item.status !== 'RESOLVED');
    const trace = data.traceability || {};
    const cost = trace.fulfillmentCost || {};
    const cancellation = data.cancellation || {};
    const reconciliation = data.reconciliation || {};
    const runLive = controlRun && ['READY', 'RUNNING', 'HUMAN_REQUIRED'].includes(controlRun.status);
    const moneyList = (items) => items?.length
      ? items.map((item) => `${item.amount} ${item.currency}`).join('；') : '没有已记录金额';
    const actions = [];
    if (cancellation.eligible) actions.push('<button type="button" class="danger-small" id="cancel-order">取消并释放卡</button>');
    if (order.cancellationReviewRequired === 1 || order.status === 'CANCELLATION_REVIEW_REQUIRED') {
      actions.push('<button type="button" class="primary-small" id="confirm-manual-cancellation">已在账号里取消续费</button>');
    }
    if (runLive && manualPaymentEligible(controlRun)) actions.push('<button type="button" class="primary-small" data-order-run-control="CONFIRM_MANUAL_PAYMENT">人工付款已完成</button>');
    if (runLive && upgradeConfirmEligible(controlRun)) actions.push('<button type="button" class="primary-small" data-order-run-control="COMPLETE_20X">确认 20X 已升级</button>');
    if (data.card) actions.push('<button type="button" class="ghost-button" id="sync-transactions">同步卡交易</button>');
    openCases.forEach((item) => actions.push(`<button type="button" class="ghost-button" data-resolve-order-case="${escapeHtml(item.id)}">关闭对账案例：${escapeHtml(RECONCILIATION_TYPE_LABELS[item.caseType] || item.caseType)}</button>`));
    const cancellationLabels = {
      ORDER_CANCELLATION_ELIGIBLE: '可以安全取消：付款未提交，卡片解除绑定并进入隔离区',
      ORDER_CANCELLATION_ALREADY_COMPLETED: '订单已经取消',
      ORDER_CANCELLATION_REVIEW_REQUIRED: '订单或卡片关系不完整，需要人工核对后才能取消',
      ORDER_CANCELLATION_SUBMISSION_RISK: '付款可能已经开始，禁止取消',
      ORDER_CANCELLATION_NOT_ELIGIBLE: ''
    };
    elements.detailContent.innerHTML = `
      <section class="detail-section drawer-summary">
        <div class="detail-status">${stageChip(stage)}<span>${escapeHtml(productLabel(order))} · 创建 ${formatTime(order.createdAt)}</span></div>
        <p class="${stage.action ? 'drawer-action-line' : 'empty-state'}">${escapeHtml(stage.action || '当前不需要人工动作')}</p>
        <div class="drawer-actions">${actions.join('') || '<small>没有可执行的动作</small>'}</div>
        ${cancellationLabels[cancellation.code] ? `<small class="drawer-hint">${escapeHtml(cancellationLabels[cancellation.code])}</small>` : ''}
      </section>
      <section class="detail-section"><div class="detail-section-heading"><h3>执行时间线</h3></div><div id="order-timeline"><p class="loading-state">正在读取…</p></div></section>
      <section class="detail-section"><h3>资金与结果</h3>${renderKeyValues([
        ['对账结论', ORDER_RECONCILIATION_LABELS[reconciliation.status] || reconciliation.status],
        ['判定依据', ORDER_RECONCILIATION_CODES[reconciliation.code] || reconciliation.code],
        ['许可', PERMIT_LABELS[gate.permitStatus] || gate.permitStatus || '—'],
        ['资金栅栏', gate.fundsRiskState || '—'],
        ['外部订单号', order.rechargeOrderNo],
        ['确认金额', order.actualPaymentAmount ? `${order.actualPaymentAmount} ${order.actualPaymentCurrency || ''}` : null],
        ['自动续费', order.subscriptionCancelled === 1 ? '已取消' : order.cancellationReviewRequired ? '需要人工处理' : order.subscriptionCancelled === 0 ? '等待确认' : '未开始'],
        ['卡片交易同步', formatTime(data.card?.lastTransactionSyncedAt)]
      ])}
        <p class="mini-list-heading">付款尝试</p><div class="mini-list">${money.attempts?.length ? money.attempts.map((item) => `<div><span><strong>${escapeHtml(item.executorKind || '—')} · ${escapeHtml(ATTEMPT_STATUS_LABELS[item.status] || item.status)} · 资金 ${escapeHtml(item.fundsRiskState || '—')}</strong><small>${escapeHtml(item.id)}${item.externalOrderId ? ` · 外部 ${escapeHtml(item.externalOrderId)}` : ''} · 意图 ${formatTime(item.submitIntentAt)} · 提交 ${formatTime(item.submittedAt)} · 结束 ${formatTime(item.finishedAt)}</small></span></div>`).join('') : '<p class="empty-state">没有付款尝试</p>'}</div>
        <p class="mini-list-heading">消费账本</p><div class="mini-list">${money.ledger?.length ? money.ledger.map((item) => `<div><span><strong>${escapeHtml(LEDGER_STATUS_LABELS[item.status] || item.status)} · ${escapeHtml(item.amount || '—')} ${escapeHtml(item.currency || '')}</strong><small>占用 ${formatTime(item.reservedAt)} · 消费 ${formatTime(item.consumedAt)} · 释放 ${formatTime(item.releasedAt)}${item.releaseReason ? ` · ${escapeHtml(item.releaseReason)}` : ''}${item.providerTransactionId ? ` · 交易 ${escapeHtml(item.providerTransactionId)}` : ''}</small></span></div>`).join('') : '<p class="empty-state">没有账本记录</p>'}</div>
        <p class="mini-list-heading">付款操作</p><div class="mini-list">${money.operations?.length ? money.operations.map((item) => `<div><span><strong>${escapeHtml(item.type)} · ${escapeHtml(item.status)}</strong><small>${escapeHtml(item.resultCode || '—')} · Run ${escapeHtml(item.runId)} · ${formatTime(item.completedAt || item.preparedAt)}</small>${item.upgradeDialog ? `<small class="${item.upgradeDialog.reason ? 'attention-note' : ''}">${item.upgradeDialog.reason ? `升级弹窗未打开：${escapeHtml(item.upgradeDialog.reason)}` : `升级弹窗已停在 Pay now 前：今日应付 ${escapeHtml(item.upgradeDialog.totalDueToday || '—')}（订阅 ${escapeHtml(item.upgradeDialog.subscriptionAmount || '—')}，抵扣 ${escapeHtml(item.upgradeDialog.adjustmentAmount || '—')}）· 卡 ${escapeHtml(item.upgradeDialog.paymentMethod?.brand || '')} 尾号 ${escapeHtml(item.upgradeDialog.paymentMethod?.last4 || '—')}`}${item.upgradeDialog.recoveryStep ? ` · 会话恢复：${escapeHtml(item.upgradeDialog.recoveryStep)}` : ''}</small>` : ''}</span></div>`).join('') : '<p class="empty-state">系统没有点击过付款</p>'}</div>
        ${cases.length ? `<p class="mini-list-heading">对账案例</p><div class="mini-list">${cases.map((item) => `<div><span><strong>${escapeHtml(RECONCILIATION_TYPE_LABELS[item.caseType] || item.caseType)} · ${escapeHtml(RECONCILIATION_STATUS_LABELS[item.status] || item.status)}</strong><small>${escapeHtml(RECONCILIATION_SEVERITY_LABELS[item.severity] || item.severity)} · 发现 ${formatTime(item.detectedAt)}${item.resolutionNote ? ` · ${escapeHtml(item.resolutionNote)}` : ''}</small></span></div>`).join('')}</div>` : ''}
      </section>
      <section class="detail-section"><h3>客户与会话</h3>${renderKeyValues([
        ['客户邮箱', order.customerEmail], ['ChatGPT 账号 ID', order.chatgptAccountId],
        ['Session', gate.sessionValid ? '有效' : `不可用（${gate.sessionCode || '未知原因'}）`],
        ['Access Token 到期', formatTime(gate.accessTokenExpiresAt)],
        ['打回原因', CUSTOMER_ACTION_LABELS[order.customerActionCode] || order.customerActionCode],
        ['开始等待重贴', formatTime(order.sessionRepairStartedAt)],
        ['重贴次数', order.sessionReplacementCount || 0],
        ['最近重贴', formatTime(order.lastSessionReplacedAt)],
        ['失败代码', order.failureCode],
        [order.failureReasonSource === 'PROVIDER_ATTEMPT' ? 'Provider 返回原因' : '失败原因', order.failureReason]
      ])}
        <p class="mini-list-heading">重贴记录</p><div class="mini-list">${trace.sessionReplacements?.length ? trace.sessionReplacements.map((replacement) => `<div><span><strong>第 ${replacement.replacementNo} 次 · ${escapeHtml(replacement.reasonCode || '客户重新提交')}</strong><small>${escapeHtml(replacement.previousCustomerEmail || replacement.previousChatgptAccountId || '原账号未识别')} → ${escapeHtml(replacement.newCustomerEmail || replacement.newChatgptAccountId || '新账号未识别')} · ${formatTime(replacement.createdAt)}</small></span></div>`).join('') : '<p class="empty-state">没有重贴记录</p>'}</div>
        <p class="mini-list-heading">CDK</p><div class="mini-list">${trace.cdks?.length ? trace.cdks.map((cdk) => `<div><span><strong>${escapeHtml(cdk.relationship === 'REPLACEMENT' ? '补发 CDK' : 'CDK')} · ${escapeHtml(cdk.status)}</strong><small>批次 ${escapeHtml(cdk.batchId || '—')} · 兑换 ${formatTime(cdk.redeemedAt)}${cdk.redeemedOrderPublicNo ? ` · 订单 ${escapeHtml(cdk.redeemedOrderPublicNo)}` : ''}</small></span>${cdk.redeemedOrderPublicNo && cdk.redeemedOrderPublicNo !== publicNo ? `<button type="button" class="text-button" data-related-order="${escapeHtml(cdk.redeemedOrderPublicNo)}">打开后续订单</button>` : ''}</div>`).join('') : '<p class="empty-state">没有 CDK 关系记录</p>'}</div>
      </section>
      <section class="detail-section"><h3>卡片</h3>${data.card ? renderKeyValues([
        ['卡号', data.card.cardNumber || data.card.last4], ['卡台卡片 ID', data.card.providerCardId],
        ['卡片状态', INVENTORY_LABELS[data.card.status] || data.card.status],
        ['当前余额', `${formatMoney(data.card.currentBalance)} ${data.card.currency || ''}`],
        ['开卡金额', `${formatMoney(data.card.fundedAmount)} ${data.card.currency || ''}`],
        ['最后同步', formatTime(data.card.lastSyncedAt)]
      ]) : '<p class="empty-state">尚未绑定卡片</p>'}</section>
      <section class="detail-section"><h3>身份与运行</h3>${run ? renderKeyValues([
        ['身份', identityLabel(run)], ['执行档案', run.profileCode],
        ['运行状态', BROWSER_RUN_LABELS[run.status] || run.status],
        ['付款状态', BROWSER_PAYMENT_LABELS[run.paymentState] || run.paymentState],
        ['控制权', BROWSER_CONTROL_LABELS[run.controlState] || run.controlState],
        ['最近检查点', run.lastCheckpointKind], ['最近错误', run.lastErrorCode],
        ['Worker', run.workerId], ['租约到期', formatTime(run.leaseUntil)]
      ]) + `<p class="empty-state"><button type="button" class="text-button" data-open-run="${escapeHtml(run.id)}">打开 Browser 运行详情</button></p>` : '<p class="empty-state">尚未创建浏览器运行</p>'}</section>
      <details class="detail-evidence"><summary>技术证据（事件、任务、分配、客户付款、交易）</summary>
        <section class="detail-section"><h3>状态事件</h3><div class="timeline">${data.events.length ? data.events.map((event) => `<article><i></i><div><strong>${escapeHtml(STATUS_META[event.toStatus]?.[0] || event.toStatus)}</strong><p>${escapeHtml(event.reason)}</p><small>${formatTime(event.createdAt)} · ${escapeHtml(event.actorType)}</small></div></article>`).join('') : '<p class="empty-state">暂无事件</p>'}</div></section>
        <section class="detail-section"><h3>后台任务</h3><div class="mini-list">${data.tasks.length ? data.tasks.map((task) => `<div><span><strong>${escapeHtml(TASK_LABELS[task.type] || task.type)}</strong><small>${task.attempts}/${task.maxAttempts} 次尝试${task.lastErrorCode ? ` · ${escapeHtml(task.lastErrorCode)}` : ''}</small></span><em>${escapeHtml(TASK_STATUS_LABELS[task.status] || task.status)}</em></div>`).join('') : '<p class="empty-state">暂无任务</p>'}</div></section>
        <section class="detail-section"><h3>卡片分配历史</h3><div class="mini-list">${trace.cardAssignments?.length ? trace.cardAssignments.map((assignment) => `<div data-trace-card="${escapeHtml(assignment.providerCardId)}" data-trace-card-account="${escapeHtml(assignment.providerAccountId || '')}" role="button" tabindex="0"><span><strong>尾号 ${escapeHtml(assignment.last4 || assignment.providerCardId)} · ${escapeHtml(assignment.kind)}</strong><small>分配 ${formatTime(assignment.assignedAt)}${assignment.releasedAt ? ` · 释放 ${formatTime(assignment.releasedAt)}` : ' · 当前绑定'} · ${escapeHtml(assignment.assignmentReason || assignment.releaseReason || '')}</small></span><em>${escapeHtml(assignment.status)}</em></div>`).join('') : '<p class="empty-state">尚无卡片分配历史</p>'}</div></section>
        <section class="detail-section"><h3>客户付款与履约成本（原币种）</h3>${renderKeyValues([
          ['客户付款', moneyList(cost.customerPayments)],
          ['卡片开卡/入金', moneyList(cost.cardFundedAmount)],
          ['平台确认支付', moneyList(cost.providerConfirmedPayment)],
          ['卡片成功消费', moneyList(cost.successfulCardPurchases)],
          ['卡片交易手续费', moneyList(cost.cardTransactionFees)]
        ])}<div class="mini-list">${trace.customerPayments?.length ? trace.customerPayments.map((payment) => `<div><span><strong>客户付款 · ${escapeHtml(payment.status)} · ${escapeHtml(payment.amount || '金额未记录')} ${escapeHtml(payment.currency || '')}</strong><small>${escapeHtml(payment.channel)} · ${escapeHtml(payment.externalReference || '无外部参考号')} · ${payment.paidAt ? `实际付款 ${formatTime(payment.paidAt)}` : `确认记录 ${formatTime(payment.createdAt)}`}</small></span>${payment.amount == null ? '<button type="button" class="text-button" data-complete-customer-payment>补录付款</button>' : ''}</div>`).join('') : '<p class="empty-state">客户在系统外付款；尚未补录付款金额</p>'}</div></section>
        <section class="detail-section"><h3>卡片交易</h3><div class="mini-list">${data.transactions?.length ? data.transactions.map((transaction) => `<div><span><strong>${escapeHtml(transaction.type)} · ${escapeHtml(transaction.amount)} ${escapeHtml(transaction.currency)}</strong><small>${escapeHtml(transaction.merchantName || transaction.relatedTransactionId || transaction.providerTransactionId)} · ${escapeHtml(transaction.tradeTimeRaw || formatTime(transaction.firstSeenAt))}</small></span><em>${escapeHtml(transaction.status)}</em></div>`).join('') : '<p class="empty-state">暂无已同步交易</p>'}</div></section>
      </details>`;
    renderOrderTimeline(publicNo);
    const reopen = () => openOrder(publicNo);
    document.querySelector('#sync-transactions')?.addEventListener('click', (event) => requestTransactionSync(publicNo, event.currentTarget));
    document.querySelector('#cancel-order')?.addEventListener('click', (event) => cancelOrder(publicNo, event.currentTarget));
    document.querySelector('#confirm-manual-cancellation')?.addEventListener('click', () => confirmManualCancellation(publicNo, { after: reopen })
      .catch((error) => showNotice(error?.message === 'manual_cancellation_not_eligible' ? '该订单当前不能这样收口。' : '没有记录，订单没有改变。')));
    elements.detailContent.querySelectorAll('[data-order-run-control]').forEach((button) => {
      button.addEventListener('click', () => controlBrowserRun(controlRun, button.dataset.orderRunControl, { after: reopen })
        .catch(() => showNotice('操作没有完成，订单没有改变。')));
    });
    elements.detailContent.querySelectorAll('[data-resolve-order-case]').forEach((button) => {
      button.addEventListener('click', () => resolveReconciliationCase(button.dataset.resolveOrderCase, { after: reopen })
        .catch(() => showNotice('对账案例没有关闭。')));
    });
    elements.detailContent.querySelector('[data-open-run]')?.addEventListener('click', (event) => openBrowserRun(event.currentTarget.dataset.openRun));
    elements.detailContent.querySelectorAll('[data-trace-card]').forEach((item) => {
      item.addEventListener('click', () => openCard(item.dataset.traceCard, item.dataset.traceCardAccount));
    });
    elements.detailContent.querySelectorAll('[data-related-order]').forEach((button) => {
      button.addEventListener('click', () => openOrder(button.dataset.relatedOrder));
    });
    elements.detailContent.querySelector('[data-complete-customer-payment]')?.addEventListener('click', async () => {
      const answers = await askForm({
        title: `补录客户付款 ${publicNo}`,
        message: '记录客户实际付给我们的款项（不是我们付给 ChatGPT 的）。外部参考号只保存 HMAC 和尾号。',
        fields: [
          { name: 'amount', label: '客户实际付款金额', type: 'text', required: true, placeholder: '例如 168.00' },
          { name: 'currency', label: '付款币种', type: 'text', value: 'CNY', required: true },
          { name: 'channel', label: '付款渠道', type: 'select', value: 'ALIPAY', required: true,
            options: [{ value: 'ALIPAY', label: '支付宝 ALIPAY' }, { value: 'WECHAT', label: '微信 WECHAT' }, { value: 'OTHER', label: '其他 OTHER' }] },
          { name: 'paidAt', label: '实际付款时间（必须含时区，例如 2026-08-21T12:30:00+08:00）', type: 'text', required: true },
          { name: 'externalReference', label: '外部交易参考号（可留空）', type: 'text' }
        ],
        confirmLabel: '补录'
      });
      if (!answers) return;
      await sensitiveApi(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}/customer-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: answers.amount, currency: answers.currency, channel: answers.channel, paidAt: answers.paidAt, externalReference: answers.externalReference || '' })
      });
      showNotice('客户付款详情已补录。', 'success');
      await openOrder(publicNo);
    });
  } catch {
    elements.detailContent.innerHTML = '<p class="empty-state">订单详情读取失败，请稍后重试。</p>';
  }
}

function setActiveNav(navId) {
  state.nav = navId;
  elements.navItems.forEach((item) => item.classList.toggle('is-active', item.dataset.view === navId));
}

async function loadDiagnostics() {
  const overview = await api('/api/v1/admin/overview');
  renderReadiness(overview.readiness, elements.diagnosticsReadiness);
  const runtime = overview.runtimeHealth || {};
  const provider = overview.providerHealth || {};
  const decisions = overview.decisions || {};
  elements.diagnosticsHeartbeat.innerHTML = `
    <div><span>API Worker 心跳</span><strong>${runtime.workerHealthy ? '在线' : '离线'}</strong><small>${formatTime(runtime.workerHeartbeatAt)}</small></div>
    <div><span>Browser Worker 心跳</span><strong>${provider.browserRechargeReady ? '在线且可派发' : '未就绪'}</strong><small>${formatTime(provider.browserWorkerHeartbeatAt)}</small></div>
    <div><span>过期任务租约</span><strong>${runtime.expiredTaskLeases ?? 0}</strong></div>
    <div><span>卡住的卡台调用</span><strong>${runtime.stalledProviderCalls ?? 0}</strong></div>
    <div><span>浏览器真实付款</span><strong>${decisions.browserPaymentWritesEnabled ? '已开启' : '关闭'}</strong><small>profile ${decisions.browserProfileWritesEnabled ? '允许写' : '只读'}</small></div>
    <div><span>Worker 直充写权限</span><strong>${runtime.rechargeWritesEnabled ? '已开启' : '关闭'}</strong></div>`;
}

async function switchView(view, { status = '' } = {}) {
  setActiveNav(view);
  state.view = view;
  state.status = status;
  state.page = 1;
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
    elements.viewKicker.textContent = '卡片';
    elements.viewTitle.textContent = '库存、卡台、导入、补钱';
    await Promise.all([loadStock(), loadProviderRoutes(), loadCardFundingAttempts()]);
  } else if (view === 'diagnostics') {
    elements.viewKicker.textContent = '诊断';
    elements.viewTitle.textContent = '低频、只读为主';
    await Promise.all([loadDiagnostics(), loadReconciliationCases(), loadBrowserDispatchJobs(), loadBrowserRuns(), loadBillingAddressSettings()]);
  } else {
    elements.viewKicker.textContent = '订单';
    elements.viewTitle.textContent = ORDER_FILTER_TITLES[state.status] || '全部订单';
    elements.statusFilter.value = state.status;
    await loadOrders();
  }
}

function sourceHealth(source) {
  if (!source.operationalEnabled) return ['运营标记停用（仍可选择）', 'status-red'];
  if (source.providerCode === 'manual_excel' && !source.lastFullSnapshotAt) return ['尚未导入完整快照', 'status-orange'];
  if (source.circuitState && source.circuitState !== 'CLOSED') return [`熔断 ${source.circuitState}（仍可选择）`, 'status-red'];
  return ['当前无告知性异常', 'status-green'];
}

async function loadProviderRoutes() {
  const [payload, estimate] = await Promise.all([
    api('/api/v1/admin/card-sources'),
    api('/api/v1/admin/card-sources/browser/takeover-estimate')
  ]);
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  elements.cardSourceSummary.innerHTML = `<div><span><strong>API 充值固定卡台</strong><small>不可切换到无 API 的备用来源</small></span><em>${escapeHtml(sources.find((item) => item.id === payload.apiProviderAccountId)?.displayName || 'HNSKJ')}</em></div><div><span><strong>浏览器自动化充值当前卡台</strong><small>切换默认只影响新订单</small></span><em>${escapeHtml(sources.find((item) => item.id === payload.browserProviderAccountId)?.displayName || '未设置')}</em></div>`;
  elements.manualCardImportSource.innerHTML = `<option value="">选择备用卡台</option>${sources.filter((item) => item.providerCode === 'manual_excel').map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.displayName)}</option>`).join('')}`;
  elements.providerRoutesTable.innerHTML = sources.length ? sources.map((source) => {
    const [health, tone] = sourceHealth(source);
    const active = source.id === payload.browserProviderAccountId;
    const capabilities = [source.supportsApiRecharge ? 'API 充值' : null, source.supportsBrowserRecharge ? 'Browser' : null, source.supportsApiSync ? 'API 同步' : '完整快照', source.supportsAutoOpen ? '自动开卡' : null, source.supportsAutoFunding ? '自动补余额' : null].filter(Boolean).join(' · ');
    return `<tr>
      <td><strong class="cell-main">${escapeHtml(source.displayName)}</strong><small>${escapeHtml(source.accountCode)} · ${escapeHtml(source.providerCode)}</small></td>
      <td>${escapeHtml(capabilities)}</td>
      <td>${source.cardCount} 张历史卡 · ${source.presentCount} 张在当前快照<small>最近完整快照 ${formatTime(source.lastFullSnapshotAt)}</small></td>
      <td><span class="status-chip ${tone}"><i></i>${escapeHtml(health)}</span></td>
      <td>${!source.supportsBrowserRecharge ? '<small>不支持 Browser</small>' : active ? '<small>Browser 新订单使用中</small>' : `<span class="segmented-actions"><button class="primary-small route-switch-button" type="button" data-source-id="${escapeHtml(source.id)}">设为当前</button>${Number(estimate.count || 0) ? `<button class="ghost-button route-switch-button" type="button" data-source-id="${escapeHtml(source.id)}" data-takeover="true">同时接管 ${Number(estimate.count)} 单</button>` : ''}</span>`}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="empty-state">暂无卡台配置</td></tr>';
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
  const actionLabel = button.dataset.action === 'SETTLED' ? '已扣款' : '未扣款';
  // Server still checks the literal word; the dialog above is the one confirmation.
  const confirmation = `确认卡充值对账 ${attemptId}`;
  const note = (await askForm({
    title: `卡充值对账 ${attemptId}`,
    message: `把这次卡充值尝试记为「${actionLabel}」。只保存结论，不会自动重充或退款。`,
    fields: [{ name: 'note', label: '对账依据（至少 10 个字符）', type: 'textarea', required: true }],
    confirmLabel: '保存结论'
  }))?.note;
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

elements.navItems.forEach((item) => item.addEventListener('click', () => switchView(item.dataset.view).catch(() => showNotice('数据读取失败，请稍后重试。'))));
document.querySelectorAll('[data-open-orders]').forEach((button) => button.addEventListener('click', () => switchView('orders')));
elements.metrics.addEventListener('click', (event) => {
  const filterButton = event.target.closest('[data-order-filter]');
  const viewButton = event.target.closest('[data-target-view]');
  if (filterButton) switchView('orders', { status: filterButton.dataset.orderFilter });
  else if (viewButton) switchView(viewButton.dataset.targetView);
});
elements.filters.addEventListener('submit', (event) => {
  event.preventDefault();
  state.page = 1;
  state.query = elements.search.value.trim();
  state.status = elements.statusFilter.value;
  if (state.nav !== 'orders') setActiveNav('orders');
  elements.viewKicker.textContent = '订单';
  elements.viewTitle.textContent = ORDER_FILTER_TITLES[state.status] || '全部订单';
  loadOrders().catch(() => showNotice('订单查询失败，请稍后重试。'));
});
elements.prevPage.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadOrders(); } });
elements.nextPage.addEventListener('click', () => { if (state.page * state.pageSize < state.total) { state.page += 1; loadOrders(); } });
document.querySelector('#export-orders')?.addEventListener('click', () => downloadOperationsCsv('orders').catch(() => showNotice('订单导出失败。')));
document.querySelector('#export-reconciliation')?.addEventListener('click', () => downloadOperationsCsv('reconciliation_cases').catch(() => showNotice('对账案例导出失败。')));
document.querySelector('#export-reconciliation-diag')?.addEventListener('click', () => downloadOperationsCsv('reconciliation_cases').catch(() => showNotice('对账案例导出失败。')));
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
async function loadBillingAddressSettings() {
  const data = await api('/api/v1/admin/browser/billing-address');
  const enabled = document.querySelector('#billing-address-enabled');
  const state = document.querySelector('#billing-address-state');
  const name = document.querySelector('#billing-address-name');
  if (!enabled) return;
  enabled.value = data.enabled ? 'true' : 'false'; state.value = data.state || 'DE'; name.value = '';
  document.querySelector('#billing-address-meta').textContent = `${data.source} · ${data.sourceVersion}${data.nameConfigured ? ' · 姓名已配置' : ' · 尚未配置姓名'}`;
}
async function saveBillingAddressSettings(event) {
  event.preventDefault();
  const enabled = document.querySelector('#billing-address-enabled').value === 'true';
  const state = document.querySelector('#billing-address-state').value;
  const name = document.querySelector('#billing-address-name').value.trim();
  const confirmation = '确认更新账单地址设置';
  await api('/api/v1/admin/browser/billing-address', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, state, name, confirmation }) });
  await loadBillingAddressSettings(); showNotice('账单地址设置已保存。', 'success');
}
document.querySelector('#billing-address-settings')?.addEventListener('submit', (event) => saveBillingAddressSettings(event).catch((e) => showNotice(e.message || '保存失败。')));

elements.browserFilters?.addEventListener('submit', (event) => {
  event.preventDefault();
  state.browserPage = 1;
  Promise.all([loadBrowserDispatchJobs(), loadBrowserRuns()])
    .catch(() => showNotice('Browser 队列或运行记录读取失败。'));
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
  button.disabled = true;
  try {
    const result = await api('/api/v1/admin/card-sources/browser/current', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerAccountId: button.dataset.sourceId, takeoverWaiting: button.dataset.takeover === 'true' })
    });
    showNotice(`Browser 卡台已切换${result.actualTakeoverCount ? `，并安全接管 ${result.actualTakeoverCount} 单` : '；只影响之后的新订单'}${result.warnings?.length ? '。目标来源当前有提醒，请在卡台管理中查看' : ''}。`, 'success');
    try {
      await loadProviderRoutes();
    } catch {
      showNotice('Browser 卡台已切换，但列表刷新失败；请刷新查看，不要重复切换。', 'warning');
    }
  } catch (error) {
    showNotice('未能确认卡台切换结果，正在重新读取当前选择；请勿重复点击。', 'warning');
    await loadProviderRoutes().catch(() => {});
  } finally {
    button.disabled = false;
  }
});
elements.manualCardSourceForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await sensitiveApi('/api/v1/admin/card-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountCode: elements.manualCardSourceCode.value.trim(), displayName: elements.manualCardSourceName.value.trim() }) });
    elements.manualCardSourceForm.reset(); showNotice('备用卡台已新增。', 'success'); await loadProviderRoutes();
  } catch (error) { showNotice(error.message || '新增备用卡台失败。'); }
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
    if (state.view === 'cdks') resetCdkBatchPaging();
    await (state.view === 'overview' ? loadOverview()
    : state.view === 'stock' ? loadStock()
      : state.view === 'cdks' ? loadCdkBatches()
        : state.view === 'diagnostics' ? Promise.all([loadDiagnostics(), loadReconciliationCases(), loadBrowserDispatchJobs(), loadBrowserRuns(), loadBillingAddressSettings()])
          : loadOrders());
    showNotice('刷新完成。', 'success');
  } catch {
    showNotice('刷新失败，请稍后重试。');
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.textContent = '刷新当前页';
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
document.querySelector('#refresh-stock')?.addEventListener('click', async () => {
  try {
    await loadStock();
    showNotice('本地列表已刷新（未同步卡台）。', 'success');
  } catch { showNotice('库存读取失败。'); }
});
elements.startBusiness?.addEventListener('click', async (event) => {
  const button = event.currentTarget; button.disabled = true;
  try {
    const result = await api('/api/v1/admin/operations/start-business', { method: 'POST' });
    renderReadiness(result.readiness);
    showNotice(result.readiness?.status === 'AUTO_HEAL'
      ? '已开始营业；当前补给会在首个订单到达时自动处理。'
      : '只读检查通过，已开始接收新订单并自动派发。', 'success');
    await loadOverview();
  } catch (error) {
    if (error?.payload?.readiness) renderReadiness(error.payload.readiness);
    const firstBlocker = error?.payload?.readiness?.checks?.find((item) => item.status === 'BLOCKED');
    showNotice(firstBlocker?.message || '开始营业失败：请按就绪卡片提示处理。');
  } finally { button.disabled = false; }
});
elements.refreshCardProviderRules?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('/api/v1/admin/card-stock/provider-refresh', { method: 'POST' });
    showNotice('卡段规则已人工刷新。', 'success');
    await loadStock();
  } catch { showNotice('卡段规则刷新失败。'); }
  finally { button.disabled = false; }
});
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
  api('/api/v1/admin/card-stock/default-card-type', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardTypeId: state.stockCardTypeId })
  }).then(() => showNotice('默认卡段已保存。', 'success'))
    .catch(() => showNotice('默认卡段保存失败。'));
});
elements.cardCapacityForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/v1/admin/card-stock/max-successful-payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: Number(elements.cardCapacity.value) })
    });
    showNotice('每张卡的成功充值次数上限已更新，只影响后续分配。', 'success');
    await loadStock();
  } catch (error) { showNotice(error.message); }
});
elements.minimumBalancePlan?.addEventListener('change', () => {
  const plan = elements.minimumBalancePlan.value;
  const value = state.minimumRequiredCardBalanceByPlan?.[plan];
  if (value != null) elements.minimumBalance.value = String(value);
});
elements.minimumBalanceForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const amount = Number(elements.minimumBalance.value);
  const planType = elements.minimumBalancePlan?.value || 'plus';
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000) return showNotice('最低余额必须是 0 到 1000 之间的金额。');
  try {
    await api('/api/v1/admin/card-stock/minimum-balance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(amount * 100) / 100, planType })
    });
    showNotice(`${{ plus: 'Plus', pro_5x: 'Pro 5X', pro_20x: 'Pro 20X' }[planType]} 的最低所需卡余额已更新，只影响之后的分配。`, 'success');
    await loadStock();
  } catch (error) { showNotice(error.message === 'invalid_minimum_balance' ? '金额无效，最多两位小数。' : '保存失败，请稍后重试。'); }
});
elements.stockOpenForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const count = Number(elements.stockOpenCount.value);
  const amount = Number(elements.stockOpenAmount.value);
  const cardTypeId = state.stockCardTypeId;
  const cardTypeName = selectedStockCardType()?.name || `卡段 ${cardTypeId}`;
  // Server still validates the literal `开N张` word; the dialog below is the one confirmation.
  const expected = `开${count}张`;
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
          : state.view === 'diagnostics'
            ? () => Promise.all([loadReconciliationCases(), loadBrowserDispatchJobs(), loadBrowserRuns()]) : null;
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
  const planType = elements.cdkPlan?.value || 'plus';
  const storedRequest = JSON.parse(sessionStorage.getItem('cdk-generation-request') || 'null');
  const requestKey = storedRequest?.count === count && (storedRequest.planType || 'plus') === planType
    ? storedRequest.key : crypto.randomUUID();
  sessionStorage.setItem('cdk-generation-request', JSON.stringify({ count, planType, key: requestKey }));
  let payload;
  try {
    payload = await api('/api/v1/admin/cdks/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
      body: JSON.stringify({ count, planType })
    });
    elements.generatedCdks.value = payload.codes.join('\n');
    elements.generatedCdks.rows = Math.min(Math.max(payload.codes.length, 3), 18);
    elements.cdkBatchLabel.textContent = `批次 ${payload.batchNo} · ${payload.count} 个`;
    elements.cdkResult.hidden = false;
    sessionStorage.removeItem('cdk-generation-request');
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
    showNotice(`批次 ${payload.batchNo} 已生成，但列表刷新失败；请点“刷新批次列表”核对，不要再次生成。`, 'warning');
  } finally {
    button.disabled = false;
    button.textContent = '生成 CDK';
  }
});
elements.downloadCdks.addEventListener('click', () => {
  const batchNo = elements.cdkBatchLabel.textContent.match(/^批次\s+(\S+)/)?.[1] || 'cdks';
  downloadCodes(batchNo, elements.generatedCdks.value.split(/\r?\n/).filter(Boolean));
});
function resetCdkBatchPaging() { state.cdkBatchCursor = null; state.cdkBatchRows = []; }
document.querySelector('#refresh-cdk-batches')?.addEventListener('click', () => { resetCdkBatchPaging(); loadCdkBatches().catch(() => showNotice('批次记录读取失败。')); });
elements.cdkBatchFilters?.addEventListener('submit', (event) => { event.preventDefault(); resetCdkBatchPaging(); loadCdkBatches().catch(() => showNotice('批次筛选失败。')); });
elements.cdkBatchMore?.addEventListener('click', () => loadCdkBatches().catch(() => showNotice('更多批次读取失败。')));
elements.exportCdkBatches?.addEventListener('click', () => downloadOperationsCsv('cdk_batches').catch(() => showNotice('批次汇总导出失败。')));
elements.exportCdkTrace?.addEventListener('click', () => downloadOperationsCsv('order_trace').catch(() => showNotice('订单追溯导出失败。')));
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
function manualCardImportErrorMessage(error) {
  const messages = {
    manual_card_import_confirmation_required: '预览已过期或文件已变化，库存没有改变；请重新选择文件预览后再提交。',
    manual_card_snapshot_invalid: '文件中有结构错误的行，库存没有改变；请修正 Excel 后重新导入。',
    manual_card_source_unavailable: '该备用卡台不可用，库存没有改变。',
    manual_card_file_invalid: '文件解析失败，请确认是备用卡台导出的 Excel。',
    admin_auth_required: '登录已过期，请重新登录后再导入。'
  };
  return messages[error?.message] || `备用卡导入失败（${error?.message || '未知原因'}），库存没有改变。`;
}
elements.manualCardImportForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = elements.manualCardImportFile?.files?.[0];
  const providerAccountId = elements.manualCardImportSource?.value;
  if (!file || !providerAccountId) return showNotice('请先选择备用卡台和完整快照文件。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  // Row issue codes come from the server parser; only REJECTED (structure) and
  // CONFLICT (same card under another source) block the commit.
  const issueText = {
    BALANCE_MISMATCH: '累计充值 − 累计消费 ≠ 余额（仅提示，按余额列导入）', INVALID_BALANCE: '金额不是数字或为负',
    INVALID_CARD_NUMBER: '卡号无效', INVALID_CVC: 'CVC 无效', INVALID_EXPIRY: '有效期不是 MM/YY',
    MISSING_SEQUENCE: '缺卡序列号', DUPLICATE_SEQUENCE: '卡序列号重复',
    CARD_NOT_ACTIVE: '开卡状态不是可用（不阻止提交）', EXPIRED_CARD: '已过期（不阻止提交）'
  };
  const statusText = { INSERT: '新增', UPDATE: '更新', UNAVAILABLE: '业务不可用', CONFLICT: '跨来源冲突', REJECTED: '结构错误' };
  elements.manualCardImportPreview.innerHTML = '<p class="loading-state">正在解析文件…</p>';
  try {
    const preview = await api('/api/v1/admin/manual-cards/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerAccountId, filename: file.name, fileBase64: btoa(binary) }) });
    const blockers = (preview.rows || []).filter((row) => row.status === 'REJECTED' || row.status === 'CONFLICT');
    const blockLine = preview.commitAllowed
      ? '<p class="drawer-hint">可以提交：文件结构正确，没有跨来源冲突。余额不足、停用、过期的卡会照常记录，只是不参与分配。</p>'
      : `<p class="drawer-action-line">不能提交：${preview.rejectedCount ? `${preview.rejectedCount} 行结构错误` : ''}${preview.rejectedCount && preview.conflictCount ? '，' : ''}${preview.conflictCount ? `${preview.conflictCount} 行跨来源冲突` : ''}。${blockers.map((row) => `第 ${escapeHtml(row.row ?? '?')} 行（尾号 ${escapeHtml(row.last4 || '—')}）：${escapeHtml((row.errors || []).map((code) => issueText[code] || code).join('；') || statusText[row.status] || row.status)}`).join('；')}。修正 Excel 后重新预览；只有结构错误和跨来源冲突会阻止提交。</p>`;
    elements.manualCardImportPreview.innerHTML = `<p>${escapeHtml(preview.sourceName)} · 共 ${preview.rowCount} 行：新增 ${preview.insertCount}，更新 ${preview.updateCount}，业务不可用 ${preview.unavailableCount}，快照缺失 ${preview.missingCount}，活动风险 ${preview.activeRiskCount}，跨来源冲突 ${preview.conflictCount}，结构错误 ${preview.rejectedCount}</p>${blockLine}${(preview.rows || []).map((row) => `<div><span><strong>序列号 ${escapeHtml(row.sequence)}… · 尾号 ${escapeHtml(row.last4 || '—')}</strong><small>余额 $${escapeHtml(row.balance || '—')} · ${escapeHtml(row.state || '—')}${row.errors?.length ? ` · ${escapeHtml(row.errors.map((code) => issueText[code] || code).join('、'))}` : ''}${row.warnings?.length ? ` · ${escapeHtml(row.warnings.map((code) => issueText[code] || code).join('、'))}` : ''}</small></span><em>${escapeHtml(statusText[row.status] || row.status)}</em></div>`).join('')}<button class="danger-button" type="button" id="commit-manual-card-import" ${preview.commitAllowed ? '' : 'disabled'}>提交完整快照（${preview.rowCount} 张）</button>`;
    elements.manualCardImportPreview.querySelector('#commit-manual-card-import')?.addEventListener('click', async () => {
      if (!window.confirm(`提交「${preview.sourceName}」的完整快照（${preview.rowCount} 张）？\n该卡台库存将整体替换为本文件内容，其他卡台不受影响。`)) return;
      // The confirmation string comes from the preview itself: it proves the
      // committed file still has the row count the operator just reviewed.
      try { await api('/api/v1/admin/manual-cards/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerAccountId, filename: file.name, fileBase64: btoa(binary), confirmation: preview.confirmation }) }); showNotice('完整快照已原子更新；其他卡台未受影响。', 'success'); await Promise.all([loadProviderRoutes(), loadStock()]); }
      catch (error) { showNotice(manualCardImportErrorMessage(error)); }
    });
  } catch (error) {
    const message = manualCardImportErrorMessage(error);
    elements.manualCardImportPreview.innerHTML = `<p class="drawer-action-line">${escapeHtml(message)}</p>`;
    showNotice(message);
  }
});
document.addEventListener('click', async (event) => {
  const intakeButton = event.target.closest('[data-intake]');
  if (intakeButton) {
    const target = intakeButton.dataset.intake; const d = state.decisions || {};
    const steps = [];
    if (target === 'stop') { if (d.acceptNewOrders) steps.push(['order-acceptance', { enabled: false, confirmation: '停止接单' }]); }
    else {
      if (!d.acceptNewOrders) steps.push(['order-acceptance', { enabled: true, confirmation: '开始接单' }]);
      const wantDispatch = target === 'run';
      if (Boolean(d.dispatchNewRecharges) !== wantDispatch) steps.push(['recharge-dispatch', { enabled: wantDispatch, confirmation: wantDispatch ? '开始自动充值' : '停止自动充值' }]);
    }
    intakeButton.disabled = true;
    try {
      for (const [path, body] of steps) await api(`/api/v1/admin/operations/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      showNotice('接单状态已更新。', 'success');
    } catch { showNotice('接单状态更新失败，请刷新后重试。'); }
    await loadOverview();
    return;
  }
  const paymentButton = event.target.closest('#decision-payment');
  if (paymentButton) {
    const enable = paymentButton.dataset.enabled !== 'true';
    if (!window.confirm(enable ? '开启后浏览器会真实点击付款并扣卡上的钱。确定开启？' : '关闭后所有 Browser 订单停在付款前。确定关闭？')) return;
    paymentButton.disabled = true;
    try {
      await api('/api/v1/admin/operations/browser-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: enable }) });
      showNotice(enable ? '已允许自动付款。' : '已禁止自动付款。', 'success');
    } catch { showNotice('付款开关更新失败，请刷新后重试。'); }
    await loadOverview();
    return;
  }
  const supplyButton = event.target.closest('[data-supply-toggle]');
  if (supplyButton) {
    const enable = supplyButton.dataset.enable === 'true';
    supplyButton.disabled = true;
    try {
      await api('/api/v1/admin/operations/supply-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: enable }) });
      showNotice(enable ? '已开启自动开卡与补余额。' : '已关闭自动开卡与补余额。', 'success');
    } catch { showNotice('供给开关更新失败，请刷新后重试。'); }
    await loadOverview();
    return;
  }
  const sourceApply = event.target.closest('#decision-card-source-apply');
  if (sourceApply) {
    const select = document.querySelector('#decision-card-source');
    const providerAccountId = select?.value;
    if (!providerAccountId) return showNotice('请先选择卡台。');
    sourceApply.disabled = true;
    try {
      const result = await api('/api/v1/admin/card-sources/browser/current', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerAccountId, takeoverWaiting: false }) });
      showNotice(`Browser 卡台已切换${result.warnings?.length ? '；目标卡台当前有提醒，请到卡片页查看' : '，只影响之后的新订单'}。`, 'success');
    } catch { showNotice('卡台切换失败，请刷新后重试。'); }
    await loadOverview();
    return;
  }
  const methodButton = event.target.closest('.default-recharge-method');
  if (methodButton) {
    setDefaultRechargeMethod(methodButton);
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
