const STATUS = Object.freeze({
  QUEUED: {
    label: '已排队',
    title: '订单已建立',
    description: '系统已收到订单，正在等待处理。',
    terminal: false,
    pollAfter: 5000
  },
  PROCESSING: {
    label: '处理中',
    title: '正在处理 Plus',
    description: '订单已进入处理流程，请不要重复提交。',
    terminal: false,
    pollAfter: 5000
  },
  REVIEWING: {
    label: '复核中',
    title: '订单正在复核',
    description: '系统需要进一步确认结果，请保留查询码并稍后查看。',
    terminal: false,
    pollAfter: 30000
  },
  SUCCESS: {
    label: '已成功',
    title: 'Plus 已开通',
    description: '本次订单已经处理完成。',
    terminal: true,
    pollAfter: null
  },
  FAILED: {
    label: '未成功',
    title: '订单未能完成',
    description: '本次订单未能完成，请保留查询码等待人工处理。',
    terminal: true,
    pollAfter: null
  }
});

const ERROR_MESSAGES = Object.freeze({
  invalid_order_request: '请检查提交内容。',
  incomplete_session: '账号 Session 不完整，请重新复制完整内容。',
  invalid_access_token: '账号 Session 无效，请重新获取完整内容。',
  invalid_access_token_claims: '账号 Session 无效，请重新获取完整内容。',
  access_token_expired: '账号 Session 已过期，请重新获取后提交。',
  access_token_near_expiry: '账号 Session 即将过期，请重新获取后提交。',
  invalid_session_token: '账号 Session 无效，请重新获取完整内容。',
  invalid_session_expiry: '账号 Session 的有效期信息无效，请重新获取。',
  session_expired: '账号 Session 已过期，请重新获取。',
  cdk_unavailable: 'CDK 不可用或已绑定订单，可切换到“查询进度”找回原订单。',
  ordering_paused: '当前暂停接收新订单，请稍后再试。',
  ordering_not_configured: '当前暂时无法创建订单，请稍后再试。',
  invalid_order_query: '请输入有效的订单查询码或原 CDK。',
  order_not_found: '没有找到对应订单，请检查输入。',
  rate_limited: '操作过于频繁，请稍后再试。',
  body_too_large: '账号 Session 内容过大，请检查是否粘贴了多余内容。',
  invalid_json: '请求内容不是有效 JSON。'
});

const elements = {
  tabs: [...document.querySelectorAll('[role="tab"]')],
  panels: [...document.querySelectorAll('[role="tabpanel"]')],
  submitForm: document.querySelector('#submit-form'),
  queryForm: document.querySelector('#query-form'),
  cdkInput: document.querySelector('#cdk-input'),
  sessionInput: document.querySelector('#session-input'),
  confirmInput: document.querySelector('#confirm-input'),
  queryInput: document.querySelector('#query-input'),
  submitButton: document.querySelector('#submit-button'),
  queryButton: document.querySelector('#query-button'),
  resultCard: document.querySelector('#result-card'),
  statusChip: document.querySelector('#status-chip'),
  statusLabel: document.querySelector('#status-label'),
  resultTitle: document.querySelector('#result-title'),
  resultDescription: document.querySelector('#result-description'),
  publicNo: document.querySelector('#public-no'),
  updatedAt: document.querySelector('#updated-at'),
  pollingNote: document.querySelector('#polling-note'),
  copyButton: document.querySelector('#copy-button'),
  notice: document.querySelector('#notice')
};

let pollTimer = null;
let pollingStartedAt = 0;

function switchTab(panelId) {
  for (const tab of elements.tabs) {
    const active = tab.dataset.tab === panelId;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of elements.panels) panel.hidden = panel.id !== panelId;
  hideNotice();
}

function setBusy(button, busy, busyText) {
  button.disabled = busy;
  const label = button.querySelector('span');
  if (!button.dataset.defaultText) button.dataset.defaultText = label.textContent;
  label.textContent = busy ? busyText : button.dataset.defaultText;
}

function showNotice(message, kind = 'error') {
  elements.notice.textContent = message;
  elements.notice.dataset.kind = kind;
  elements.notice.hidden = false;
  elements.notice.focus?.();
}

function hideNotice() {
  elements.notice.hidden = true;
  elements.notice.textContent = '';
  delete elements.notice.dataset.kind;
}

async function postJson(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('network_error');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error('invalid_response');
  }
  if (!response.ok) throw new Error(payload?.error || 'request_failed');
  return payload;
}

function customerMessage(error) {
  if (error.message === 'network_error') return '无法连接服务，请检查网络后重试。';
  if (error.message === 'invalid_response') return '服务返回异常，请稍后重试。';
  return ERROR_MESSAGES[error.message] || '操作未完成，请稍后重试。';
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `更新于 ${date.toLocaleString('zh-CN', { hour12: false })}`;
}

function rememberPublicNo(publicNo) {
  try { sessionStorage.setItem('pojia:lastPublicNo', publicNo); } catch { /* unavailable storage */ }
}

function readRememberedPublicNo() {
  try { return sessionStorage.getItem('pojia:lastPublicNo'); } catch { return null; }
}

function renderOrder(order, { scroll = true } = {}) {
  const normalizedStatus = STATUS[order.status] ? order.status : 'REVIEWING';
  const meta = STATUS[normalizedStatus];
  elements.resultCard.hidden = false;
  elements.statusChip.dataset.status = normalizedStatus;
  elements.statusLabel.textContent = meta.label;
  elements.resultTitle.textContent = meta.title;
  elements.resultDescription.textContent = meta.description;
  elements.publicNo.textContent = order.publicNo;
  elements.queryInput.value = order.publicNo;
  elements.updatedAt.textContent = formatTime(order.updatedAt);
  elements.pollingNote.textContent = meta.terminal
    ? '该订单已进入最终状态，自动查询已停止。'
    : `页面将在 ${Math.round(meta.pollAfter / 1000)} 秒后自动更新。`;
  rememberPublicNo(order.publicNo);
  if (scroll) elements.resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  schedulePoll(order.publicNo, meta);
}

function stopPolling() {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll(publicNo, meta) {
  stopPolling();
  if (meta.terminal || !meta.pollAfter) return;
  if (!pollingStartedAt) pollingStartedAt = Date.now();
  if (Date.now() - pollingStartedAt > 5 * 60 * 1000) {
    elements.pollingNote.textContent = '自动查询已暂停，可点击“查询当前状态”继续。';
    return;
  }
  pollTimer = window.setTimeout(async () => {
    if (document.hidden) {
      schedulePoll(publicNo, meta);
      return;
    }
    try {
      const payload = await postJson('/api/v1/orders/status', { publicNo });
      renderOrder(payload.order, { scroll: false });
    } catch {
      elements.pollingNote.textContent = '自动更新暂时失败，将稍后重试。';
      pollTimer = window.setTimeout(() => schedulePoll(publicNo, meta), 15000);
    }
  }, meta.pollAfter);
}

elements.tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % elements.tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + elements.tabs.length) % elements.tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = elements.tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = elements.tabs[nextIndex];
    switchTab(nextTab.dataset.tab);
    nextTab.focus();
  });
});

elements.submitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideNotice();
  const cdk = elements.cdkInput.value.trim();
  if (cdk.length < 8) return showNotice('请输入有效 CDK。');
  if (!elements.confirmInput.checked) return showNotice('请先核对 CDK 和账号信息。');

  let session;
  try {
    session = JSON.parse(elements.sessionInput.value);
  } catch {
    return showNotice('账号 Session 格式不正确，请检查后重试。');
  }
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return showNotice('请粘贴完整的账号 Session。');
  }

  setBusy(elements.submitButton, true, '正在安全提交…');
  try {
    const payload = await postJson('/api/v1/orders', { cdk, session });
    elements.sessionInput.value = '';
    elements.confirmInput.checked = false;
    pollingStartedAt = Date.now();
    renderOrder({ ...payload.order, status: 'QUEUED', updatedAt: null });
    showNotice('订单已建立，请保存订单查询码。', 'success');
  } catch (error) {
    if (error.message === 'cdk_unavailable') {
      elements.queryInput.value = cdk;
      switchTab('query-panel');
    }
    showNotice(customerMessage(error));
  } finally {
    session = null;
    setBusy(elements.submitButton, false, '');
  }
});

elements.queryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideNotice();
  stopPolling();
  const value = elements.queryInput.value.trim();
  if (!value) return showNotice('请输入订单查询码或原 CDK。');
  const query = value.startsWith('PJV1-') ? { publicNo: value } : { cdk: value };
  setBusy(elements.queryButton, true, '正在查询…');
  try {
    const payload = await postJson('/api/v1/orders/status', query);
    pollingStartedAt = Date.now();
    renderOrder(payload.order);
  } catch (error) {
    showNotice(customerMessage(error));
  } finally {
    setBusy(elements.queryButton, false, '');
  }
});

elements.copyButton.addEventListener('click', async () => {
  const value = elements.publicNo.textContent;
  if (!value || value === '—') return;
  try {
    await navigator.clipboard.writeText(value);
    elements.copyButton.textContent = '已复制';
    window.setTimeout(() => { elements.copyButton.textContent = '复制'; }, 1600);
  } catch {
    showNotice('复制失败，请手动选中订单查询码。');
  }
});

const lastPublicNo = readRememberedPublicNo();
if (lastPublicNo) elements.queryInput.value = lastPublicNo;
