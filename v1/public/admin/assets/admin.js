const STATUS_META = Object.freeze({
  CREATED: ['已创建', 'blue'],
  CARD_PURCHASING: ['开卡中', 'blue'],
  CARD_PROVISIONING: ['等待卡片到账', 'blue'],
  CARD_READY: ['卡片就绪', 'blue'],
  CARD_FAILED: ['开卡失败', 'red'],
  SUBMITTING: ['提交中', 'blue'],
  SUBMIT_UNKNOWN: ['提交待确认', 'orange'],
  RECHARGE_PROCESSING: ['充值处理中', 'blue'],
  RECHARGE_SUCCESS: ['充值成功', 'green'],
  RECHARGE_FAILED: ['充值失败', 'red'],
  RECONCILIATION_REQUIRED: ['需要对账', 'orange'],
  CLOSED: ['已关闭', 'gray']
});

const SETTING_META = Object.freeze({
  accept_new_orders: '接收新订单',
  dispatch_new_recharges: '派发新充值',
  poll_existing_orders: '追踪已有订单',
  sync_card_transactions: '同步卡片交易（只读）'
});

const state = { view: 'overview', page: 1, pageSize: 20, total: 0, status: '', query: '' };
const elements = {
  navItems: [...document.querySelectorAll('.nav-item')],
  views: [...document.querySelectorAll('.view')],
  viewKicker: document.querySelector('#view-kicker'),
  viewTitle: document.querySelector('#view-title'),
  syncTime: document.querySelector('#sync-time'),
  metrics: document.querySelector('#metrics-grid'),
  statusList: document.querySelector('#status-list'),
  settingList: document.querySelector('#setting-list'),
  recentOrders: document.querySelector('#recent-orders'),
  ordersTable: document.querySelector('#orders-table'),
  filters: document.querySelector('#order-filters'),
  search: document.querySelector('#order-search'),
  statusFilter: document.querySelector('#status-filter'),
  orderCount: document.querySelector('#order-count'),
  pageLabel: document.querySelector('#page-label'),
  prevPage: document.querySelector('#prev-page'),
  nextPage: document.querySelector('#next-page'),
  detail: document.querySelector('#detail-drawer'),
  detailTitle: document.querySelector('#detail-title'),
  detailContent: document.querySelector('#detail-content'),
  notice: document.querySelector('#page-notice')
  ,alertsCard: document.querySelector('#alerts-card'), alertsList: document.querySelector('#alerts-list'),
  cdkForm: document.querySelector('#cdk-form'), cdkCount: document.querySelector('#cdk-count'),
  cdkResult: document.querySelector('#cdk-result'), generatedCdks: document.querySelector('#generated-cdks'),
  cdkBatchLabel: document.querySelector('#cdk-batch-label'), copyCdks: document.querySelector('#copy-cdks'),
  stockSummary: document.querySelector('#stock-summary'), stockJobs: document.querySelector('#stock-jobs'),
  stockThresholdForm: document.querySelector('#stock-threshold-form'), stockThreshold: document.querySelector('#stock-threshold'),
  stockOpenForm: document.querySelector('#stock-open-form'), stockOpenCount: document.querySelector('#stock-open-count'),
  stockOpenAmount: document.querySelector('#stock-open-amount'), stockCardType: document.querySelector('#stock-card-type'),
  stockConfirmation: document.querySelector('#stock-confirmation'), stockConfirmHint: document.querySelector('#stock-confirm-hint'),
  stockCost: document.querySelector('#stock-cost')
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

function statusChip(status) {
  const [label, tone] = STATUS_META[status] || [status || '未知', 'gray'];
  return `<span class="status-chip status-${tone}"><i></i>${escapeHtml(label)}</span>`;
}

function showNotice(message) {
  elements.notice.textContent = message;
  elements.notice.hidden = false;
}

function hideNotice() {
  elements.notice.hidden = true;
  elements.notice.textContent = '';
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

function orderRow(order) {
  const account = order.customerEmail || order.chatgptAccountId || '—';
  const card = order.card?.last4 ? `•••• ${escapeHtml(order.card.last4)}` : '—';
  return `<tr data-order="${escapeHtml(order.publicNo)}" tabindex="0">
    <td><strong class="order-link">${escapeHtml(order.publicNo)}</strong></td>
    <td><span class="cell-main">${escapeHtml(account)}</span>${order.rechargeOrderNo ? `<small>${escapeHtml(order.rechargeOrderNo)}</small>` : ''}</td>
    <td>${statusChip(order.status)}${order.cancellationReviewRequired ? '<small>续费需处理</small>' : ''}</td>
    <td>${card}</td>
    <td>${order.card?.refundStatus ? escapeHtml(order.card.refundStatus) : '—'}</td>
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
    ['今日订单', overview.metrics.todayOrders, '今天新创建'],
    ['处理中', overview.metrics.processingOrders, '正在自动流转'],
    ['需要关注', overview.metrics.reviewingOrders, '等待人工确认'],
    ['可用库存卡', overview.cardStock?.available ?? 0,
      overview.cardStock?.low ? `低于阈值 ${overview.cardStock?.lowThreshold ?? 5}` : `补卡阈值 ${overview.cardStock?.lowThreshold ?? 5}`],
    ['成功率', overview.metrics.successRate == null ? '—' : `${overview.metrics.successRate}%`, `累计 ${overview.metrics.totalOrders} 单`]
  ];
  elements.metrics.innerHTML = metrics.map(([label, value, note], index) => `<article class="metric-card metric-${index + 1}">
    <span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small>
  </article>`).join('');
  const maxCount = Math.max(1, ...overview.orderStatuses.map((item) => item.count));
  elements.statusList.innerHTML = overview.orderStatuses.length
    ? overview.orderStatuses.map((item) => `<button type="button" data-status="${escapeHtml(item.status)}">
      <span>${statusChip(item.status)}<strong>${item.count}</strong></span>
      <i class="status-bar"><b style="width:${Math.max(5, (item.count / maxCount) * 100)}%"></b></i>
    </button>`).join('')
    : '<p class="empty-state">还没有订单数据</p>';
  elements.settingList.innerHTML = overview.settings.map((setting) => {
    const enabled = setting.value === 'true';
    return `<div><span><strong>${escapeHtml(SETTING_META[setting.key] || setting.key)}</strong><small>${formatTime(setting.updatedAt)} 更新</small></span><em class="switch-state ${enabled ? 'is-on' : ''}">${enabled ? '开启' : '关闭'}</em></div>`;
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
  const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
  if (state.status) params.set('status', state.status);
  if (state.query) params.set('q', state.query);
  const payload = await api(`/api/v1/admin/orders?${params}`);
  state.total = payload.total;
  elements.ordersTable.innerHTML = payload.orders.length
    ? payload.orders.map(orderRow).join('')
    : '<tr><td colspan="6" class="empty-cell">没有符合条件的订单</td></tr>';
  const totalPages = Math.max(1, Math.ceil(payload.total / state.pageSize));
  elements.orderCount.textContent = `${payload.total} 条订单`;
  elements.pageLabel.textContent = `第 ${state.page} / ${totalPages} 页`;
  elements.prevPage.disabled = state.page <= 1;
  elements.nextPage.disabled = state.page >= totalPages;
  elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

const STOCK_JOB_LABELS = Object.freeze({
  PENDING: '等待执行', RUNNING: '执行中', COMPLETED: '已完成', REVIEW_REQUIRED: '需要核对'
});

async function loadStock() {
  const payload = await api('/api/v1/admin/card-stock');
  const totals = (payload.cardTypes || []).reduce((sum, item) => ({
    available: sum.available + item.available,
    provisioning: sum.provisioning + item.provisioning,
    assigned: sum.assigned + item.assigned
  }), { available: 0, provisioning: 0, assigned: 0 });
  elements.stockSummary.innerHTML = [
    ['可用', totals.available], ['处理中', totals.provisioning], ['已分配', totals.assigned]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  elements.stockThreshold.value = payload.threshold;
  elements.stockJobs.innerHTML = payload.jobs?.length
    ? payload.jobs.map((job) => `<div><span><strong>${escapeHtml(STOCK_JOB_LABELS[job.status] || job.status)} · ${job.openedCount}/${job.requestedCount} 张</strong><small>卡段 ${escapeHtml(job.cardTypeId)} · $${escapeHtml(job.amount)} / 张 · ${formatTime(job.createdAt)}${job.errorMessage ? ` · ${escapeHtml(job.errorMessage)}` : ''}</small></span><em>${escapeHtml(job.status)}</em></div>`).join('')
    : '<p class="empty-state">还没有后台补卡任务</p>';
  elements.syncTime.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

function updateStockEstimate() {
  const count = Math.max(0, Number(elements.stockOpenCount.value) || 0);
  const amount = Math.max(0, Number(elements.stockOpenAmount.value) || 0);
  elements.stockCost.textContent = `预计卡内本金：$${count * amount}`;
  elements.stockConfirmHint.textContent = `开${count}张`;
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

async function openOrder(publicNo) {
  elements.detailTitle.textContent = publicNo;
  elements.detailContent.innerHTML = '<p class="loading-state">正在读取订单详情…</p>';
  elements.detail.showModal();
  try {
    const data = await api(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}`);
    const order = data.order;
    const paymentGate = data.paymentGate || {};
    elements.detailContent.innerHTML = `
      <section class="detail-section"><h3>付款执行门</h3>${renderKeyValues([
        ['付款前检查', paymentGate.prepaymentReady ? '已就绪' : '未就绪'],
        ['直充状态', paymentGate.submissionLocked ? '已锁定' : '已针对本订单一次性放行'],
        ['放行凭证', paymentGate.permitStatus || 'LOCKED'],
        ['直充任务', paymentGate.submissionTaskStatus],
        ['直充执行次数', paymentGate.submissionAttempts ?? 0],
        ['放行过期时间', formatTime(paymentGate.permitExpiresAt)]
      ])}</section>
      <section class="detail-section"><div class="detail-status">${statusChip(order.status)}<span>${formatTime(order.updatedAt)}</span></div>${renderKeyValues([
        ['客户邮箱', order.customerEmail], ['ChatGPT 账号 ID', order.chatgptAccountId],
        ['直充订单号', order.rechargeOrderNo], ['卡段 ID', order.cardTypeId],
        ['开卡金额', order.openCardAmount], ['最低所需卡余额', order.minimumRequiredCardBalance],
        ['实际支付', order.actualPaymentAmount ? `${order.actualPaymentAmount} ${order.actualPaymentCurrency || ''}` : null],
        ['自动续费', order.subscriptionCancelled === 1 ? '已取消' : order.cancellationReviewRequired ? '需要人工处理' : order.subscriptionCancelled === 0 ? '等待确认' : '未开始'],
        ['续费复查时间', formatTime(order.cancellationCheckedAt)],
        ['失败代码', order.failureCode], ['失败原因', order.failureReason]
      ])}</section>
      <section class="detail-section"><div class="detail-section-heading"><h3>卡片与退款</h3>${data.card ? '<button type="button" class="primary-small" id="sync-transactions">同步交易</button>' : ''}</div>${data.card ? renderKeyValues([
        ['卡台卡片 ID', data.card.providerCardId], ['卡号后四位', data.card.last4],
        ['卡片状态', data.card.status], ['开卡金额', `${data.card.fundedAmount || '—'} ${data.card.currency || ''}`],
        ['当前余额', `${data.card.currentBalance || '—'} ${data.card.currency || ''}`], ['退款观察', data.card.refundStatus],
        ['最后同步', formatTime(data.card.lastSyncedAt)]
      ]) : '<p class="empty-state">尚未绑定卡片</p>'}</section>
      <section class="detail-section"><h3>卡片交易</h3><div class="mini-list">${data.transactions?.length ? data.transactions.map((transaction) => `<div><span><strong>${escapeHtml(transaction.type)} · ${escapeHtml(transaction.amount)} ${escapeHtml(transaction.currency)}</strong><small>${escapeHtml(transaction.merchantName || transaction.relatedTransactionId || transaction.providerTransactionId)} · ${escapeHtml(transaction.tradeTimeRaw || formatTime(transaction.firstSeenAt))}</small></span><em>${escapeHtml(transaction.status)}</em></div>`).join('') : '<p class="empty-state">暂无已同步交易</p>'}</div></section>
      <section class="detail-section"><h3>订单时间线</h3><div class="timeline">${data.events.length ? data.events.map((event) => `<article><i></i><div><strong>${escapeHtml(STATUS_META[event.toStatus]?.[0] || event.toStatus)}</strong><p>${escapeHtml(event.reason)}</p><small>${formatTime(event.createdAt)} · ${escapeHtml(event.actorType)}</small></div></article>`).join('') : '<p class="empty-state">暂无事件</p>'}</div></section>
      <section class="detail-section"><h3>后台任务</h3><div class="mini-list">${data.tasks.length ? data.tasks.map((task) => `<div><span><strong>${escapeHtml(task.type)}</strong><small>${task.attempts}/${task.maxAttempts} 次尝试</small></span><em>${escapeHtml(task.status)}</em></div>`).join('') : '<p class="empty-state">暂无任务</p>'}</div></section>`;
    document.querySelector('#sync-transactions')?.addEventListener('click', (event) => requestTransactionSync(publicNo, event.currentTarget));
  } catch {
    elements.detailContent.innerHTML = '<p class="empty-state">订单详情读取失败，请稍后重试。</p>';
  }
}

async function switchView(view, { status = '' } = {}) {
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
    elements.syncTime.textContent = '仅内部管理员可操作';
  } else if (view === 'stock') {
    elements.viewKicker.textContent = '资金与库存';
    elements.viewTitle.textContent = '卡片库存与人工补卡';
    await loadStock();
  } else {
    elements.viewKicker.textContent = view === 'exceptions' ? '人工处理' : '订单中心';
    elements.viewTitle.textContent = view === 'exceptions' ? '需要关注的订单' : '全部订单';
    elements.statusFilter.value = state.status === 'REVIEW_REQUIRED' ? '' : state.status;
    await loadOrders();
  }
}

for (const [status, [label]] of Object.entries(STATUS_META)) {
  elements.statusFilter.insertAdjacentHTML('beforeend', `<option value="${status}">${escapeHtml(label)}</option>`);
}

elements.navItems.forEach((item) => item.addEventListener('click', () => switchView(item.dataset.view).catch(() => showNotice('数据读取失败，请稍后重试。'))));
document.querySelectorAll('[data-open-orders]').forEach((button) => button.addEventListener('click', () => switchView('orders')));
elements.statusList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-status]');
  if (button) switchView('orders', { status: button.dataset.status });
});
elements.filters.addEventListener('submit', (event) => {
  event.preventDefault();
  state.page = 1;
  state.query = elements.search.value.trim();
  state.status = elements.statusFilter.value;
  loadOrders().catch(() => showNotice('订单查询失败，请稍后重试。'));
});
elements.prevPage.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadOrders(); } });
elements.nextPage.addEventListener('click', () => { if (state.page * state.pageSize < state.total) { state.page += 1; loadOrders(); } });
document.querySelector('#refresh-button').addEventListener('click', () => {
  hideNotice();
  (state.view === 'overview' ? loadOverview() : state.view === 'stock' ? loadStock() : loadOrders()).catch(() => showNotice('刷新失败，请稍后重试。'));
});
document.querySelector('#refresh-stock')?.addEventListener('click', () => loadStock().catch(() => showNotice('库存读取失败。')));
document.querySelectorAll('.stock-preset').forEach((button) => button.addEventListener('click', () => {
  elements.stockOpenCount.value = button.dataset.count;
  updateStockEstimate();
}));
elements.stockOpenCount?.addEventListener('input', updateStockEstimate);
elements.stockOpenAmount?.addEventListener('input', updateStockEstimate);
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
elements.stockOpenForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const count = Number(elements.stockOpenCount.value);
  const amount = Number(elements.stockOpenAmount.value);
  const expected = `开${count}张`;
  if (elements.stockConfirmation.value.trim() !== expected) {
    showNotice(`请输入确认词“${expected}”。`);
    return;
  }
  if (!window.confirm(`确认创建 ${count} 张、每张 $${amount} 的开卡任务？预计卡内本金 $${count * amount}。`)) return;
  const button = elements.stockOpenForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/v1/admin/card-stock/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, amount, cardTypeId: elements.stockCardType.value.trim(), confirmation: expected })
    });
    elements.stockConfirmation.value = '';
    showNotice('开卡任务已创建，服务器将在约 10 秒内开始执行。');
    await loadStock();
  } catch { showNotice('任务创建失败；可能已有任务正在执行。'); }
  finally { button.disabled = false; }
});
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/v1/admin/session', { method: 'DELETE' }).catch(() => {});
  window.location.replace('/admin/login');
});
document.querySelector('#close-detail').addEventListener('click', () => elements.detail.close());
elements.detail.addEventListener('click', (event) => { if (event.target === elements.detail) elements.detail.close(); });
window.setInterval(() => {
  if (state.view === 'stock' && !document.hidden) loadStock().catch(() => {});
}, 5000);
elements.cdkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideNotice();
  const button = elements.cdkForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = '生成中…';
  try {
    const payload = await api('/api/v1/admin/cdks/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: Number(elements.cdkCount.value) })
    });
    elements.generatedCdks.value = payload.codes.join('\n');
    elements.generatedCdks.rows = Math.min(Math.max(payload.codes.length, 3), 18);
    elements.cdkBatchLabel.textContent = `批次 ${payload.batchNo} · ${payload.count} 个`;
    elements.cdkResult.hidden = false;
  } catch (error) {
    showNotice(error.message === 'invalid_count' ? '生成数量必须为 1–1000 之间的整数。' : 'CDK 生成失败，请稍后重试。');
  } finally {
    button.disabled = false;
    button.textContent = '生成 CDK';
  }
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
  const row = event.target.closest('tr[data-order]');
  if (row) openOrder(row.dataset.order);
});
document.addEventListener('keydown', (event) => {
  const row = event.target.closest?.('tr[data-order]');
  if (row && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openOrder(row.dataset.order);
  }
});

api('/api/v1/admin/session')
  .then(() => switchView('overview'))
  .catch((error) => { if (error.message !== 'admin_auth_required') showNotice('后台暂时无法加载。'); });
