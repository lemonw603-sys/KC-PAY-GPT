const STATUS_META = Object.freeze({
  CREATED: ['已创建', 'blue'],
  CARD_PURCHASING: ['开卡中', 'blue'],
  CARD_READY: ['卡片就绪', 'blue'],
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
  sync_card_transactions: '同步交易与退款'
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
    <td>${statusChip(order.status)}</td>
    <td>${card}</td>
    <td>${order.card?.refundStatus ? escapeHtml(order.card.refundStatus) : '—'}</td>
    <td>${formatTime(order.createdAt)}</td>
  </tr>`;
}

async function loadOverview() {
  const [overview, recent] = await Promise.all([
    api('/api/v1/admin/overview'),
    api('/api/v1/admin/orders?page=1&pageSize=6')
  ]);
  const metrics = [
    ['今日订单', overview.metrics.todayOrders, '今天新创建'],
    ['处理中', overview.metrics.processingOrders, '正在自动流转'],
    ['需要关注', overview.metrics.reviewingOrders, '等待人工确认'],
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

function renderKeyValues(items) {
  return `<dl class="key-values">${items.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value ?? '—')}</dd></div>`).join('')}</dl>`;
}

async function openOrder(publicNo) {
  elements.detailTitle.textContent = publicNo;
  elements.detailContent.innerHTML = '<p class="loading-state">正在读取订单详情…</p>';
  elements.detail.showModal();
  try {
    const data = await api(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}`);
    const order = data.order;
    elements.detailContent.innerHTML = `
      <section class="detail-section"><div class="detail-status">${statusChip(order.status)}<span>${formatTime(order.updatedAt)}</span></div>${renderKeyValues([
        ['客户邮箱', order.customerEmail], ['ChatGPT 账号 ID', order.chatgptAccountId],
        ['直充订单号', order.rechargeOrderNo], ['卡段 ID', order.cardTypeId],
        ['开卡金额', order.openCardAmount], ['失败代码', order.failureCode], ['失败原因', order.failureReason]
      ])}</section>
      <section class="detail-section"><h3>卡片与退款</h3>${data.card ? renderKeyValues([
        ['卡台卡片 ID', data.card.providerCardId], ['卡号后四位', data.card.last4],
        ['卡片状态', data.card.status], ['开卡金额', `${data.card.fundedAmount || '—'} ${data.card.currency || ''}`],
        ['当前余额', `${data.card.currentBalance || '—'} ${data.card.currency || ''}`], ['退款观察', data.card.refundStatus],
        ['最后同步', formatTime(data.card.lastSyncedAt)]
      ]) : '<p class="empty-state">尚未绑定卡片</p>'}</section>
      <section class="detail-section"><h3>订单时间线</h3><div class="timeline">${data.events.length ? data.events.map((event) => `<article><i></i><div><strong>${escapeHtml(STATUS_META[event.toStatus]?.[0] || event.toStatus)}</strong><p>${escapeHtml(event.reason)}</p><small>${formatTime(event.createdAt)} · ${escapeHtml(event.actorType)}</small></div></article>`).join('') : '<p class="empty-state">暂无事件</p>'}</div></section>
      <section class="detail-section"><h3>后台任务</h3><div class="mini-list">${data.tasks.length ? data.tasks.map((task) => `<div><span><strong>${escapeHtml(task.type)}</strong><small>${task.attempts}/${task.maxAttempts} 次尝试</small></span><em>${escapeHtml(task.status)}</em></div>`).join('') : '<p class="empty-state">暂无任务</p>'}</div></section>`;
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
  (state.view === 'overview' ? loadOverview() : loadOrders()).catch(() => showNotice('刷新失败，请稍后重试。'));
});
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/v1/admin/session', { method: 'DELETE' }).catch(() => {});
  window.location.replace('/admin/login');
});
document.querySelector('#close-detail').addEventListener('click', () => elements.detail.close());
elements.detail.addEventListener('click', (event) => { if (event.target === elements.detail) elements.detail.close(); });
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
