/* 订单页 v3 控制器（D-356/D-357）；只管 #orders-view。共享的 api / 通知 / 抽屉 / 动作留在 admin.js。
   冻结原型：docs/design/prototypes/step6-orders-v3.html；契约：docs/design/parity/orders-page.json。 */
window.createOrdersPage = function ({ api, escapeHtml: esc, showNotice, openOrder, actions, planLabels }) {
  const root = document.querySelector('#orders-view');
  // id 全局唯一；用 getElementById 也让测试沙箱（元素 stub 的 querySelector 返回 null）能加载。
  const el = (id) => document.getElementById(id);
  const PLAN = planLabels || { plus: 'Plus', pro_5x: '5X', pro_20x: '20X' };
  // 四桶 → 后端筛选名（口径在 admin-read-service：BUCKET_* 与 REVIEW_REQUIRED / PROCESSING 同一谓词）
  const BUCKET_STATUS = { all: '', processing: 'PROCESSING', success: 'BUCKET_SUCCESS', failed: 'BUCKET_FAILED', action: 'REVIEW_REQUIRED' };
  // 从工作台跳进来的旧筛选名（不属于四桶的）显示成一枚可摘掉的附加条件
  const EXTRA_TITLES = {
    TODAY: '今天的订单', ACTIVE: '进行中', FINISHED: '已结束', RECENT_FINISHED: '近 7 天统计样本',
    WAITING_FOR_SESSION: '等客户换 Session', RECONCILIATION_ISSUES: '付款与交易待核实', PAYMENT_UNKNOWN: '付款结果待核实'
  };
  const TONE = { blue: 'info', green: 'ok', orange: 'warn', red: 'danger', gray: '' };
  const FAIL = {
    CHECKOUT_DRIFT: '结账页变了', CHECKOUT_NAVIGATION_FAILED: '打不开结账页', PROVIDER_CONFIRMED_FAILURE: '卡台确认失败',
    CHECKOUT_OBSERVATION_FAILED: '结账页读不出', CARD_DECLINED: '卡被拒', CHATGPT_ACCESS_BLOCKED: '账号被拦',
    RECHARGE_SUBMIT_REJECTED: '提交被拒', BROWSER_RETRY_LIMIT: '重试用尽', PAYMENT_EXECUTION_FAILED: '付款执行失败',
    PAGE_DRIFT: '页面变了', PAGE_CHECKPOINT_FAILED: '页面检查失败', CANCELLED_PRE_SUBMISSION: '付款前取消',
    HUMAN_VERIFIED_NOT_CHARGED: '人工核实未扣款', PAYMENT_NOT_CHARGED_VERIFIED: '人工核实未扣款'
  };
  const state = { q: '', bucket: 'all', extra: '', planType: '', executorKind: '', from: '', to: '', page: 1, pageSize: 50, total: 0, expanded: new Set(), loaded: new Map() };
  const cst = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso); if (!Number.isFinite(d.getTime())) return '—';
    const p = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
  };
  const cstDay = (offsetDays = 0) => {
    const d = new Date(Date.now() - offsetDays * 86_400_000);
    const p = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  };
  function last7() { state.from = cstDay(6); state.to = cstDay(0); }

  function chip(o) {
    const stage = o.stage || {};
    let text = stage.label || o.status;
    if (['failed'].includes(o.bucket) && o.failureCode && FAIL[o.failureCode]) text = `${text}：${FAIL[o.failureCode]}`;
    if (o.bucket === 'action' && o.status === 'RECHARGE_SUCCESS') text = '已成功 · 续费待确认';
    const tone = o.bucket === 'action' ? 'warn' : (TONE[stage.tone] ?? '');
    return `<span class="od-chip ${tone}">${esc(text)}</span>`;
  }
  function rowAction(o) {
    const a = o.primaryAction;
    // 需要人但没有一键动作的单（例如已付款未交付、卡台调用卡住）：给「看详情」，不让「需要我处理」的行空着。
    if (!a) return o.bucket === 'action' ? `<button type="button" class="od-rowact" data-open="${esc(o.publicNo)}">看详情 ›</button>` : '';
    return `<button type="button" class="od-rowact${a.key === 'cancel' ? ' is-danger' : ''}" data-action="${esc(a.key)}" data-no="${esc(o.publicNo)}">${esc(a.label)} ›</button>`;
  }
  function routeCell(o) {
    const kind = o.routeExecutorKind === 'API' ? 'API' : (o.routeExecutorKind ? 'Browser' : '—');
    const card = o.card ? `<button type="button" class="od-cardlink" data-card="${esc(o.publicNo)}">${esc(o.card.providerLabel || '卡')} · ${esc(o.card.last4 || '')}</button>` : '未分卡';
    return `${kind}<small>${card}</small>`;
  }
  function mainRow(o) {
    const n = Number(o.historyCount || 0);
    const open = state.expanded.has(o.publicNo);
    const tries = n > 0 ? `<button type="button" class="od-tries" data-expand="${esc(o.publicNo)}" aria-expanded="${open}" title="此前 ${n} 次未成功，点开看" aria-label="此前 ${n} 次未成功，展开历史"><b>${n}</b><i aria-hidden="true"></i></button>` : '';
    return `<tr class="od-mainrow" data-no="${esc(o.publicNo)}">
      <td class="od-cust"><button type="button" class="od-email" data-open="${esc(o.publicNo)}">${esc(o.customerEmail || o.chatgptAccountId || o.publicNo)}</button>${tries}</td>
      <td class="od-plan">${esc(PLAN[o.planType] || o.productName || o.planType || '—')}</td>
      <td class="od-route">${routeCell(o)}</td>
      <td class="od-time">${esc(cst(o.createdAt))}</td>
      <td class="od-stagecell"><div class="od-stage">${chip(o)}${rowAction(o)}</div></td>
    </tr>`;
  }
  function histRow(o) {
    return `<tr class="od-hist" data-no="${esc(o.publicNo)}">
      <td class="od-cust"><span class="od-no"><button type="button" class="od-email od-no" data-open="${esc(o.publicNo)}">${esc(o.publicNo)}</button></span></td>
      <td class="od-plan">${esc(PLAN[o.planType] || o.planType || '—')}</td>
      <td class="od-route">${routeCell(o)}</td>
      <td class="od-time">${esc(cst(o.createdAt))}</td>
      <td class="od-stagecell"><div class="od-stage">${chip(o)}</div></td>
    </tr>`;
  }
  function renderCounts(buckets = {}) {
    for (const key of ['all', 'processing', 'success', 'failed', 'action']) {
      const i = root.querySelector(`[data-n="${key}"]`); if (!i) continue;
      const v = buckets[key]; i.textContent = v == null ? '—' : String(v);
      if (key === 'action') i.classList.toggle('has', Number(v) > 0);
    }
  }
  function renderExtra() {
    const box = el('od-extra'); if (!box) return;
    if (!state.extra) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `${esc(EXTRA_TITLES[state.extra] || state.extra)} <button type="button" data-clear-extra aria-label="去掉这个条件">×</button>`;
  }
  function syncControls() {
    root.querySelectorAll('[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(!state.extra && b.dataset.status === state.bucket)));
    el('od-q').value = state.q; el('od-plan').value = state.planType; el('od-route').value = state.executorKind;
    el('od-from').value = state.from; el('od-to').value = state.to;
    const isAll = !state.from && !state.to;
    root.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(isAll ? b.dataset.range === 'all' : b.dataset.range === '7' && state.from === cstDay(6) && state.to === cstDay(0))));
    renderExtra();
  }
  let seq = 0;
  async function load() {
    const my = ++seq;
    const tb = el('od-rows');
    const query = { page: state.page, pageSize: state.pageSize, includeSummary: true, groupByCdk: true, timeField: 'CREATED' };
    const status = state.extra || BUCKET_STATUS[state.bucket] || '';
    if (status) query.status = status;
    if (state.q) query.q = state.q;
    if (state.planType) query.planType = state.planType;
    if (state.executorKind) query.executorKind = state.executorKind;
    if (state.from) query.from = `${state.from}T00:00:00.000+08:00`;
    if (state.to) query.to = `${state.to}T23:59:59.999+08:00`;
    let payload;
    try {
      payload = await api('/api/v1/admin/orders/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
    } catch (error) {
      if (my !== seq) return;
      tb.innerHTML = `<tr><td colspan="5" class="od-empty">订单读取失败。<button type="button" class="od-rowact" data-retry>重试</button></td></tr>`;
      el('od-count').textContent = '';
      renderCounts({});
      if (error?.message !== 'admin_auth_required') showNotice('订单读取失败，请稍后重试。');
      return;
    }
    if (my !== seq) return;
    state.total = Number(payload.total || 0);
    renderCounts(payload.summary?.buckets || {});
    const match = el('od-cdkmatch');
    if (payload.cdkMatches?.length) {
      match.hidden = false;
      match.innerHTML = payload.cdkMatches.map((c) => `<span>卡密精确匹配：${esc(c.status)}${c.batchNo ? ` · 批次 ${esc(c.batchNo)}` : ''}</span>${c.orderPublicNo ? `<button type="button" class="od-rowact" data-open="${esc(c.orderPublicNo)}">${esc(c.customerEmail || c.orderPublicNo)} · 打开这一单 ›</button>` : '<span>尚未下单</span>'}`).join('');
    } else { match.hidden = true; match.innerHTML = ''; }
    const orders = payload.orders || [];
    const tries = orders.reduce((n, o) => n + 1 + Number(o.historyCount || 0), 0);
    tb.innerHTML = orders.length
      ? orders.map((o) => mainRow(o) + (state.expanded.has(o.publicNo) ? renderHist(o.publicNo) : '')).join('')
      : `<tr><td colspan="5" class="od-empty">${state.q || state.extra || state.bucket !== 'all' || state.planType || state.executorKind ? '这个范围内没有订单' : '还没有订单'}</td></tr>`;
    el('od-count').textContent = orders.length ? `${state.total} 个客户充值 · 本页 ${tries} 次尝试` : '';
    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    el('od-page-label').textContent = `第 ${state.page} / ${pages} 页`;
    el('od-prev').disabled = state.page <= 1; el('od-next').disabled = state.page >= pages;
    for (const no of state.expanded) if (!state.loaded.has(no)) loadHist(no);
  }
  function renderHist(no) {
    const rows = state.loaded.get(no);
    if (!rows) return `<tr class="od-hist" data-hist-loading="${esc(no)}"><td colspan="5" class="od-no">正在读取历史尝试…</td></tr>`;
    return rows.map(histRow).join('');
  }
  async function loadHist(no) {
    try {
      const payload = await api(`/api/v1/admin/orders/${encodeURIComponent(no)}/attempts`);
      state.loaded.set(no, payload.attempts || []);
    } catch { state.loaded.set(no, []); showNotice('历史尝试读取失败。'); }
    const anchor = root.querySelector(`tr.od-mainrow[data-no="${CSS.escape(no)}"]`); if (!anchor) return;
    root.querySelectorAll(`tr[data-hist-loading="${CSS.escape(no)}"]`).forEach((r) => r.remove());
    anchor.insertAdjacentHTML('afterend', renderHist(no));
  }
  function toggleHist(no) {
    if (state.expanded.has(no)) {
      state.expanded.delete(no);
      let next = root.querySelector(`tr.od-mainrow[data-no="${CSS.escape(no)}"]`)?.nextElementSibling;
      while (next && next.classList.contains('od-hist')) { const gone = next; next = next.nextElementSibling; gone.remove(); }
    } else {
      state.expanded.add(no);
      const anchor = root.querySelector(`tr.od-mainrow[data-no="${CSS.escape(no)}"]`);
      anchor?.insertAdjacentHTML('afterend', renderHist(no));
      if (!state.loaded.has(no)) loadHist(no);
    }
    const btn = root.querySelector(`.od-tries[data-expand="${CSS.escape(no)}"]`); if (btn) btn.setAttribute('aria-expanded', String(state.expanded.has(no)));
  }

  // ---- 确认框（取消放卡 / 标为已手工充值）----
  const confirmBox = document.querySelector('#od-confirm');
  function askConfirm({ title, text, okLabel, danger = false, fields = '' }) {
    return new Promise((resolve) => {
      confirmBox.querySelector('#od-confirm-title').textContent = title;
      confirmBox.querySelector('#od-confirm-text').textContent = text;
      confirmBox.querySelector('#od-confirm-fields').innerHTML = fields;
      const yes = confirmBox.querySelector('#od-confirm-yes'); yes.textContent = okLabel; yes.classList.toggle('danger', danger);
      const done = (value) => { confirmBox.removeEventListener('close', onClose); confirmBox.close(); resolve(value); };
      const onClose = () => done(null);
      yes.onclick = () => done(Object.fromEntries(new FormData(confirmBox.querySelector('form')).entries()));
      confirmBox.querySelector('#od-confirm-no').onclick = () => done(null);
      confirmBox.addEventListener('close', onClose);
      confirmBox.showModal();
    });
  }
  async function runAction(key, no) {
    if (key === 'verify') { openOrder(no); return; }
    if (key === 'renewal') { await actions.renewal(no, { after: load }); return; }
    if (key === 'cancel') {
      const ok = await askConfirm({ title: '取消这一单并放回卡？', text: `${no} 没有付款痕迹。取消后卡回到池子、卡密退回可用，客户可以直接重新兑换。服务器会再核对一次。`, okLabel: '取消并放卡', danger: true });
      if (ok) await actions.cancel(no, { after: load });
      return;
    }
    if (key === 'manual') {
      const ok = await askConfirm({
        title: '标为已手工充值？', text: `只有在你已经在系统外给 ${no} 手动充成功时才点。系统会记成功、卡放回池子，续费留给你确认；有付款痕迹的单服务器会拒绝。`,
        okLabel: '确认已手工充值',
        fields: `<label class="inline"><input type="checkbox" name="cardUsed" value="1"> 手动充值用的就是系统分配的这张卡（卡记一次消费）</label><label>备注（可选）<input type="text" name="reason" maxlength="300" placeholder="例如：比特浏览器手动付，卡尾 8718"></label>`
      });
      if (ok) await actions.manual(no, { cardUsed: ok.cardUsed === '1', reason: ok.reason || '', after: load });
    }
  }

  // ---- 事件 ----
  root.addEventListener('click', (event) => {
    const open = event.target.closest('[data-open]'); if (open) return openOrder(open.dataset.open);
    const card = event.target.closest('[data-card]'); if (card) return openOrder(card.dataset.card, { focus: 'money' });
    const ex = event.target.closest('[data-expand]'); if (ex) return toggleHist(ex.dataset.expand);
    const act = event.target.closest('[data-action]'); if (act) return runAction(act.dataset.action, act.dataset.no).catch((e) => { if (e?.message !== 'admin_auth_required') showNotice('操作没有完成，订单没有改变。'); });
    if (event.target.closest('[data-retry]')) return load();
    if (event.target.closest('[data-clear-extra]')) { state.extra = ''; state.page = 1; syncControls(); return load(); }
    const st = event.target.closest('[data-status]'); if (st) { state.bucket = st.dataset.status; state.extra = ''; state.page = 1; syncControls(); return load(); }
    const rg = event.target.closest('[data-range]'); if (rg) { if (rg.dataset.range === 'all') { state.from = ''; state.to = ''; } else last7(); state.page = 1; syncControls(); return load(); }
  });
  el('od-filters').addEventListener('submit', (e) => { e.preventDefault(); state.q = el('od-q').value.trim(); state.page = 1; load(); });
  let qTimer = null;
  el('od-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = el('od-q').value.trim(); state.page = 1; load(); }, 300); });
  el('od-plan').addEventListener('change', (e) => { state.planType = e.target.value; state.page = 1; load(); });
  el('od-route').addEventListener('change', (e) => { state.executorKind = e.target.value; state.page = 1; load(); });
  el('od-from').addEventListener('change', (e) => { state.from = e.target.value; state.page = 1; syncControls(); load(); });
  el('od-to').addEventListener('change', (e) => { state.to = e.target.value; state.page = 1; syncControls(); load(); });
  el('od-prev').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  el('od-next').addEventListener('click', () => { state.page += 1; load(); });

  last7();
  return {
    /** 进入订单页。status：四桶名或工作台的旧筛选名；query：全局定位搜索带来的词。 */
    async enter({ status = '', query = null } = {}) {
      if (query != null) { state.q = query; state.from = ''; state.to = ''; state.extra = ''; state.bucket = 'all'; }
      if (status) {
        if (BUCKET_STATUS[status] !== undefined) { state.bucket = status; state.extra = ''; }
        else if (status === 'REVIEW_REQUIRED') { state.bucket = 'action'; state.extra = ''; }
        else if (status === 'PROCESSING') { state.bucket = 'processing'; state.extra = ''; }
        else { state.extra = status; state.bucket = 'all'; }
        state.from = ''; state.to = ''; state.q = ''; state.page = 1;
      }
      syncControls();
      await load();
    },
    load,
    state
  };
};
