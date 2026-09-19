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
// 卡片流水类型说人话（D-280 ④）。生产实查：两个卡台大小写不一致
// （purchase 与 PURCHASE 并存），所以一律按小写匹配；认不出的原样显示，不编。
const CARD_TX_TYPE_LABELS = Object.freeze({
  purchase: '消费', chargeback: '拒付', chargeback_fee: '拒付手续费',
  normal_cancel_return: '回笼', card_issue_fee: '开卡费'
});
function cardTxTypeLabel(type) {
  const key = String(type || '').trim().toLowerCase();
  return CARD_TX_TYPE_LABELS[key] || String(type || '—');
}
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
  browserPage: 1, browserTotal: 0
};
const elements = {
  navItems: [...document.querySelectorAll('.nav-item')],
  views: [...document.querySelectorAll('.view')],
  viewKicker: document.querySelector('#view-kicker'),
  viewTitle: document.querySelector('#view-title'),
  syncTime: document.querySelector('#sync-time'),
  diagnosticsReadiness: document.querySelector('#diagnostics-readiness-list'),
  diagnosticsHeartbeat: document.querySelector('#diagnostics-heartbeat'),
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
  ,cdkForm: document.querySelector('#cdk-form'), cdkCount: document.querySelector('#cdk-count'),
  cdkResult: document.querySelector('#cdk-result'), generatedCdks: document.querySelector('#generated-cdks'),
  cdkBatchLabel: document.querySelector('#cdk-batch-label'), copyCdks: document.querySelector('#copy-cdks'),
  downloadCdks: document.querySelector('#download-cdks'), cdkBatches: document.querySelector('#cdk-batches'),
  cdkBatchFilters: document.querySelector('#cdk-batch-filters'), cdkBatchPlan: document.querySelector('#cdk-batch-plan'), cdkBatchStatus: document.querySelector('#cdk-batch-status'), cdkBatchFrom: document.querySelector('#cdk-batch-from'), cdkBatchTo: document.querySelector('#cdk-batch-to'), cdkBatchMore: document.querySelector('#cdk-batch-more'), cdkBatchPageInfo: document.querySelector('#cdk-batch-page-info'), exportCdkBatches: document.querySelector('#export-cdk-batches'), exportCdkTrace: document.querySelector('#export-cdk-trace'),
  stockSummary: document.querySelector('#stock-summary'), stockJobs: document.querySelector('#stock-jobs'),
  stockCards: document.querySelector('#stock-cards'), providerSummary: document.querySelector('#provider-summary'),
  cardsRigs: document.querySelector('#cards-rigs'), stockCardsHistory: document.querySelector('#stock-cards-history'),
  settingsPolicies: document.querySelector('#settings-policies'),
  settingsThresholds: document.querySelector('#settings-thresholds'),
  settingsGlobal: document.querySelector('#settings-global'),
  cardRetirementList: document.querySelector('#card-retirement-list'),
  cardCapacityForm: document.querySelector('#card-capacity-form'), cardCapacity: document.querySelector('#card-capacity'),
  minimumBalanceForm: document.querySelector('#minimum-balance-form'), minimumBalance: document.querySelector('#minimum-balance'),
  minimumBalancePlan: document.querySelector('#minimum-balance-plan'), cdkPlan: document.querySelector('#cdk-plan'),
  stockOpenForm: document.querySelector('#stock-open-form'), stockOpenCount: document.querySelector('#stock-open-count'),
  stockOpenAmount: document.querySelector('#stock-open-amount'), stockCardType: document.querySelector('#stock-card-type'),
  refreshCardProviderRules: document.querySelector('#refresh-card-provider-rules'),
  stockCardProfile: document.querySelector('#stock-card-profile'),
  stockCost: document.querySelector('#stock-cost'),
  highvccTokenStatus: document.querySelector('#highvcc-token-status'),
  highvccTokenForm: document.querySelector('#highvcc-token-form'), highvccTokenInput: document.querySelector('#highvcc-token-input'),
  highvccOpenForm: document.querySelector('#highvcc-open-form'), highvccOpenAmount: document.querySelector('#highvcc-open-amount'),
  highvccCost: document.querySelector('#highvcc-cost'), highvccQuoteButton: document.querySelector('#highvcc-quote-button'),
  highvccOpenButton: document.querySelector('#highvcc-open-button'),
  highvccWalletStatus: document.querySelector('#highvcc-wallet-status'),
  highvccVidSelect: document.querySelector('#highvcc-vid-select'),
  highvccDetails: document.querySelector('#highvcc-open-form')?.closest('details'),
  highvccRefreshWallet: document.querySelector('#highvcc-refresh-wallet'),
  highvccOpenSite: document.querySelector('#highvcc-open-site'),
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

function renderReadiness(readiness = {}, target = null) {
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

// ===== 工作台（第⑥步 C 精修，D-283）渲染 =====
// 复用现有 overview / reconciliation·daily 取数，重排成 C 精修布局。
// 营业条沿用五个决定的按钮契约（data-intake / data-method / #decision-card-source(-apply)
// / #decision-payment / data-supply-toggle），只换候光皮，事件委托零改动。
function wbChip(cls, text) { return `<span class="wb-chip ${cls}"><span class="wb-d"></span>${escapeHtml(text)}</span>`; }

function renderWbWall(overview) {
  const box = document.getElementById('wb-wall');
  if (!box) return;
  const m = overview.metrics || {};
  // D-285：五格一律按原型 C —— 今日单数 / 成功率 / 自动完成率 / 今日花费（按台）/ 异常支出。
  // 撤销在途版擅自换成的「可分配卡 / 待核对 / 昨晚的数量」。后端现只有前两项的聚合，
  // 后三项一律标「待接入」：D-284 ③ 明令自动完成率口径未定前不许自拟算法，
  // 今日花费与异常支出同理——宁可空着，也不拿相近字段顶替出一个看着对、实则算错的数。
  const pending = (lb, sub) => ({ lb, v: '待接入', sub, pending: true });
  const cells = [
    { lb: '今日单数', v: m.todayOrders ?? 0, sub: `处理中 ${m.processingOrders ?? 0}`, filter: 'TODAY' },
    { lb: '成功率', v: m.successRate == null ? '—' : `${m.successRate}%`, sub: `完成 ${m.completedOrders ?? 0} 单` },
    pending('自动完成率', '口径待定（D-284 ③）'),
    pending('今日花费', '按卡台，聚合待写'),
    pending('异常支出', '无主扣款金额，聚合待写')
  ];
  box.innerHTML = cells.map((c) => `<button type="button" class="wb-kpi${c.pending ? ' is-pending' : ''}"${c.pending ? ' disabled' : ''} ${c.filter ? `data-order-filter="${c.filter}"` : c.view ? `data-view-jump="${c.view}"` : ''}><span class="wb-lb">${escapeHtml(c.lb)}</span><span class="wb-v">${escapeHtml(String(c.v))}</span><span class="wb-sub">${escapeHtml(c.sub)}</span></button>`).join('');
}

function renderWbCards(overview) {
  const box = document.getElementById('wb-cards');
  if (!box) return;
  const byProvider = overview.cardStockByProvider || [];
  const h = overview.providerHealth || {};
  // 显示名：hnskj → HNSKJ；backup-a（manual_excel，highvcc 开卡进这台）→ highvcc卡台
  // （Lemon 2026-09-20 定：与卡片页同名，同一台卡台不给两个叫法）。
  const nameOf = (p) => p.providerKind === 'hnskj' ? 'HNSKJ' : (p.providerCode === 'backup-a' ? 'highvcc卡台' : (p.providerCode || p.providerKind || '卡台'));
  // hnskj 钱包来自本地快照（getOverview.providerHealth）；backup-a 的钱包=highvcc，实时端点、不在概览。
  const walletOf = (p) => p.providerKind === 'hnskj'
    ? (h.accountBalance == null ? '钱包 —' : `钱包 ${formatMoney(h.accountBalance)} ${escapeHtml(h.currency || 'USD')}`)
    : '钱包见卡片页';
  if (!byProvider.length) { box.innerHTML = '<p class="wb-qempty">暂无卡台数据</p>'; return; }
  const totalAssignable = byProvider.reduce((sum, p) => sum + (p.plusAssignable || 0), 0);
  box.innerHTML = byProvider.map((p) => `
    <div class="wb-provrow"><div><b>${escapeHtml(nameOf(p))}</b> ${wbChip('ok', walletOf(p))}
      <div class="wb-usechips">${wbChip(p.plusAssignable > 0 ? 'ok' : 'mute', `Plus 可分配 ${p.plusAssignable}`)}${wbChip('mute', `在库 ${p.inStock}`)}${wbChip('mute', `使用中 ${p.inUse}`)}${wbChip('mute', `用过 ${p.anyUsed}`)}</div></div></div>`).join('')
    + `<p class="wb-total">两台合计现在可分配 <b class="wb-mono">${totalAssignable}</b> 张（Plus 资格规则）<br><small>今日花费按台、highvcc 钱包水位：待接入</small></p>`;
}

function renderWbRecon(daily) {
  const box = document.getElementById('wb-recon');
  if (!box) return;
  // F-63：接口失败与「今天没对账」分开——失败必须说失败，不能装成暂无数据。
  if (daily && daily.__error) { box.innerHTML = '<p class="wb-qempty wb-recon-empty wb-qerror">日对账读取失败，点右上角刷新重试</p>'; return; }
  if (!daily) { box.innerHTML = '<p class="wb-qempty wb-recon-empty">日对账暂无数据（timer 每天 04:0x 跑一次）</p>'; return; }
  // F-62：字段名对齐服务端 unverifiableAmountCount（曾错写 unverifiableCount → 恒显 0）；
  // 缺字段显「—」而非 0，把「未知/没接到」和「真实 0」分开。
  const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v));
  const cells = [
    { v: num(daily.discrepancyCount), lb: '差异', s: '无主扣款', bad: (daily.discrepancyCount ?? 0) > 0 },
    { v: num(daily.pendingRegistrationCount), lb: '待登记', s: '手动用卡' },
    { v: num(daily.unverifiableAmountCount), lb: '无法核对', s: '无期初金额' },
    { v: num(daily.persistentCount), lb: '连续两次', s: 'persistent', bad: (daily.persistentCount ?? 0) > 0 }
  ];
  box.innerHTML = cells.map((c) => `<div class="wb-r ${c.bad ? 'is-bad' : ''}"><span class="wb-v">${escapeHtml(String(c.v))}</span><span class="wb-lb">${escapeHtml(c.lb)}<small>${escapeHtml(c.s)}</small></span></div>`).join('');
}

function renderWbQueue(overview, daily, alertData, reconCases) {
  const box = document.getElementById('wb-queue');
  const countChip = document.getElementById('wb-queue-count');
  if (!box) return;
  const b = overview.operationalBacklog || {};
  const cases = (reconCases && reconCases.cases) || [];
  const items = [];
  // 资金核对案例。F-61：付款不明（API/BROWSER）必须走订单详情里的【正式收口】——它把订单、
  // attempt、消费账本、卡占用一起收口，收口成功后这条 case 自身也会被关（API 见
  // unknown-submission-resolve-service；Browser 见本轮 browser-admin-service 的 B1 补丁）。
  // 工作台不再对付款不明提供「解决」直接关 case：那样只擦记录、不动资金，正是 F-61 病根。
  // 其它类型的对账 case 才保留「关闭记录」这一纯记录动作，且明确改名不叫「解决」。
  cases.forEach((c) => {
    const isPaymentUnknown = PAYMENT_UNKNOWN_CASE_TYPES.has(c.caseType);
    const actions = isPaymentUnknown
      ? (c.publicNo
          ? `<button type="button" class="wb-btn pri sm" data-open-case-order-wb="${escapeHtml(c.publicNo)}">去核实收口</button>`
          : '<span class="wb-hint">缺订单号，去订单页查</span>')
      : `${c.publicNo ? `<button type="button" class="wb-btn out sm" data-open-case-order-wb="${escapeHtml(c.publicNo)}">看订单</button>` : ''}<button type="button" class="wb-btn out sm" data-resolve-wb-case="${escapeHtml(c.id)}">关闭记录</button>`;
    items.push({
      t: c.severity === 'critical' ? 'danger' : c.severity === 'warning' ? 'warn' : 'info',
      ic: '◷',
      title: `资金核对 · ${RECONCILIATION_TYPE_LABELS[c.caseType] || c.caseType || '案例'}`,
      ev: `${c.publicNo ? '订单 ' + c.publicNo + ' · ' : ''}${RECONCILIATION_STATUS_LABELS[c.status] || c.status} · ${formatTime(c.lastSeenAt)}`,
      actions
    });
  });
  // 其余类：摘要 + 跳专页处理（待销/手动用卡在卡片页，无主扣款/连续两次在诊断日对账）。
  if (daily && (daily.discrepancyCount ?? 0) > 0) items.push({ t: 'danger', ic: '⚠', title: `对账差异 · 无主扣款 ${daily.discrepancyCount} 张卡`, ev: '账本无对应订单，进报告、不隐藏', jump: 'diagnostics' });
  if (daily && (daily.persistentCount ?? 0) > 0) items.push({ t: 'danger', ic: '‼', title: `连续两次差异 ${daily.persistentCount} 张`, ev: '已升级，需人工核', jump: 'diagnostics' });
  // 「卡补余额待人工」这条待办随卡片页补余额区块一起退休（D-280 ⑦ / D-288）：
  // 补余额已弃（D-218），生产 card_funding_attempts 仅 6 行全 FAILED、最后一次 2026-09-14。
  // 后端计数仍在 operationalBacklog 里，将来要恢复入口时再接。
  if ((b.cardIntakePending ?? 0) > 0) items.push({ t: 'info', ic: '⇩', title: `新卡待接管 ${b.cardIntakePending} 张`, ev: '同步后确认接管', jump: 'stock' });
  if (daily && (daily.pendingRegistrationCount ?? 0) > 0) items.push({ t: 'info', ic: '✎', title: `待登记手动用卡 ${daily.pendingRegistrationCount} 张`, ev: '已登记 manual-used，等去卡台销', jump: 'stock' });
  // D-285：原型 C 的队列明确画了「待销到期」和「token 状态」两类，放回工作台
  // （此前被我判为卡片页范围、本轮不做，属误判；F-64 据此在本块闭合）。
  // 完整处理动作仍在卡片页，这里只做提醒 + 带落点的跳转。
  if (daily && (daily.retirementDueCount ?? 0) > 0) {
    items.push({ t: 'warn', ic: '⌫', title: `待销到期 ${daily.retirementDueCount} 张卡`,
      ev: '已过存活期，去卡台删掉后回来点「已销卡」', jump: 'stock' });
  }
  // token：只说能证明的。有 PROVIDER_TOKEN_EXPIRED 告警＝确已失效（权威信号）；
  // 没有告警不等于「有效」——token 两小时不活动就过期，configured=true 推不出有效，
  // 所以无告警时只报「上次更新时间」，不写「有效」（观察与结论分开）。
  const tokenExpired = (alertData?.alerts || []).find((a) => a && a.type === 'PROVIDER_TOKEN_EXPIRED');
  if (tokenExpired) {
    items.push({ t: 'danger', ic: '⚿', title: '卡台 token 已失效，开卡会失败',
      ev: `${tokenExpired.message || '重新贴一次 token'} · ${formatTime(tokenExpired.createdAt)}`, jump: 'stock' });
  }
  // 告警不逐条塞队列（48 个会爆炸）——聚合成一条可展开的折叠栏，逐条关。
  const alerts = (alertData && alertData.alerts) || [];
  const active = items.length;
  if (countChip) countChip.innerHTML = `<span class="wb-d"></span>${active} 件待办`;
  // F-63：待办来源里任一个接口失败时，空列表不能显示成「今天清爽」——那会把「没读到」
  // 冒充成「没有待办」，付款不明单可能就此被漏掉。有失败就明说失败、让人去刷新。
  // F-71：这里只查这三个，是够的，不是漏——能把「读取失败」误显示成「今天清爽」的，
  // 只有失败被吞成空值的来源。队列项的四个来源里：cases←reconCases、无主扣款/连续两次/
  // 待登记←daily、告警折叠栏←alertData 都会被吞，必须查；而卡补余额待人工/新卡待接管
  // 来自 overview.operationalBacklog，overview 在 loadOverview 里**故意不 catch**，失败会
  // 直接抛出、整页不更新，压根走不到这行。todayOrders/cardSources 不产生队列项。
  const sourceFailed = [reconCases, daily, alertData].some((s) => s && s.__error);
  const itemsHtml = active
    ? items.map((it) => `<div class="wb-qi ${it.t}"><div class="wb-qic">${it.ic}</div><div class="wb-qt"><b>${escapeHtml(it.title)}</b><span class="wb-ev">${escapeHtml(it.ev)}</span></div><div class="wb-qa">${it.actions || (it.jump ? `<button type="button" class="wb-btn out sm" data-view-jump="${it.jump}">去处理</button>` : '')}</div></div>`).join('')
    : sourceFailed
      ? '<p class="wb-qempty wb-qerror">部分待办没读出来（接口失败），点右上角刷新重试——这不是「没有待办」。</p>'
      : '<p class="wb-qempty">没有要处理的，今天清爽 ✓</p>';
  const alertsHtml = alerts.length
    ? `<details class="wb-alerts"><summary><span class="wb-chip warn"><span class="wb-d"></span>${alerts.length} 个内部提醒</span>点开逐条关</summary><div class="wb-alerts-list">${alerts.map((a) => `<div class="wb-alert-row"><div class="wb-at"><b>${escapeHtml(a.title || '提醒')}</b><small>${escapeHtml(a.message || '')} · ${formatTime(a.createdAt)}</small></div><button type="button" class="wb-btn out sm" data-close-wb-alert="${escapeHtml(a.id)}">关闭</button></div>`).join('')}</div></details>`
    : '';
  box.innerHTML = itemsHtml + alertsHtml;
}

function wbOrderRow(order) {
  const stage = order.stage || {};
  const meta = STAGE_LABELS[stage.stage] || [stage.label || '—', 'gray'];
  const toneMap = { green: 'ok', red: 'danger', orange: 'warn', blue: 'info', gray: 'mute' };
  const cls = toneMap[meta[1]] || 'mute';
  return `<tr data-order="${escapeHtml(order.publicNo)}"><td class="wb-mono">${escapeHtml(order.publicNo)}</td><td>${escapeHtml(productLabel(order))}</td><td>${wbChip(cls, meta[0])}</td><td>${stage.action ? escapeHtml(stage.action) : '—'}</td><td class="wb-mono">${order.card?.last4 ? '尾号 ' + escapeHtml(order.card.last4) : '—'}</td><td class="wb-mono">${escapeHtml(order.customerEmail || order.chatgptAccountId || '—')}</td><td class="wb-mono">${formatTime(order.createdAt)}</td></tr>`;
}

function renderWbOrders(orders) {
  const table = document.getElementById('wb-orders');
  if (!table) return;
  const head = '<thead><tr><th>订单</th><th>产品</th><th>当前阶段</th><th>需要我做什么</th><th>卡尾号</th><th>身份</th><th>创建</th></tr></thead>';
  const body = orders.length ? orders.map(wbOrderRow).join('') : '<tr><td colspan="7" class="wb-empty">今天还没有订单</td></tr>';
  table.innerHTML = head + '<tbody>' + body + '</tbody>';
}

function renderDecisions(overview, cardSources, takeoverEstimate = null) {
  const box = document.getElementById('wb-decisions');
  if (!box) return;
  const d = overview.decisions || {};
  state.decisions = d;
  state.acceptingOrders = Boolean(d.acceptNewOrders);
  state.browserSelectionVersion = Number(cardSources?.browserSelectionVersion || 0);
  // D-284 ①：当前默认充值方式必须存进 state —— setDefaultRechargeMethod 要拿它当
  // expectedCurrentMethod 传给后端做 VERSION_MATCH 校验。此前 state.rechargeMethod
  // 只被读、从没被赋值，恒为 undefined → 恒传 'NONE' → 与实际 API/BROWSER 对不上
  // → 四项校验的 VERSION_MATCH 必失败 → 路线切换在页面上永远切不动。
  // 字段位置以真实响应为准：是 providerHealth.rechargeMethod，不是顶层 overview.rechargeMethod
  // （对着真实 /admin/overview 响应查出来的；按顶层猜会恒 null → 又变成永远切不动）。
  state.rechargeMethod = overview.providerHealth?.rechargeMethod || null;
  // 营业条 = 接单/派单/付款 三个 toggle 开关（照设计图），对应后端三个独立开关。
  const sw = (op, on, b, s) => `<button type="button" class="wb-switch ${on ? 'is-on' : ''}" data-op="${op}" data-on="${on}"><span class="wb-tg"></span><span class="wb-lb"><b>${b}</b><small>${escapeHtml(s)}</small></span></button>`;
  box.innerHTML = sw('accept', Boolean(d.acceptNewOrders), '接单', '新单进入')
    + sw('dispatch', Boolean(d.dispatchNewRecharges), '派单', '分卡执行')
    + sw('pay', Boolean(d.browserPaymentWritesEnabled), '付款', '允许提交付款');
  const routeBox = document.getElementById('wb-routes');
  if (routeBox) {
    const sources = (cardSources?.sources || []).filter((item) => item.supportsBrowserRecharge && item.operationalEnabled);
    const currentSource = cardSources?.browserProviderAccountId || '';
    const sourceOptions = sources.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === currentSource ? 'selected' : ''}>${escapeHtml(item.displayName)}</option>`).join('');
    // D-284 ①（方向 A）：路线切换块留在工作台。切换走已有的 setDefaultRechargeMethod ——
    // 后端 setDefaultRechargeMethod 会先跑面一 C1 四项校验（ROUTE_UNIQUE / SOURCE_HEALTHY /
    // TARGET_POOL_AVAILABLE / VERSION_MATCH），不过即拒并把逐项结果放在 error.checks 里交回，
    // 前端 switchCheckReasons() 把没过的那几项逐条显示出来。此前这个按钮**从未被渲染**，
    // 功能等于下线；这里补回来，并标出当前走哪条。只影响切换后的新订单。
    const method = String(state.rechargeMethod || '').toUpperCase();
    const methodLabel = method === 'API' ? 'API 充值' : method === 'BROWSER' ? '浏览器自动化' : '未设置';
    // D-280 ⑦：卡台切换从卡片页搬来，「同时接管」这半边不能丢——卡台断供时，
    // 它把还在排队等卡的单改指新卡台（只动完全没碰过钱的单，见 safeWaitingPredicate）。
    const takeoverCount = Number(takeoverEstimate?.count || 0);
    const takeoverHint = takeoverEstimate?.__error
      ? '<small>Browser 路线卡台，只影响新订单；待接管单数读取失败，本次切换不接管排队单。</small>'
      : takeoverCount > 0
        ? `<label class="wb-takeover"><input type="checkbox" id="decision-card-source-takeover"> 同时接管 ${takeoverCount} 张排队等卡的单</label>`
          + '<small>不勾：只影响新订单，排队单继续等原卡台。勾上：把这些单改指新卡台（只动没分卡、没充值、没碰钱的单）。</small>'
        : '<small>Browser 路线卡台，只影响新订单；当前没有排队等卡的单可接管。</small>';
    const methodBtn = (target, text) => (method === target
      ? `<span class="wb-chip ok"><span class="wb-d"></span>当前：${escapeHtml(text)}</span>`
      : `<button type="button" class="wb-btn sm out default-recharge-method" data-method="${target}">切到${escapeHtml(text)}</button>`);
    routeBox.innerHTML = `<div class="wb-route"><b>走哪条路线</b><div class="wb-routepick">${methodBtn('API', 'API')}${methodBtn('BROWSER', '浏览器')}</div><small>Plus 默认充值方式（${escapeHtml(methodLabel)}）；切换前跑四项校验，不过会逐条说明原因，只影响新订单</small></div>`
      + `<div class="wb-route"><b>用哪个卡台</b><div class="wb-routepick"><span class="wb-chip mute"><span class="wb-d"></span>API · HNSKJ 固定</span></div></div>`
      + `<div class="wb-route"><div class="wb-routepick"><select class="wb-field" id="decision-card-source" aria-label="Browser 卡台">${sourceOptions || '<option value="">没有可用卡台</option>'}</select><button type="button" class="wb-btn sm out" id="decision-card-source-apply" ${sources.length ? '' : 'disabled'}>切换</button></div>${takeoverHint}</div>`;
  }
}

/**
 * 切 Browser 卡台（D-280 ⑦：从卡片页搬来，含「同时接管」）。
 *
 * 三条安全行为必须留着，都是真出过事的：
 *  1) 切换成功后读失败，仍然算成功——说成失败会让人重复点。
 *  2) 响应丢了不等于没切成，只能说「未能确认」，绝不能说「原选择未改变」。
 *  3) 被四项校验拒绝时才说「卡台没有改变」，并逐条给原因。
 */
async function applyBrowserCardSource(sourceApply) {
  const select = document.querySelector('#decision-card-source');
  const providerAccountId = select?.value;
  if (!providerAccountId) { showNotice('请先选择卡台。'); return; }
  sourceApply.disabled = true;
  try {
    const takeoverWaiting = document.querySelector('#decision-card-source-takeover')?.checked === true;
    const result = await api('/api/v1/admin/card-sources/browser/current', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerAccountId, takeoverWaiting, expectedVersion: state.browserSelectionVersion || 0 })
    });
    // 报「实际接管了几单」而不是「请求了几单」——两者可能不同（期间有单已开始执行）。
    const actual = Number(result?.actualTakeoverCount || 0);
    showNotice(takeoverWaiting
      ? `Browser 卡台已切换；实际接管 ${actual} 张排队单，其余单不受影响。`
      : 'Browser 卡台已切换，只影响之后的新订单。', 'success');
    try {
      await loadOverview();
    } catch {
      showNotice('Browser 卡台已切换，但列表刷新失败；请刷新查看，不要重复切换。', 'warning');
    }
  } catch (error) {
    if (error.message === 'card_source_switch_rejected') {
      showNotice(`切换被拒绝，卡台没有改变：${switchCheckReasons(error)}`, 'warning');
    } else if (error.message === 'card_source_selection_locked') {
      showNotice('这一行的卡台是固定的（API 只走 hnskj），不能切换。', 'warning');
    } else {
      showNotice('未能确认卡台切换结果，正在重新读取当前选择；请勿重复点击。', 'warning');
    }
    await loadOverview().catch(() => {});
  } finally {
    sourceApply.disabled = false;
  }
}

// 营业条 toggle：接单/派单/付款，对应后端三个独立开关（路线/开卡补钱移到设置页）。
async function toggleOp(op, enable) {
  try {
    if (op === 'accept') await api('/api/v1/admin/operations/order-acceptance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: enable, confirmation: enable ? '开始接单' : '停止接单' }) });
    else if (op === 'dispatch') await api('/api/v1/admin/operations/recharge-dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: enable, confirmation: enable ? '开始自动充值' : '停止自动充值' }) });
    else if (op === 'pay') { if (enable && !window.confirm('开启后浏览器会真实点击付款并扣卡上的钱。确定开启？')) return; await api('/api/v1/admin/operations/browser-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: enable }) }); }
    showNotice('营业开关已更新。', 'success');
    await loadOverview();
  } catch { showNotice('开关更新失败，请刷新后重试。'); }
}

async function loadOverview() {
  const [overview, todayOrders, alertData, cardSources, daily, reconCases, takeoverEstimate] = await Promise.all([
    api('/api/v1/admin/overview'),
    // F-63：请求失败必须留下 __error 标记，下游才能把「读取失败」和「查过、确实没有」分开。
    // 少了这一半，renderWbQueue 的 sourceFailed 永远为假，接口挂了照样显示「今天清爽」——
    // 这正是真实页面验收（500 注入）抓到的，只测渲染函数抓不到。
    api('/api/v1/admin/orders?page=1&pageSize=12&status=TODAY').catch(() => ({ orders: [], __error: true })),
    // limit 提到 100（服务端上限）：队列要从告警里挑出 PROVIDER_TOKEN_EXPIRED，
    // 而 listAlerts 不支持按类型过滤、只按时间倒序，limit=10 时 token 告警会被淹没。
    // 局限仍在：warning/critical 的 OPEN 告警若超过 100 条，仍可能漏——已登记 UNVERIFIED_LEDGER。
    api('/api/v1/admin/alerts?limit=100').catch(() => ({ alerts: [], __error: true })),
    api('/api/v1/admin/card-sources').catch(() => ({ sources: [], __error: true })),
    api('/api/v1/admin/reconciliation/daily').catch(() => ({ __error: true })),
    api('/api/v1/admin/reconciliation-cases?page=1&pageSize=20&status=OPEN').catch(() => ({ cases: [], __error: true })),
    // 切卡台时「排队单要不要跟着搬」的待接管单数。读不到就标 __error——
    // 吞成 0 会让「同时接管」这个选项悄悄消失，卡台断供那天正需要它。
    api('/api/v1/admin/card-sources/browser/takeover-estimate').catch(() => ({ __error: true }))
  ]);
  renderDecisions(overview, cardSources, takeoverEstimate);
  renderWbWall(overview);
  renderWbCards(overview);
  renderWbRecon(daily);
  renderWbQueue(overview, daily, alertData, reconCases);
  renderWbOrders(todayOrders.orders || []);
  if (elements.syncTime) elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
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
  // D-279 ③：CDK 匹配行与订单行**同时**显示，不再二选一。
  // 原来是 orders.length ? 订单 : cdkMatches —— 码一旦绑了订单，订单非空，CDK 匹配行就被吃掉，
  // 于是「贴码定位」最有用的那种情况（码已经被用了、想知道它走到哪）反而看不到码的状态。
  // 现在：匹配到的码置顶当定位提示，底下照常列订单。
  const cdkMatchHtml = payload.cdkMatches?.length
      // D-279 ③：贴码要直接看到「这码什么状态、绑了哪单、那单走到哪、客户是谁」，并能一键进详情。
      // 原来这里只显示 CDK 内部状态词、没有阶段也进不去详情，等于查到了也还得自己再翻一遍。
      ? payload.cdkMatches.map((cdk) => {
        const label = cdkStatusLabel({
          status: cdk.status, orderStatus: cdk.orderStatus, issuedAt: cdk.issuedAt,
          expired: cdk.expiresAt ? new Date(cdk.expiresAt).getTime() < Date.now() : false,
          redeemableNow: cdk.status === 'AVAILABLE'
        });
        // 订单「当前阶段」不在这里重算：这一单必然也在下面的订单行里，那里有后端算好的
        // stage（同一口径）。这里只负责把码定位到订单，避免前端另造一套说法跟订单行打架。
        const stage = cdk.orderPublicNo ? '见下方该订单行' : '尚未下单';
        return `<tr>
          <td><strong>CDK 精确匹配</strong><small>批次 ${escapeHtml(cdk.batchNo || '—')}</small></td>
          <td>${escapeHtml(PLAN_LABELS[cdk.planType] || cdk.planType || '—')}</td>
          <td><span class="cell-main">${escapeHtml(label.text)}</span>${cdk.issuedNote ? `<small>${escapeHtml(cdk.issuedNote)}</small>` : ''}</td>
          <td>${cdk.orderPublicNo
            ? `<button class="text-button" type="button" data-open-order="${escapeHtml(cdk.orderPublicNo)}">${escapeHtml(cdk.orderPublicNo)} · 进详情</button>`
            : '尚未下单'}</td>
          <td>${stage}</td>
          <td>${escapeHtml(cdk.customerEmail || '—')}</td>
          <td>${formatTime(cdk.redeemedAt || cdk.createdAt)}</td>
        </tr>`;
      }).join('')
    : '';
  const orderHtml = payload.orders.length
    ? payload.orders.map((order) => orderRow(order)).join('')
    : '';
  elements.ordersTable.innerHTML = (cdkMatchHtml + orderHtml)
    || '<tr><td colspan="7" class="empty-cell">没有符合条件的订单或 CDK</td></tr>';
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


// F-61/F-68：付款不明的两类 case 必须走订单详情的正式收口，不能在工作台直接关记录。
// 这两个值是 case_type 的真实取值（产生点：workflow-repository / browser-execution-repository
// / browser-admin-service），不是 RECONCILIATION_TYPE_LABELS 里那套旧标签。
const PAYMENT_UNKNOWN_CASE_TYPES = new Set(['API_PAYMENT_UNKNOWN', 'BROWSER_PAYMENT_UNKNOWN']);
// D-279 ⑦：CDK 状态用客户看得懂的说法，不把 REDEEMED/REVOKED 这种内部词摆到页面上。
// 「使用中 / 已交付」要看订单走到哪：码被绑走(REDEEMED)只说明开始用了，订单成功才算交付。
const PLAN_LABELS = Object.freeze({ plus: 'Plus', pro_5x: 'Pro 5X', pro_20x: 'Pro 20X' });
function cdkStatusLabel(row) {
  if (row.status === 'REVOKED') return { text: '已作废', tone: 'mute' };
  if (row.status === 'REDEEMED') {
    return row.orderStatus === 'RECHARGE_SUCCESS'
      ? { text: '已交付', tone: 'ok' }
      : { text: '使用中', tone: 'info' };
  }
  if (row.expired) return { text: '已过期', tone: 'warn' };
  if (!row.redeemableNow) return { text: '暂不可兑', tone: 'warn' };   // 产品路线关了（D-286 ②）
  return row.issuedAt ? { text: '已发出·待兑', tone: 'info' } : { text: '可用·在手里', tone: 'ok' };
}

let justGeneratedCodes = new Set();      // D-279 ①：这批码在列表里标「刚生成」
let cdkCodePage = 0;
const CDK_CODE_PAGE_SIZE = 50;
function resetCdkCodePaging() { cdkCodePage = 0; }

const RECONCILIATION_STATUS_LABELS = Object.freeze({ OPEN: '待处理', ASSIGNED: '已分配', RESOLVED: '已解决' });
const RECONCILIATION_SEVERITY_LABELS = Object.freeze({ critical: '严重', warning: '警告', info: '提示' });
const RECONCILIATION_TYPE_LABELS = Object.freeze({
  // 真实页面验收发现：付款不明这两类 case 不在旧标签表里，队列标题直接显示成
  // BROWSER_PAYMENT_UNKNOWN / API_PAYMENT_UNKNOWN 原始枚举（node 渲染测试断言的是按钮文案，
  // 抓不到标题 fallback）。补上中文，与客户页/队列的说人话口径一致。
  API_PAYMENT_UNKNOWN: 'API 付款结果不明',
  BROWSER_PAYMENT_UNKNOWN: 'Browser 付款结果不明',
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

// F-16/F-3: a run whose payment result is unknown, or was escalated to a person, is closed by
// the operator recording what they saw on the account. Not offered while a 20X hand-off is
// waiting for 确认 20X 已升级 (that path has its own button).
function resolveUnknownEligible(run) {
  return ['RECONCILE_ONLY', 'HUMAN_REQUIRED'].includes(run.status)
    && ['PAYMENT_UNKNOWN', 'PAYMENT_CONFIRMED'].includes(run.paymentState)
    && !upgradeConfirmEligible(run);
}
function resolveUnknownButton(run) {
  return resolveUnknownEligible(run)
    ? '<button class="primary-small" type="button" data-browser-control="RESOLVE_UNKNOWN_PAYMENT">确认核实结果</button>'
    : '';
}

function browserControlButtons(run) {
  if (!['READY', 'RUNNING', 'HUMAN_REQUIRED', 'RECONCILE_ONLY'].includes(run.status)) return '';
  const resolve = resolveUnknownButton(run);
  if (run.status === 'RECONCILE_ONLY') return resolve;
  if (run.controlState === 'AUTOMATION') {
    return `${resolve}${manualPaymentButton(run)}<button class="text-button" type="button" data-browser-control="REQUEST">请求人工接管</button>`;
  }
  if (run.controlState === 'REQUESTED') {
    return resolve + '<button class="danger-small" type="button" data-browser-control="FREEZE">冻结自动化</button><button class="text-button" type="button" data-browser-control="CANCEL">取消请求</button>';
  }
  if (run.controlState === 'FROZEN') {
    return `${resolve}${manualPaymentButton(run)}<button class="primary-small" type="button" data-browser-control="TRANSFER">转交人工</button><button class="danger-small" type="button" data-browser-control="MARK_PAYMENT_UNKNOWN">标记付款未知</button>`;
  }
  if (run.controlState === 'TRANSFERRED') {
    if (run.status === 'HUMAN_REQUIRED' && run.paymentState === 'PAYMENT_CONFIRMED'
      && run.postPaymentState === 'PLUS_CONFIRMED') {
      return '<button class="primary-small" type="button" data-browser-control="COMPLETE_20X">确认 20X 已升级</button>';
    }
    return `${resolve}${manualPaymentButton(run)}<button class="primary-small" type="button" data-browser-control="RELEASE_SAFE">确认未付款并恢复</button><button class="danger-small" type="button" data-browser-control="MARK_PAYMENT_UNKNOWN">标记付款未知</button>`;
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
    RESOLVE_UNKNOWN_PAYMENT: `确认核实结果 ${run.id}`,
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
    RESOLVE_UNKNOWN_PAYMENT: '付款结果不明或已转人工的单，只有你亲自看过 ChatGPT 账号和卡台交易后才点。「已扣款」：Plus 单记成功并释放卡（续费没关会进"待复核"）；Pro 单只记 Plus 阶段完成，等你手动升 20X 后再点「确认 20X 已升级」。「未扣款」：关单、释放卡、CDK 退回客户。系统不会重付。',
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
    ],
    RESOLVE_UNKNOWN_PAYMENT: [
      {
        name: 'verifiedOutcome', label: '你核实到的结果', type: 'select', value: 'CHARGED', required: true,
        options: [
          { value: 'CHARGED', label: '已扣款：账号已开通 Plus，卡台有这笔交易' },
          { value: 'NOT_CHARGED', label: '未扣款：账号仍是 free，卡台没有这笔交易' }
        ]
      },
      {
        name: 'renewalCancelled', label: '续费已在账号里关掉了吗（只对 Plus 单已扣款有意义）', type: 'select', value: 'false', required: true,
        options: [
          { value: 'false', label: '没看 / 没关：订单进入"待复核续费"，关掉后再点「已在账号里取消续费」' },
          { value: 'true', label: '已关：订单直接记为充值成功' }
        ]
      },
      { name: 'evidenceNote', label: '你看到的证据（账号套餐、卡台交易金额与时间；不要输入完整卡号或安全码）', type: 'textarea', required: true }
    ]
  };
  const answers = await askForm({
    title: confirmations[action], message: warnings[action], fields: fieldsByAction[action] || [],
    confirmLabel: '确认执行', danger: ['FREEZE', 'MARK_PAYMENT_UNKNOWN', 'RESOLVE_UNKNOWN_PAYMENT'].includes(action)
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
  if (action === 'RESOLVE_UNKNOWN_PAYMENT') {
    input.verifiedOutcome = answers.verifiedOutcome;
    // F-44: the server refuses non-boolean values; send a real boolean, never the select's string.
    input.renewalCancelled = answers.renewalCancelled === 'true';
    input.evidenceNote = answers.evidenceNote;
  }
  await sensitiveApi(`/api/v1/admin/browser/runs/${encodeURIComponent(run.id)}/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  });
  showNotice(action === 'MARK_PAYMENT_UNKNOWN'
    ? '已锁为付款结果未知；只能进入资金证据核对，禁止重付。'
    : action === 'RESOLVE_UNKNOWN_PAYMENT'
      ? (input.verifiedOutcome === 'NOT_CHARGED'
        ? '已按"未扣款"收口：订单关闭，卡片释放，CDK 已退回客户。'
        : (input.renewalCancelled
          ? '已按"已扣款、续费已关"收口。Plus 单已记为充值成功；Pro 单等你手动升级后再点「确认 20X 已升级」。'
          : '已按"已扣款"记录。Plus 单进入"待复核续费"，关掉续费后点「已在账号里取消续费」；Pro 单等你手动升级后再点「确认 20X 已升级」。'))
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

/* ===== 第⑥步 卡片页 D-280 ①③⑤⑥（A「台账优先」，Lemon 2026-09-20 挑定）===== */

const CARD_STATE_CHIPS = Object.freeze({
  READY: ['is-ok', '待分配'], IN_USE: ['is-use', '使用中'],
  RETIRED: ['is-off', '停用'], PRODUCT_ONLY: ['is-off', '限其他产品'],
  BLOCKED: ['is-bad', '暂不可用']
});

/** 一格数字。pending=true 时显示灰色说明文字而不是数字——「没有」不能长得像 0。 */
function rigCell(label, valueHtml, { tone = '', pending = false } = {}) {
  const cls = `cardrig-q${pending ? ' is-pending' : ''}${tone ? ` ${tone}` : ''}`;
  return `<div class="${cls}"><label>${escapeHtml(label)}</label><div class="cardrig-v">${valueHtml}</div></div>`;
}

/**
 * ① 两台并列四个数。四个数全部来自后端 byProvider（可分配＝第③④块的资格规则），
 * 页面不自己判断哪张卡能分配 —— D-280 硬约束。
 */
function renderCardRigs(byProvider) {
  if (!elements.cardsRigs) return;
  if (byProvider && byProvider.__error) {
    elements.cardsRigs.innerHTML = '<p class="cardfail">卡台台账读取失败，先不要据此判断库存。刷新重试。</p>';
    return;
  }
  const rigs = Array.isArray(byProvider) ? byProvider : [];
  if (!rigs.length) { elements.cardsRigs.innerHTML = '<p class="empty-state">还没有卡台</p>'; return; }
  elements.cardsRigs.innerHTML = rigs.map((rig) => {
    const acct = escapeHtml(rig.accountCode || '');
    const assignable = Number(rig.plusAssignable || 0);
    const target = Number(rig.stockTarget || 0);
    const lowStock = rig.stockTarget != null && target > 0 && assignable < target;
    // token 只对 highvcc（无快照那台）有意义，且只在有告警时才敢说「已失效」——
    // tokenStatus() 只答「配没配过」，答不了有效性（Lemon 已定口径）。
    const isHighvcc = Boolean(rig.walletLiveOnly);
    const tokenBad = isHighvcc && rig.tokenFault === true;
    const floor = rig.walletFloor;
    const balance = rig.walletBalance;
    const lowWallet = floor != null && balance != null && Number(balance) < Number(floor);
    const opened = Number(rig.openedToday || 0);
    const limit = Number(rig.dailyLimit || 0);
    const cells = [
      rigCell('可分配 / 水位（Plus）',
        `${assignable} <small>/ ${rig.stockTarget == null ? '未配策略' : target}</small>`,
        { tone: lowStock ? 'is-warn' : '' }),
      isHighvcc
        ? rigCell('钱包余额 / 底线',
            `<button class="cardbtn" type="button" data-rig-wallet="${acct}">查余额</button>`
            + ` <small>/ ${floor == null ? '未设底线' : `$${formatMoney(floor)}`}</small>`,
            { pending: true })
        : rigCell('钱包余额 / 底线',
            `$${formatMoney(balance)} <small>/ ${floor == null ? '未设底线' : `$${formatMoney(floor)}`}</small>`,
            { tone: lowWallet ? 'is-bad' : '' }),
      rigCell('今日已开 / 日限（Plus）',
        `${opened} <small>/ ${rig.dailyLimit == null ? '未配策略' : limit}</small>`,
        { tone: limit > 0 && opened >= limit ? 'is-warn' : '' }),
      isHighvcc
        ? rigCell('token', tokenBad ? '已失效' : '已配置',
            { tone: tokenBad ? 'is-bad' : '', pending: !tokenBad })
        : rigCell('卡台快照', rig.walletSyncedAt ? escapeHtml(formatTime(rig.walletSyncedAt)) : '无快照',
            { pending: true })
    ].join('');
    return `<div class="cardrig${tokenBad ? ' is-alarm' : ''}">
      <div class="cardrig-h"><b>${escapeHtml(rig.label || rig.accountCode || '未知卡台')}</b>
        <span class="cardrig-acct">${acct}</span></div>
      <div class="cardrig-quad">${cells}</div>
      <div class="cardrig-foot">
        <span>在库 ${Number(rig.inStock || 0)} · 总 ${Number(rig.total || 0)} · 使用中 ${Number(rig.inUse || 0)}</span>
        <button class="cardbtn" type="button" data-rig-open="${escapeHtml(rig.providerKind)}">开卡…</button>
        <button class="cardbtn" type="button" data-rig-refresh="${escapeHtml(rig.providerKind)}"
          data-rig-account="${acct}">刷新这台</button>
        <span data-rig-wallet-out="${acct}"></span>
      </div>
    </div>`;
  }).join('');
}

/** 卡行的「可销时间」：来自待销端点，不在页面里重算规则（D-280 硬约束）。 */
function retirementIndex(retirement) {
  const map = new Map();
  if (!retirement || retirement.__error) return map;
  for (const bucket of ['due', 'notYetDue']) {
    for (const item of (retirement[bucket] || [])) {
      map.set(`${item.providerAccountId}:${item.providerCardId}`, item);
    }
  }
  return map;
}

function cardRowHtml(card, retireItem, retireFailed = false) {
  const [chipCls, chipText] = CARD_STATE_CHIPS[card.category] || CARD_STATE_CHIPS.BLOCKED;
  // 「用满待销」是待销规则说的，不是页面看用量猜的
  const due = retireItem?.due === true;
  const chip = due && card.category !== 'IN_USE'
    ? `<span class="cardchip is-due">${escapeHtml(retireItem.reasonLabels?.[0] || '待销')}</span>`
    : `<span class="cardchip ${chipCls}">${escapeHtml(chipText)}</span>`;
  const canRegisterManual = !card.externalOnly && card.category !== 'IN_USE' && card.category !== 'RETIRED';
  const sellable = retireFailed ? '读取失败'
    : retireItem
      ? (retireItem.due ? '已到期' : `还差 ${escapeHtml(remainingText(retireItem.dueAt))}`)
      : (card.assigned ? '占用中' : '—');
  return `<tr${due ? ' class="is-due"' : ''}>
    <td class="cardmono">${card.externalOnly
      ? escapeHtml(card.last4 || card.providerCardId || '—')
      : `<button class="cardlink" type="button" data-card="${escapeHtml(card.providerCardId)}"
          data-card-account="${escapeHtml(card.providerAccountId || '')}"
          title="点开看这张卡的流水">${escapeHtml(card.last4 || card.providerCardId || '—')}</button>`}</td>
    <td>${escapeHtml(card.providerLabel || '—')}</td>
    <td class="cardmono">${card.currentBalance == null ? '<span class="cardmuted">—</span>' : `$${formatMoney(card.currentBalance)}`}
      <span class="cardsub">${card.lastSyncedAt ? escapeHtml(formatTime(card.lastSyncedAt)) : '未同步'}</span></td>
    <td class="cardmono">${Number(card.usedCapacity || 0)}/${Number(card.maxCapacity || 3)}</td>
    <td>${chip}<span class="cardsub">${escapeHtml(card.reason || '')}</span></td>
    <td class="cardmono">${card.publicNo ? escapeHtml(card.publicNo) : '<span class="cardmuted">—</span>'}</td>
    <td class="cardmono">${card.createdAt ? escapeHtml(formatTime(card.createdAt)) : '—'}
      <span class="cardsub">${card.issueFee == null ? '成本未记' : `$${formatMoney(card.issueFee)}`}</span></td>
    <td>${escapeHtml(sellable)}</td>
    <td>${canRegisterManual
      ? `<button class="cardbtn" type="button" data-manual-use="1"
          data-account="${escapeHtml(card.providerAccountId || '')}"
          data-ext="${escapeHtml(card.externalCardId || '')}"
          data-last4="${escapeHtml(card.last4 || card.providerCardId || '')}">我手动用了</button>`
      : '<span class="cardmuted">—</span>'}</td>
  </tr>`;
}

function remainingText(dueAt) {
  const ms = Date.parse(dueAt || '') - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '不到 1 分钟';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
}

const CARD_TABLE_HEAD = `<thead><tr><th>尾号</th><th>卡台</th><th>余额</th><th>用量</th><th>状态</th>
  <th>绑定订单</th><th>开卡 / 成本</th><th>可销</th><th></th></tr></thead>`;

/** ③ 默认只显示在役；退役与卡台作废折叠进「历史」。 */
function renderStockCards(cards, retirement) {
  if (!elements.stockCards) return;
  const index = retirementIndex(retirement);
  const retireFailed = Boolean(retirement && retirement.__error);
  const list = Array.isArray(cards) ? cards : [];
  const isHistory = (card) => card.category === 'RETIRED' || card.externalOnly;
  const active = list.filter((card) => !isHistory(card));
  const history = list.filter(isHistory);
  elements.stockCards.innerHTML = active.length
    ? `<table>${CARD_TABLE_HEAD}<tbody>${active.map(
        (card) => cardRowHtml(card, index.get(`${card.providerAccountId}:${card.providerCardId}`), retireFailed)).join('')}</tbody></table>`
    : '<p class="empty-state">没有在役卡片</p>';
  if (!elements.stockCardsHistory) return;
  if (!history.length) { elements.stockCardsHistory.hidden = true; elements.stockCardsHistory.innerHTML = ''; return; }
  elements.stockCardsHistory.hidden = false;
  elements.stockCardsHistory.innerHTML =
    `<button class="cardfoldtoggle" type="button" data-history-toggle>▸ 历史（退役 / 卡台作废）${history.length} 张</button>
     <div class="cardtable" data-history-body hidden><table>${CARD_TABLE_HEAD}<tbody>${
       history.map((card) => cardRowHtml(card, index.get(`${card.providerAccountId}:${card.providerCardId}`), retireFailed)).join('')
     }</tbody></table></div>`;
}

/** ⑤ 待销清单：到期的才给按钮，未到期灰显剩余时间。规则全来自 card-retirement 端点。 */
function renderCardRetirement(retirement, labelByKind = new Map()) {
  if (!elements.cardRetirementList) return;
  if (!retirement || retirement.__error) {
    elements.cardRetirementList.innerHTML =
      '<p class="cardfail">待销清单读取失败，先别据此销卡。刷新重试。</p>';
    return;
  }
  const due = retirement.due || [];
  const notYet = retirement.notYetDue || [];
  if (!due.length && !notYet.length) {
    elements.cardRetirementList.innerHTML = '<p class="empty-state">当前没有待销的卡</p>';
    return;
  }
  const row = (item, ready) => `<tr class="${ready ? 'is-due' : 'is-notyet'}">
    <td class="cardmono">${escapeHtml(item.last4 || item.providerCardId || '—')}</td>
    <td>${escapeHtml(labelByKind.get(item.providerCode) || item.providerCode || '—')}</td>
    <td>${escapeHtml((item.reasonLabels || []).join('、') || '—')}</td>
    <td class="cardmono">${item.currentBalance == null ? '—' : `$${formatMoney(item.currentBalance)}`}</td>
    <td>${ready ? '已到期' : `还差 ${escapeHtml(remainingText(item.dueAt))}`}</td>
    <td>${ready
      ? `<button class="cardbtn is-primary" type="button" data-retire-confirm="${escapeHtml(item.cardId)}"
           data-retire-last4="${escapeHtml(item.last4 || '')}">我已在卡台删掉</button>`
      : '<span class="cardmuted">未到可销时间</span>'}</td>
  </tr>`;
  elements.cardRetirementList.innerHTML = `<table>
    <thead><tr><th>尾号</th><th>卡台</th><th>为什么待销</th><th>余额</th><th>可销时间</th><th></th></tr></thead>
    <tbody>${due.map((item) => row(item, true)).join('')}${notYet.map((item) => row(item, false)).join('')}</tbody>
    </table>
    <p class="cardnote">满 ${Number(retirement.minAgeHours ?? 6)} 小时才可销。「我已在卡台删掉」只登记，不会替你去卡台删卡。</p>`;
}

/* ---- 卡片页交互（D-280 ①⑤⑥）：容器上委托，重渲染不用重绑 ---- */

// 历史折叠
elements.stockCardsHistory?.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-history-toggle]');
  if (!toggle) return;
  const body = elements.stockCardsHistory.querySelector('[data-history-body]');
  if (!body) return;
  body.hidden = !body.hidden;
  toggle.textContent = toggle.textContent.replace(body.hidden ? '▾' : '▸', body.hidden ? '▸' : '▾');
});

// ① 查余额（底线是只读的：wallet_floor 挡开卡，改它属资金动作，归设置页）
elements.cardsRigs?.addEventListener('click', async (event) => {
  const walletButton = event.target.closest('[data-rig-wallet]');
  if (walletButton) {
    const accountCode = walletButton.dataset.rigWallet;
    const out = elements.cardsRigs.querySelector(`[data-rig-wallet-out="${CSS.escape(accountCode)}"]`);
    walletButton.disabled = true;
    walletButton.textContent = '查询中…';
    try {
      const wallet = await api('/api/v1/admin/backup-cards/highvcc/wallet');
      // 实时值，不落快照——显示时点明它是「刚查的」，别让人以为页面会自己刷新。
      walletButton.textContent = wallet.usdBalance == null ? '未返回余额' : `$${formatMoney(wallet.usdBalance)}`;
      if (out) out.textContent = `刚查于 ${formatTime(new Date().toISOString())}`;
    } catch (error) {
      walletButton.textContent = '查余额';
      walletButton.disabled = false;
      showNotice(`查询 highvcc 钱包失败：${error.message}`);
    }
    return;
  }

  // 「开卡…」不重做开卡流程——两台的开卡 UI 早就在下面的折叠区里（含金额、卡段、
  // 费用预估与确认闸门）。这里只负责把它展开并滚过去，免得再造一份会花钱的入口。
  const openButton = event.target.closest('[data-rig-open]');
  if (openButton) {
    const section = document.querySelector(
      openButton.dataset.rigOpen === 'hnskj' ? '#hnskj-open-card' : '#highvcc-open-card');
    if (!section) { showNotice('找不到这台的开卡区。'); return; }
    section.open = true;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const refreshButton = event.target.closest('[data-rig-refresh]');
  if (!refreshButton) return;
  const isHnskj = refreshButton.dataset.rigRefresh === 'hnskj';
  refreshButton.disabled = true;
  refreshButton.textContent = isHnskj ? '刷新中…' : '刷新中…（要几十秒）';
  try {
    if (isHnskj) {
      await api('/api/v1/admin/card-stock/provider-refresh', { method: 'POST' });
      showNotice('HNSKJ 卡台规则已刷新。', 'success');
    } else {
      const result = await api('/api/v1/admin/backup-cards/highvcc/refresh', { method: 'POST' });
      // 三步各自报成败——一步失败不掩盖另外两步真的做了什么。
      showNotice(result.failed?.length
        ? `部分失败：${result.failed.join('、')}；其余已完成。`
        : '已向 highvcc 拉取快照、钱包与流水。', result.failed?.length ? 'error' : 'success');
    }
    await loadStock();
  } catch (error) {
    showNotice(`刷新失败：${error.message}`);
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = '刷新这台';
  }
});

// ⑥ 手动用卡登记：标 RETIRED override（F-57 定的正确端点——卡不再分配，但仍留在待销里）
elements.stockCards?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-manual-use]');
  if (!button) return;
  const { account, ext, last4 } = button.dataset;
  if (!account || !ext) { showNotice('这张卡缺卡台标识，无法登记。'); return; }
  const answer = await askForm({
    title: `登记手动用卡 · ${last4 || ext}`,
    message: '登记后这张卡不再参与自动分配，仍会留在待销清单里等你销卡。这不会去卡台做任何操作。',
    fields: [{ name: 'reason', label: '用在哪了（必填，会进审计）', required: true }],
    confirmLabel: '登记', danger: true
  });
  if (!answer) return;
  try {
    await api('/api/v1/admin/card-operational-overrides', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerAccountId: account, externalCardId: ext,
        allocationPolicy: 'RETIRED', reason: answer.reason })
    });
    showNotice('已登记，这张卡不再参与分配。', 'success');
    await loadStock();
  } catch (error) { showNotice(`登记失败：${error.message}`); }
});

// ⑤ 「我已在卡台删掉」：确认词是端点要求的防误触闸门，保留
elements.cardRetirementList?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-retire-confirm]');
  if (!button) return;
  const cardId = button.dataset.retireConfirm;
  const last4 = button.dataset.retireLast4 || '';
  if (!/^\d{4}$/.test(last4)) { showNotice('这张卡没有四位尾号，只能用命令行登记。'); return; }
  const answer = await askForm({
    title: `登记已销卡 · ${last4}`,
    message: `确认你已经在卡台网站删掉了这张卡。系统只做登记，不会替你去删。输入「已销卡 ${last4}」确认。`,
    fields: [
      { name: 'confirmation', label: '确认词', required: true },
      { name: 'note', label: '备注（可选）' }
    ],
    confirmLabel: '登记退役', danger: true
  });
  if (!answer) return;
  try {
    await api('/api/v1/admin/card-retirement/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId, last4, confirmation: answer.confirmation, note: answer.note || null })
    });
    showNotice('已登记退役。', 'success');
    await loadStock();
  } catch (error) { showNotice(`登记失败：${error.message}`); }
});


/* ===== 设置页（第⑥步 B，B「一张大表」，Lemon 2026-09-20 挑定 / D-290）=====
   这些数真正决定「何时自动开卡、开多大金额、钱够不够、卡够不够格分配」。
   所以：不做失焦即存——改完先变色、出「保存」，点了才写，且只提交真的变了的格。 */

const SETTINGS_PLAN_LABELS = Object.freeze({ plus: 'Plus', pro_5x: 'Pro 5X', pro_20x: 'Pro 20X' });
const SETTINGS_PLAN_ORDER = ['plus', 'pro_5x', 'pro_20x'];

function settingsCell(field, value, extra = '') {
  return `<input class="wb-field set-f" type="number" step="${field === 'open_card_amount' ? '0.01' : '1'}"
    data-field="${field}" data-original="${escapeHtml(String(value))}" value="${escapeHtml(String(value))}"${extra}>`;
}

async function loadSettings() {
  if (!elements.settingsPolicies) return;
  let data;
  try {
    data = await api('/api/v1/admin/settings/supply');
  } catch {
    // 读不到就说读不到——绝不显示成「还没有配置」，那会让人以为该建一份新的
    const fail = '<p class="wb-qempty">设置读取失败，先不要照这里的值做判断。刷新重试。</p>';
    elements.settingsPolicies.innerHTML = fail;
    if (elements.settingsThresholds) elements.settingsThresholds.innerHTML = fail;
    if (elements.settingsGlobal) elements.settingsGlobal.innerHTML = fail;
    return;
  }
  state.settings = data;
  renderSettingsPolicies(data);
  renderSettingsThresholds(data);
  renderSettingsGlobal(data);
}

/** B 版：台×产品摊平成一张表，两台并排看得出哪里不一致。 */
function renderSettingsPolicies(data) {
  const rows = data.policies || [];
  if (!rows.length) { elements.settingsPolicies.innerHTML = '<p class="wb-qempty">还没有任何供给策略</p>'; return; }
  const byAccount = new Map();
  for (const row of rows) {
    if (!byAccount.has(row.accountCode)) byAccount.set(row.accountCode, []);
    byAccount.get(row.accountCode).push(row);
  }
  const minimums = data.minimumBalanceByPlan || {};
  const body = [...byAccount.entries()].map(([accountCode, list]) => {
    const label = list[0]?.providerKind === 'hnskj' ? 'HNSKJ 卡台' : 'highvcc卡台';
    const head = `<tr class="set-rig"><td colspan="6">${escapeHtml(label)} · ${escapeHtml(accountCode)}</td></tr>`;
    const ordered = SETTINGS_PLAN_ORDER
      .map((plan) => list.find((row) => row.productCode === plan))
      .filter(Boolean);
    return head + ordered.map((row) => `<tr data-account="${escapeHtml(row.providerAccountId)}"
        data-product="${escapeHtml(row.productCode)}">
      <td>${escapeHtml(SETTINGS_PLAN_LABELS[row.productCode] || row.productCode)}</td>
      <td>${settingsCell('target_available', row.targetAvailable)}</td>
      <td>${settingsCell('open_card_amount', Number(row.openCardAmount || 0).toFixed(2))}</td>
      <td>${settingsCell('daily_open_limit', row.dailyOpenLimit)}</td>
      <td class="set-ro">${minimums[row.productCode] == null ? '—' : `$${formatMoney(minimums[row.productCode])}`}</td>
      <td><button type="button" class="wb-btn sm out set-save" data-save-policy disabled>保存</button></td>
    </tr>`).join('');
  }).join('');
  elements.settingsPolicies.innerHTML = `<div class="set-table"><table>
    <thead><tr><th>产品</th><th>水位（保几张）</th><th>开卡金额</th><th>每日开卡上限</th>
      <th>最低余额<small>（在下方改）</small></th><th></th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function renderSettingsThresholds(data) {
  if (!elements.settingsThresholds) return;
  const wallets = (data.wallets || []).map((row) => {
    const label = row.providerKind === 'hnskj' ? 'HNSKJ 卡台' : 'highvcc卡台';
    return `<div class="set-kv" data-account="${escapeHtml(row.providerAccountId)}">
      <label>${escapeHtml(label)} <small>${escapeHtml(row.accountCode)} · 底线挡开卡，告警线只提醒</small></label>
      <span>
        ${settingsCell('wallet_floor', Number(row.walletFloor || 0).toFixed(2))}
        ${settingsCell('wallet_alert_threshold', Number(row.walletAlertThreshold || 0).toFixed(2))}
        <button type="button" class="wb-btn sm out set-save" data-save-wallet disabled>保存</button>
      </span></div>`;
  }).join('');
  const minimums = data.minimumBalanceByPlan || {};
  const mins = SETTINGS_PLAN_ORDER.map((plan) => `<div class="set-kv" data-plan="${plan}">
    <label>最低余额 · ${escapeHtml(SETTINGS_PLAN_LABELS[plan])} <small>低于它这张卡不参与分配</small></label>
    <span><input class="wb-field set-f" type="number" step="0.01" data-field="minimum_balance"
      data-original="${escapeHtml(String(minimums[plan] ?? ''))}" value="${escapeHtml(String(minimums[plan] ?? ''))}">
      <button type="button" class="wb-btn sm out set-save" data-save-minimum disabled>保存</button></span></div>`).join('');
  // D-221 要按产品，现在只有一个全局值 —— 只读显示并说清，不给改（Lemon 2026-09-20 定）
  const capacity = `<div class="set-kv">
    <label>每卡单数 <small>一张卡最多成功充几单</small></label>
    <span class="set-ro">全局 ${escapeHtml(String(data.maxSuccessfulPayments ?? '—'))}
      <span class="wb-chip warn">D-221 要按产品（Plus 3 / 5X 1 / 20X 1），现在只有这一个全局值，暂不可改</span></span></div>`;
  elements.settingsThresholds.innerHTML = wallets + mins + capacity;
}

function renderSettingsGlobal(data) {
  if (!elements.settingsGlobal) return;
  elements.settingsGlobal.innerHTML = `
    <div class="set-kv"><label>Session 门槛 <small>客户换 Session 的时间窗（小时）</small></label>
      <span class="set-ro">${escapeHtml(String(data.sessionReplacementWindowHours ?? '—'))} 小时
        <span class="wb-chip mute">暂不可改</span></span></div>
    <div class="set-kv"><label>账单地址 <small>Browser 付款时填的地址</small></label>
      <span><button type="button" class="wb-btn sm out" data-goto-billing>去诊断页配置 →</button></span></div>`;
}

/** 改过的格变色并启用该行/该项的保存按钮。 */
function settingsMarkDirty(input) {
  const changed = String(input.value) !== String(input.dataset.original ?? '');
  input.classList.toggle('is-dirty', changed);
  const scope = input.closest('tr') || input.closest('.set-kv');
  if (!scope) return;
  const dirty = [...scope.querySelectorAll('.set-f')].some(
    (item) => String(item.value) !== String(item.dataset.original ?? ''));
  const button = scope.querySelector('.set-save');
  if (button) button.disabled = !dirty;
}

async function loadStock() {
  const [payload, retirement] = await Promise.all([
    api('/api/v1/admin/card-stock'),
    // 读不到就说读不到——待销清单读失败时绝不能显示成「没有待销的卡」。
    api('/api/v1/admin/card-retirement/candidates').catch(() => ({ __error: true }))
  ]);
  const rigs = payload.byProvider || [];
  renderCardRigs(rigs);
  // 卡台显示名只有一份来源（后端 PROVIDER_LABELS），页面不自己拼「HNSKJ 卡台」这种字样
  const labelByKind = new Map(rigs.map((rig) => [rig.providerKind, rig.label]));
  renderCardRetirement(retirement, labelByKind);
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
  renderStockCards(payload.cards || [], retirement);
  await loadCardIntake().catch(() => {
    elements.cardIntakeList.innerHTML = '<p class="empty-state">新卡接管状态读取失败，请稍后刷新。</p>';
  });
  await loadHighvccStatus().catch(() => {
    if (elements.highvccTokenStatus) elements.highvccTokenStatus.innerHTML = '<p class="empty-state">highvcc token 状态读取失败，请稍后刷新。</p>';
  });
  elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

/** 向 highvcc 实时查钱包并渲染到开卡区（按需触发，不随页面加载跑）。 */
async function loadHighvccWallet() {
  if (!elements.highvccWalletStatus) return;
  elements.highvccWalletStatus.dataset.loaded = '1';
  elements.highvccWalletStatus.innerHTML = '<div><span><strong>正在向卡台查询…</strong></span></div>';
  try {
    const wallet = await api('/api/v1/admin/backup-cards/highvcc/wallet');
    elements.highvccWalletStatus.innerHTML = `<div><span><strong>卡台美元钱包 $${wallet.usdBalance}</strong>`
      + `<small>查询于 ${formatTime(new Date().toISOString())}；卡台自己的"押金"字段累计 $${wallet.usdDeposit}（含义未完全确认，实际能开多大金额以卡台报价为准，不代表这个数字能直接减）；已消费 $${wallet.usdConsume}</small></span></div>`;
  } catch {
    elements.highvccWalletStatus.innerHTML = '<div><span><strong>钱包余额读取失败</strong><small>不影响开卡，稍后刷新再看。</small></span></div>';
  }
}

async function loadHighvccStatus() {
  if (!elements.highvccTokenStatus) return;
  const status = await api('/api/v1/admin/backup-cards/highvcc/status');
  elements.highvccTokenStatus.innerHTML = status.configured
    ? `<div><span><strong>token 已配置</strong><small>上次更新 ${formatTime(status.updatedAt)}；2 小时不活动会过期，届时开卡会明确报错。</small></span></div>`
    : '<div><span><strong>还没有配置 token</strong><small>先在下方粘贴并保存，才能查询费用或开卡。</small></span></div>';
  if (!status.configured) {
    if (elements.highvccWalletStatus) elements.highvccWalletStatus.innerHTML = '';
    return;
  }
  // 余额一律按需查（Lemon 2026-09-20 定）：highvcc 钱包只有实时 API，没有快照。
  // 这里原先随 loadStock 自动查，等于「打开卡片页就打一次外网」——与台账栏那个
  // 「查余额」按钮的暗示（还没查）矛盾。现在改成展开开卡区或点按钮时才查。
  if (elements.highvccWalletStatus && !elements.highvccWalletStatus.dataset.loaded) {
    elements.highvccWalletStatus.innerHTML =
      '<div><span><strong>钱包余额未查询</strong><small>展开本区或点「刷新余额」时才向卡台查询。</small></span></div>';
  }
  if (elements.highvccVidSelect && elements.highvccVidSelect.dataset.loaded !== '1') {
    try {
      const { ranges } = await api('/api/v1/admin/backup-cards/highvcc/ranges');
      if (ranges?.length) {
        elements.highvccVidSelect.innerHTML = ranges.map((r) => `<option value="${escapeHtml(r.vid)}">${escapeHtml(r.name || r.vid)}${segmentVerdictLabel(r)}${r.vid === '708' ? '（默认）' : ''}</option>`).join('');
        // D-169: no preselected segment. 708 (513989) was the built-in default and is
        // the segment that declined 5 of 6 real payments, so defaulting to it quietly
        // spent money on the worst option. The operator now picks, with each segment's
        // own decline record printed next to it.
        elements.highvccVidSelect.insertAdjacentHTML('afterbegin', '<option value="">请选择卡段</option>');
        elements.highvccVidSelect.value = '';
        elements.highvccVidSelect.dataset.loaded = '1';
      }
    } catch {
      // Never block opening a card — but never let the fallback option pass for a
      // loaded list either. Silently keeping "513989（默认）" made the operator
      // believe the segment statistics had failed to deploy (2026-09-11), when in
      // truth the card platform token had expired and the list was never fetched.
      const option = elements.highvccVidSelect.querySelector('option');
      if (option && !option.dataset.unloadedMarked) {
        option.textContent = `${option.textContent}｜卡段列表未加载，无拒付统计（多半是卡台 token 过期）`;
        option.dataset.unloadedMarked = '1';
      }
    }
  }
}

// D-162: what this operator's own orders did on cards of this segment. Counts come from
// real payment attempts, so a segment nobody has paid with says nothing at all, and a
// segment with one or two attempts is marked "样本少" rather than condemned.
function segmentVerdictLabel(range) {
  const attempts = Number(range?.attempts) || 0;
  if (!attempts) return '';
  const ok = Number(range?.paidOk) || 0;
  const failed = Number(range?.paidFailed) || 0;
  switch (range?.verdict) {
    case 'HIGH_DECLINE': return `（高拒付 ${failed}/${attempts}）`;
    case 'MIXED': return `（拒付 ${failed}/${attempts}）`;
    case 'GOOD': return `（成功 ${ok}/${attempts}）`;
    case 'INSUFFICIENT': return `（样本少 ${ok}成/${failed}拒）`;
    default: return '';
  }
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
      <section class="detail-section"><h3>卡片交易</h3>
        <p class="card-description">「对应订单」只显示消费账本里明确记了交易号的那些；<strong>空＝账本没记，不代表这笔没有订单</strong>——不按时间相近去猜是哪一单。</p>
        <div class="mini-list">${data.transactions.length ? data.transactions.map((transaction) => {
          const linked = transaction.ledgerOrderCount > 1
            ? `<em class="tx-order-many">账本记了 ${transaction.ledgerOrderCount} 单</em>`
            : transaction.ledgerOrderPublicNo
              ? `<button type="button" class="text-button" data-card-order="${escapeHtml(transaction.ledgerOrderPublicNo)}">${escapeHtml(transaction.ledgerOrderPublicNo)}</button>`
              : '';
          return `<div><span><strong>${escapeHtml(cardTxTypeLabel(transaction.type))} · ${formatMoney(transaction.amount)} ${escapeHtml(transaction.currency)}</strong><small>${escapeHtml(transaction.tradeTimeRaw || formatTime(transaction.firstSeenAt))} · ${escapeHtml(transaction.merchantName || transaction.relatedTransactionId || transaction.providerTransactionId)}${linked ? ' · 订单 ' : ''}</small>${linked}</span><em>${escapeHtml(transaction.status)}</em></div>`;
        }).join('') : '<p class="empty-state">暂无已同步交易</p>'}</div></section>
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

// 四项校验（路线唯一 / 目标卡池可分配 / 卡台健康 / 版本对）里没过的那几项，原样给运营看。
function switchCheckReasons(error) {
  const checks = Array.isArray(error?.payload?.checks) ? error.payload.checks : [];
  const failed = checks.filter((item) => item && item.ok === false);
  if (!failed.length) return '原因未返回，请刷新后重试';
  return failed.map((item) => item.detail || item.code).join('；');
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
      body: JSON.stringify({ method, confirmation: `切换默认充值方式为 ${method}`, expectedCurrentMethod: state.rechargeMethod || 'NONE' })
    });
    showNotice(`默认充值方式已切换为${label}；只影响之后新建的订单。`, 'success');
    await loadOverview();
  } catch (error) {
    const messages = {
      browser_recharge_not_ready: 'Browser 执行器尚未就绪，默认充值方式没有改变。',
      default_recharge_route_unavailable: '对应充值路线不可用，默认充值方式没有改变。',
      default_recharge_method_confirmation_required: '确认信息不匹配，默认充值方式没有改变。',
      default_recharge_method_rejected: `切换被拒绝，默认充值方式没有改变：${switchCheckReasons(error)}`
    };
    showNotice(messages[error.message] || '默认充值方式切换失败，原设置未改变。');
    await loadOverview().catch(() => {});
  } finally {
    button.disabled = false;
  }
}


const TIMELINE_ACTION_LABELS = {
  'observe-page': '开始执行', 'session-bootstrap': '注入会话', 'session-replaced': '替换常驻会话', 'page-reset': '页面复位', 'page-reload-after-inject': '注入后刷新页面',
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
    if (controlRun && resolveUnknownEligible(controlRun)) actions.push('<button type="button" class="primary-small" data-order-run-control="RESOLVE_UNKNOWN_PAYMENT">确认核实结果</button>');
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
    elements.viewKicker.textContent = '运营驾驶舱';
    elements.viewTitle.textContent = '今天的运行情况';
    await loadOverview();
  } else if (view === 'cdks') {
    elements.viewKicker.textContent = '卡密管理';
    elements.viewTitle.textContent = '生成客户兑换码';
    // D-279 ④：以单码为主；批次列表退居其后，只当筛选与导出用。
    resetCdkCodePaging();
    await Promise.all([
      loadCdkCodes().catch(() => {}),
      loadCdkBatches().catch(() => {})
    ]);
  } else if (view === 'stock') {
    elements.viewKicker.textContent = '卡片';
    elements.viewTitle.textContent = '库存、卡台、导入、补钱';
    await Promise.all([loadStock(), loadProviderRoutes()]);
  } else if (view === 'diagnostics') {
    elements.viewKicker.textContent = '诊断';
    elements.viewTitle.textContent = '低频、只读为主';
    await Promise.all([loadDiagnostics(), loadReconciliationCases(), loadBrowserDispatchJobs(), loadBrowserRuns(), loadBillingAddressSettings()]);
  } else if (view === 'settings') {
    elements.viewKicker.textContent = '设置';
    elements.viewTitle.textContent = '按台×按产品 · 全局门槛 · 账单地址';
    await loadSettings();
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
  const payload = await api('/api/v1/admin/card-sources');
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
      <td>${!source.supportsBrowserRecharge ? '<small>不支持 Browser</small>' : active ? '<small>Browser 新订单使用中</small>' : '<small>可切换 · 去工作台切</small>'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="empty-state">暂无卡台配置</td></tr>';
}


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
// 卡台切换已统一到工作台（D-280 ⑦ / D-288）：那里带「同时接管 N 单」与四项校验。
// 卡片页这张表只读——同一个写操作不留两个入口（F-65 那类毛病的根）。
elements.manualCardSourceForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await sensitiveApi('/api/v1/admin/card-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountCode: elements.manualCardSourceCode.value.trim(), displayName: elements.manualCardSourceName.value.trim() }) });
    elements.manualCardSourceForm.reset(); showNotice('备用卡台已新增。', 'success'); await loadProviderRoutes();
  } catch (error) { showNotice(error.message || '新增备用卡台失败。'); }
});
document.querySelector('#refresh-button')?.addEventListener('click', async (event) => {
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
document.querySelector('#refresh-stock')?.addEventListener('click', async () => {
  try {
    await loadStock();
    showNotice('本地列表已刷新（未同步卡台）。', 'success');
  } catch { showNotice('库存读取失败。'); }
});
// 「开始营业」按钮已被 D-284 的三个 toggle（接单/派单/付款）取代，按钮和这段 handler 一起退休；
// /operations/start-business 端点保留，未在后台调用。
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
    showNotice('开卡任务已创建，供卡执行器每分钟领一次，稍后在下方任务列表看结果。');
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
elements.highvccOpenSite?.addEventListener('click', () => {
  window.open('https://www.highvcc.com', '_blank', 'noopener,noreferrer');
});
// 展开「一键开卡」时才查余额：开卡前本来就要看够不够钱，但没展开就不该打外网。
document.querySelector('#highvcc-open-card')?.addEventListener('toggle', (event) => {
  if (event.currentTarget.open && elements.highvccWalletStatus?.dataset.loaded !== '1') loadHighvccWallet();
});
elements.highvccRefreshWallet?.addEventListener('click', async () => {
  elements.highvccRefreshWallet.disabled = true;
  try {
    await loadHighvccWallet();
    showNotice('余额已刷新。', 'success');
  } catch {
    showNotice('余额刷新失败，请稍后重试。');
  } finally {
    elements.highvccRefreshWallet.disabled = false;
  }
});
elements.highvccTokenForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = elements.highvccTokenInput.value.trim();
  if (!token) return showNotice('请先粘贴 token。');
  const button = elements.highvccTokenForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await sensitiveApi('/api/v1/admin/backup-cards/highvcc/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
    });
    elements.highvccTokenInput.value = '';
    showNotice('token 已保存。', 'success');
    await loadHighvccStatus();
  } catch (error) {
    showNotice(error.message === 'highvcc_token_invalid' ? 'token 格式不对（太短或包含空白），请重新复制。' : 'token 保存失败。');
  }
  finally { button.disabled = false; }
});

let highvccQuoteTimer = null;
async function runHighvccQuote() {
  if (!elements.highvccOpenAmount) return;
  const amount = Number(elements.highvccOpenAmount.value);
  const vid = elements.highvccVidSelect?.value || '';
  if (!(amount > 0)) return;
  if (!vid) { elements.highvccCost.textContent = '请先选择卡段（每个卡段后面是它的真实拒付战绩）'; return; }
  elements.highvccQuoteButton.disabled = true;
  elements.highvccOpenButton.disabled = true;
  elements.highvccCost.textContent = '正在查询…';
  try {
    const quote = await api('/api/v1/admin/backup-cards/highvcc/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vid, amount })
    });
    elements.highvccCost.textContent = quote.feeDetail || `预计充值 $${amount}`;
    state.highvccQuotedAmount = amount;
    state.highvccQuotedVid = vid;
    state.highvccQuoteFee = quote.feeDetail || `$${amount}`;
    elements.highvccOpenButton.disabled = false;
  } catch (error) {
    const messages = {
      highvcc_token_missing: '还没有配置 token，请先在上方保存。',
      highvcc_token_expired: 'token 已过期，请重新获取并保存。',
    };
    elements.highvccCost.textContent = messages[error.message] || error.payload?.detail || '查询失败，请稍后重试。';
    state.highvccQuotedAmount = null;
    state.highvccQuotedVid = null;
  }
  finally { elements.highvccQuoteButton.disabled = false; }
}
elements.highvccQuoteButton?.addEventListener('click', runHighvccQuote);
// Auto-quote so the operator doesn't have to remember to click a separate button first:
// re-query (debounced) whenever the amount or segment changes, and once when the section is
// first expanded (it starts collapsed, so there is nothing to quote before that).
elements.highvccOpenAmount?.addEventListener('input', () => {
  clearTimeout(highvccQuoteTimer);
  elements.highvccOpenButton.disabled = true;
  highvccQuoteTimer = setTimeout(runHighvccQuote, 500);
});
elements.highvccVidSelect?.addEventListener('change', runHighvccQuote);
elements.highvccDetails?.addEventListener('toggle', () => {
  if (elements.highvccDetails.open && state.highvccQuotedAmount == null) runHighvccQuote();
});

elements.highvccOpenForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const amount = Number(elements.highvccOpenAmount.value);
  const vid = elements.highvccVidSelect?.value || '';
  if (!vid) { showNotice('请先选择卡段，不再默认使用 513989。'); return; }
  if (state.highvccQuotedAmount !== amount || state.highvccQuotedVid !== vid) {
    showNotice('金额或卡段和上次查询的不一致，请重新查询费用。');
    return;
  }
  const confirmation = `开卡 ${vid} ${amount}`;
  const segmentLabel = elements.highvccVidSelect?.selectedOptions?.[0]?.textContent || vid;
  if (!window.confirm(`确认在备用卡台 A（highvcc.com，卡段 ${segmentLabel}）开一张 $${amount} 的卡？\n\n${state.highvccQuoteFee}\n\n持卡人和地址由系统生成，开出后立即计入库存。`)) return;
  elements.highvccOpenButton.disabled = true;
  try {
    const result = await sensitiveApi('/api/v1/admin/backup-cards/highvcc/open', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vid, amount, confirmation })
    });
    showNotice(`开卡成功：尾号 ${result.last4}，${result.holder}，余额 $${result.balance}。已计入库存。`, 'success');
    state.highvccQuotedAmount = null;
    state.highvccQuotedVid = null;
    elements.highvccCost.textContent = '展开后自动查询费用…';
    await loadStock();
    await loadHighvccStatus(); // wallet balance just changed
  } catch (error) {
    const messages = {
      highvcc_token_missing: '还没有配置 token，请先在上方保存。',
      highvcc_token_expired: 'token 已过期，请重新获取并保存；这一步没有产生任何费用。',
      highvcc_open_confirmation_required: '确认词不匹配，没有开卡，请重试。',
      highvcc_open_duplicate_card: '卡台已开出这张卡，但它已经在库存里了（重复调用）；请去卡片列表核实，不要重复点击。',
      highvcc_invalid_amount: '金额超出允许范围（$1–200）。',
      // 钱已经花了、卡也真的开出来了，只是还没录进库存——detail 里已经是完整、可直接展示的说明
      // （含卡 ID 和补记命令），这里绝不能套用"没有扣款"的措辞，会跟 detail 自相矛盾。
      highvcc_open_no_pan: error.payload?.detail || '卡已经开出但录入失败，请联系执行者手动核对，不要重复点击。',
    };
    // A code we recognize is the clearest; next best is the platform's own reason text
    // (present whenever the platform cleanly rejected the request before spending anything);
    // only fall back to the "might have been charged" warning when neither is available.
    if (messages[error.message]) showNotice(messages[error.message]);
    else if (error.payload?.detail) showNotice(`卡台拒绝了这次开卡（没有扣款）：${error.payload.detail}`);
    else showNotice('开卡请求失败，原因未知；如果卡台侧已经扣款，请核对卡台余额记录，不要重复点击。');
    elements.highvccOpenButton.disabled = false;
  }
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
    // D-279 ①：结果区带批次号 / 产品 / 数量 / 时间，不只是批次号。
    const planLabel = PLAN_LABELS[payload.planType] || payload.planType || '—';
    elements.cdkBatchLabel.textContent =
      `批次 ${payload.batchNo} · ${planLabel} · ${payload.count} 个 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    elements.cdkResult.hidden = false;
    sessionStorage.removeItem('cdk-generation-request');
    // D-279 ⑥ 生成即复制：直接进剪贴板，省掉「全选再复制」。剪贴板可能被浏览器拒
    // （非安全上下文/无权限），那就如实说没复制上、码仍在上面框里，不假装成功。
    try {
      await navigator.clipboard.writeText(payload.codes.join('\n'));
      showNotice(`已生成 ${payload.count} 个${planLabel}码，并复制到剪贴板。`, 'success');
    } catch {
      showNotice(`已生成 ${payload.count} 个${planLabel}码；自动复制失败，请手动从上方复制。`, 'warning');
    }
    justGeneratedCodes = new Set(payload.codes);   // 列表里给这批标「刚生成」
    resetCdkCodePaging();
    loadCdkCodes().catch(() => {});
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
// 工作台 CDK 快捷「生成即复制」（D-279 第 6 条）：复用 cdks/generate + 幂等键 + 剪贴板。
document.querySelector('#wb-cdk-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const planType = document.querySelector('#wb-cdk-plan')?.value || 'plus';
  const count = Number(document.querySelector('#wb-cdk-count')?.value || 1);
  if (!Number.isInteger(count) || count < 1 || count > 1000) { showNotice('数量必须是 1–1000 之间的整数。'); return; }
  if (count > 10 && !window.confirm(`确认一次生成 ${count} 个 CDK？只创建批次，不下载不交付。`)) return;
  const stored = JSON.parse(sessionStorage.getItem('wb-cdk-request') || 'null');
  const key = stored?.count === count && (stored.planType || 'plus') === planType ? stored.key : crypto.randomUUID();
  sessionStorage.setItem('wb-cdk-request', JSON.stringify({ count, planType, key }));
  if (button) { button.disabled = true; button.textContent = '生成中…'; }
  try {
    const payload = await api('/api/v1/admin/cdks/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ count, planType })
    });
    sessionStorage.removeItem('wb-cdk-request');
    const text = (payload.codes || []).join('\n');
    try { await navigator.clipboard.writeText(text); showNotice(`已生成批次 ${payload.batchNo}（${payload.count} 个）并复制到剪贴板。`, 'success'); }
    catch { showNotice(`已生成批次 ${payload.batchNo}（${payload.count} 个）；剪贴板不可用，请到 CDK 页复制。`, 'warning'); }
  } catch (error) {
    showNotice(cdkErrorMessage(error, 'CDK 生成'));
  } finally {
    if (button) { button.disabled = false; button.textContent = '生成并复制'; }
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
    await applyBrowserCardSource(sourceApply);
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

// One-click highvcc token refresh: the bookmarklet on highvcc.com reads its own
// localStorage token and redirects the browser here with it in a URL *fragment* — fragments
// are never sent to any server (ours or highvcc's), so the token never crosses the network as
// part of this hand-off. We only need to read it client-side and forward it, same-origin, to
// the existing authenticated /token route. The hash is cleared immediately either way so it
// never lingers in the address bar or browser history.
// 2026-09-12：书签这条路一直失灵，原因是 api() 遇到 401 会 window.location.replace
// ('/admin/login')，那一跳把 hash 连同 token 一起丢了——而且恰好 admin_auth_required 不给提示，
// 于是整件事静默失败，Lemon 走完全流程什么都没看到（UX_PUNCHLIST 6.1b）。
// 所以在任何 api 调用之前，先把 token 从 URL 挪进 sessionStorage：它能跨过那次跳转活下来，
// 登录回来再完成保存。URL 也因此清得更早——比原来更不容易留在地址栏或历史里。
const HIGHVCC_TOKEN_STASH = 'highvcc-token-pending';
function stashHighvccTokenFromHash() {
  const match = /(?:^|[#&])highvcc-token=([^&]+)/.exec(location.hash);
  if (!match) return;
  try { sessionStorage.setItem(HIGHVCC_TOKEN_STASH, decodeURIComponent(match[1])); } catch { /* 存不了就只能这次失败 */ }
  history.replaceState(null, '', location.pathname + location.search);
}
stashHighvccTokenFromHash();

async function consumeHighvccTokenFromHash() {
  let token = '';
  try { token = sessionStorage.getItem(HIGHVCC_TOKEN_STASH) || ''; } catch { token = ''; }
  if (!token) return;
  // 先删再发：发送失败也不要让它留在 sessionStorage 里等下次莫名其妙地重放。
  try { sessionStorage.removeItem(HIGHVCC_TOKEN_STASH); } catch { /* 删不掉也继续 */ }
  try {
    await sensitiveApi('/api/v1/admin/backup-cards/highvcc/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
    });
    showNotice('highvcc 登录 token 已自动更新。', 'success');
  } catch {
    showNotice('highvcc token 自动更新失败，请到"卡片"页手动粘贴保存。');
  }
}

api('/api/v1/admin/session')
  .then(() => { switchView('overview'); return consumeHighvccTokenFromHash(); })
  .catch((error) => { if (error.message !== 'admin_auth_required') showNotice('后台暂时无法加载。'); });

// ——— D-279 ④⑤ / D-286：CDK 单码列表（明文码按 D-286 裁定直接显示，后台仅 Lemon 使用）———
async function loadCdkCodes() {
  const box = document.querySelector('#cdk-codes');
  if (!box) return;
  const params = new URLSearchParams({ limit: CDK_CODE_PAGE_SIZE, offset: cdkCodePage * CDK_CODE_PAGE_SIZE });
  const plan = document.querySelector('#cdk-code-plan')?.value;
  const status = document.querySelector('#cdk-code-status')?.value;
  const issued = document.querySelector('#cdk-code-issued')?.value;
  const q = document.querySelector('#cdk-code-q')?.value?.trim();
  if (plan) params.set('planType', plan);
  if (status) params.set('status', status);
  if (issued) params.set('issued', issued);
  if (q) params.set('q', q);

  let payload;
  let liability = null;
  try {
    [payload, liability] = await Promise.all([
      api(`/api/v1/admin/cdks/codes?${params}`),
      api('/api/v1/admin/cdks/liability').catch(() => null)
    ]);
  } catch {
    // 失败就说失败，不显示成「没有码」（F-63 同一个教训）。
    // 负债条也必须一起翻成失败态——否则它会留着上一次的旧数字，看着像「当前欠 0」，
    // 而这正是「失败冒充正常」的另一张脸。
    box.innerHTML = '<tr><td colspan="7" class="empty-cell">单码列表读取失败，请刷新重试。</td></tr>';
    const failBar = document.querySelector('#cdk-liability');
    if (failBar) failBar.innerHTML = '<span class="status-chip status-red"><i></i>读取失败，数字不可信，请刷新</span>';
    return;
  }

  // D-286 ①：欠客户多少次交付 vs 还能卖多少，摆在列表上方
  const bar = document.querySelector('#cdk-liability');
  if (bar) {
    // 用旧后台自己的 .status-chip（admin.css:171），不要用工作台的 .wb-chip ——
    // 后者定义是 `.workbench .wb-chip{...}`，而 CDK 页(#cdks-view)不在 .workbench 作用域里，
    // 写了也不生效，chip 会退化成糊在一起的纯文字。CDK 页换候光皮是后面统一做的事（D-283）。
    bar.innerHTML = liability
      ? `<span class="status-chip status-orange"><i></i>欠交付 ${liability.owed}</span>`
        + `<span class="status-chip status-green"><i></i>在手可卖 ${liability.stock}</span>`
        + `<span class="status-chip status-gray"><i></i>已交付 ${liability.delivered}</span>`
        + (liability.expired ? `<span class="status-chip status-red"><i></i>已过期 ${liability.expired}</span>` : '')
      : '<span class="status-chip status-gray"><i></i>负债汇总读取失败</span>';
  }

  box.innerHTML = payload.codes.length
    ? payload.codes.map((row) => {
      const label = cdkStatusLabel(row);
      const fresh = row.code && justGeneratedCodes.has(row.code);
      // 明文取不到时如实显示「—（批次未留明文）」，不编一个码出来
      const codeCell = row.code
        ? `<strong class="mono">${escapeHtml(row.code)}</strong>`
        : '<span class="muted">—（批次未留明文）</span>';
      const actions = [
        row.code ? `<button class="text-button" type="button" data-copy-cdk="${escapeHtml(row.code)}">复制</button>` : '',
        row.status === 'AVAILABLE' && !row.issuedAt ? `<button class="text-button" type="button" data-issue-cdk="${escapeHtml(row.id)}">标为已发出</button>` : '',
        row.status === 'AVAILABLE' && row.issuedAt ? `<button class="text-button" type="button" data-unissue-cdk="${escapeHtml(row.id)}">撤销已发出</button>` : '',
        row.status === 'AVAILABLE' ? `<button class="danger-small" type="button" data-revoke-cdk="${escapeHtml(row.id)}">作废</button>` : ''
      ].filter(Boolean).join('');
      return `<tr>
        <td>${codeCell}${fresh ? '<small class="cdk-fresh">刚生成</small>' : ''}</td>
        <td>${escapeHtml(PLAN_LABELS[row.planType] || row.planType || '—')}</td>
        <td><span class="cell-main">${escapeHtml(label.text)}</span>${row.issuedNote ? `<small>${escapeHtml(row.issuedNote)}</small>` : ''}</td>
        <td>${row.orderPublicNo ? `<button class="text-button" type="button" data-open-order="${escapeHtml(row.orderPublicNo)}">${escapeHtml(row.orderPublicNo)}</button>` : '—'}</td>
        <td>${escapeHtml(row.customerEmail || '—')}</td>
        <td>${formatTime(row.redeemedAt || row.issuedAt || row.createdAt)}</td>
        <td class="case-actions">${actions}</td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="7" class="empty-cell">没有符合条件的 CDK</td></tr>';

  const info = document.querySelector('#cdk-code-page-info');
  if (info) {
    const from = payload.total ? cdkCodePage * CDK_CODE_PAGE_SIZE + 1 : 0;
    const to = cdkCodePage * CDK_CODE_PAGE_SIZE + payload.codes.length;
    info.textContent = `${from}-${to} / 共 ${payload.total}`;
  }
  const more = document.querySelector('#cdk-code-more');
  if (more) more.disabled = (cdkCodePage + 1) * CDK_CODE_PAGE_SIZE >= payload.total;
  const prev = document.querySelector('#cdk-code-prev');
  if (prev) prev.disabled = cdkCodePage === 0;
}

// CDK 单码列表的交互（复制 / 标为已发出 / 撤销 / 作废 / 分页 / 筛选）
document.addEventListener('click', async (event) => {
  const copyBtn = event.target.closest('[data-copy-cdk]');
  if (copyBtn) {
    try {
      await navigator.clipboard.writeText(copyBtn.dataset.copyCdk);
      showNotice('卡密已复制。', 'success');
    } catch {
      showNotice('复制失败（浏览器未授权），请手动选中复制。');
    }
    return;
  }
  const issueBtn = event.target.closest('[data-issue-cdk]');
  if (issueBtn) {
    const note = window.prompt('发给谁 / 哪个渠道？（可留空，仅备注用）', '');
    if (note === null) return;
    try {
      await api(`/api/v1/admin/cdks/codes/${encodeURIComponent(issueBtn.dataset.issueCdk)}/issued`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, issued: true })
      });
      showNotice('已标记为发出；它现在算「欠客户的交付」，不再算在手库存。', 'success');
      await loadCdkCodes();
    } catch (error) { showNotice(cdkErrorMessage(error, '标记已发出')); }
    return;
  }
  const unissueBtn = event.target.closest('[data-unissue-cdk]');
  if (unissueBtn) {
    try {
      await api(`/api/v1/admin/cdks/codes/${encodeURIComponent(unissueBtn.dataset.unissueCdk)}/issued`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issued: false })
      });
      showNotice('已撤销「发出」标记，回到在手库存。', 'success');
      await loadCdkCodes();
    } catch (error) { showNotice(cdkErrorMessage(error, '撤销已发出')); }
    return;
  }
  const revokeBtn = event.target.closest('[data-revoke-cdk]');
  if (revokeBtn) {
    // 作废不可逆，且服务端只允许作废还没被用掉的码
    if (!window.confirm('确认作废这张卡密？\n\n作废后它不能再被兑换，且不可撤销。\n已经绑定订单的码不能在这里作废——那要走退款/补偿。')) return;
    const reason = window.prompt('作废原因（会记进审计）', '');
    if (reason === null) return;
    try {
      await api(`/api/v1/admin/cdks/codes/${encodeURIComponent(revokeBtn.dataset.revokeCdk)}/revoke`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      showNotice('已作废这张卡密。', 'success');
      await loadCdkCodes();
    } catch (error) { showNotice(cdkErrorMessage(error, '作废卡密')); }
    return;
  }
  if (event.target.closest('#cdk-code-more')) { cdkCodePage += 1; loadCdkCodes().catch(() => {}); return; }
  if (event.target.closest('#cdk-code-prev')) { cdkCodePage = Math.max(0, cdkCodePage - 1); loadCdkCodes().catch(() => {}); return; }
  if (event.target.closest('#refresh-cdk-codes')) { resetCdkCodePaging(); loadCdkCodes().catch(() => {}); }
});

document.querySelector('#cdk-code-filters')?.addEventListener('submit', (event) => {
  event.preventDefault();
  resetCdkCodePaging();
  loadCdkCodes().catch(() => showNotice('单码列表读取失败。'));
});

// data-open-order：从全局搜索的 CDK 匹配行、CDK 单码列表一键进订单详情。
// 这两处都渲染了按钮却一直没有处理器 —— 按钮能点但到不了对象，正是 F-64 批评的那种假落点。
document.addEventListener('click', (event) => {
  const jump = event.target.closest('[data-open-order]');
  if (!jump) return;
  const publicNo = jump.dataset.openOrder;
  if (!publicNo) return;
  openOrder(publicNo).catch(() => showNotice('订单详情打开失败，请重试。'));
});

/* ===== 顶层事件绑定（导航 / 订单筛选分页 / 导出 / 对账 / 全局搜索 / document 委托）=====
   2026-09-20 事故恢复：本轮删 loadCardFundingAttempts 时，我用「下一个 async function」
   当删除边界，把夹在两个函数之间的 14 个顶层绑定一起切掉了——侧边栏导航从此点不动。
   node --check 只查语法，测试走 snippet/harness 不碰这些绑定，所以 951 全绿而功能是坏的。
   教训：删代码要按语法边界，不能按「下一个某某」的字符串距离；UI 改完必须真点一遍。 */
elements.navItems.forEach((item) => item.addEventListener('click', () => switchView(item.dataset.view).catch(() => showNotice('数据读取失败，请稍后重试。'))));

document.querySelectorAll('[data-open-orders]').forEach((button) => button.addEventListener('click', () => switchView('orders')));

// 工作台数字墙 / 队列跳转（原绑在已删的 #metrics-grid，改 document 级委托）。
document.addEventListener('click', (event) => {
  const filterButton = event.target.closest('[data-order-filter]');
  const viewButton = event.target.closest('[data-target-view]');
  const jumpButton = event.target.closest('[data-view-jump]');
  const resolveCase = event.target.closest('[data-resolve-wb-case]');
  const openCaseOrder = event.target.closest('[data-open-case-order-wb]');
  const opSwitch = event.target.closest('[data-op]');
  if (opSwitch) { toggleOp(opSwitch.dataset.op, opSwitch.dataset.on !== 'true'); return; }
  const closeWbAlert = event.target.closest('[data-close-wb-alert]');
  if (closeWbAlert) { closeWbAlert.disabled = true; api(`/api/v1/admin/alerts/${encodeURIComponent(closeWbAlert.dataset.closeWbAlert)}/close`, { method: 'POST' }).then(() => loadOverview()).catch(() => { showNotice('提醒关闭失败，请重试。'); closeWbAlert.disabled = false; }); return; }
  if (resolveCase) { resolveReconciliationCase(resolveCase.dataset.resolveWbCase, { after: loadOverview }).catch(() => showNotice('案例解决失败，请重试。')); return; }
  if (openCaseOrder) { openOrder(openCaseOrder.dataset.openCaseOrderWb); return; }
  if (filterButton) switchView('orders', { status: filterButton.dataset.orderFilter });
  else if (viewButton) switchView(viewButton.dataset.targetView);
  else if (jumpButton) switchView(jumpButton.dataset.viewJump).catch(() => showNotice('数据读取失败，请稍后重试。'));
});

// 工作台全局定位搜索：回车带查询跳订单页做精确匹配（复用 orders/search 的 CDK 精确匹配）。
document.querySelector('#wb-search-input')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const q = event.currentTarget.value.trim();
  if (!q) return;
  state.query = q;
  switchView('orders').then(() => { if (elements.search) elements.search.value = q; }).catch(() => showNotice('搜索失败，请重试。'));
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

/* 设置页交互：改动标脏 → 点保存才写；只提交真的变了的格，逐项审计。 */
document.addEventListener('input', (event) => {
  const field = event.target.closest?.('.set-f');
  if (field) settingsMarkDirty(field);
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest?.('.set-save');
  if (!button || button.disabled) {
    if (event.target.closest?.('[data-goto-billing]')) switchView('diagnostics');
    return;
  }
  const scope = button.closest('tr') || button.closest('.set-kv');
  const dirty = [...scope.querySelectorAll('.set-f')].filter(
    (item) => String(item.value) !== String(item.dataset.original ?? ''));
  if (!dirty.length) return;
  button.disabled = true;
  button.textContent = '保存中…';
  const failed = [];
  for (const input of dirty) {
    const field = input.dataset.field;
    try {
      if (field === 'minimum_balance') {
        await api('/api/v1/admin/card-stock/minimum-balance', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: Number(input.value), planType: scope.dataset.plan })
        });
      } else if (button.hasAttribute('data-save-wallet')) {
        await api('/api/v1/admin/settings/provider-wallet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerAccountId: scope.dataset.account, field, value: Number(input.value) })
        });
      } else {
        await api('/api/v1/admin/settings/supply-policy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerAccountId: scope.dataset.account,
            productCode: scope.dataset.product, field, value: Number(input.value) })
        });
      }
      input.dataset.original = input.value;
      input.classList.remove('is-dirty');
    } catch (error) {
      // 一格失败不掩盖另外几格已经存进去了——逐格报，不说「保存失败」了事
      failed.push(`${field}：${error.payload?.detail || error.message}`);
      input.classList.add('is-bad');
    }
  }
  button.textContent = '保存';
  button.disabled = failed.length === 0;
  if (failed.length) {
    showNotice(`有 ${failed.length} 项没保存成功：${failed.join('；')}`);
  } else {
    showNotice('已保存，改动立刻生效。', 'success');
  }
  // 存完重读一次：让页面显示的是库里真实的值，而不是我刚敲进去的字
  await loadSettings().catch(() => {});
});
