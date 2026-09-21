/* Display-only controller; existing order/card detail owns all business actions. */
(() => {
  const findings = {
    MATCHED: '次数一致', UNEXPLAINED_CHARGE: '卡台有扣款，账本无对应消费', LEDGER_AHEAD: '账本消费多于卡台记录',
    UNKNOWN_STATUS: '卡台交易状态无法判断', AWAITING_RESOLUTION: '付款未定，等待正式收口',
    PENDING_MANUAL_REGISTRATION: '已登记手动用卡，账本待补记', AMOUNT_DIFF: '金额存在差异', UNVERIFIABLE: '金额无法核对'
  };
  const reasons = { NO_VERIFIABLE_BASELINE: '缺少可信期初金额，不据此判定金额一致或异常。', UNREADABLE_BALANCE: '余额未读到，暂不能核对金额。', NEGATIVE_BALANCE: '余额为负，含义待核实；不取绝对值掩盖问题。' };
  window.createDiagnosticsPage = ({ api, escapeHtml: esc, formatTime, formatMoney, openOrder, openCard, showNotice, orderStatusLabel }) => {
    const $ = s => document.querySelector(s);
    let report = null, sources = new Map(), filter = 'difference', generation = 0, searchGeneration = 0;
    const count = n => n == null || !Number.isFinite(Number(n)) ? '—' : String(n);
    const money = n => n == null ? '—' : formatMoney(n, 'USD');
    const groups = () => ({ difference: report?.discrepancies || [], pending: report?.pendingRegistration || [], unverifiable: (report?.cards || []).filter(c => c.amount?.finding === 'UNVERIFIABLE') });
    function render() {
      const lists = groups();
      document.querySelectorAll('[data-diagnostic-filter]').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.diagnosticFilter === filter));
        b.querySelector('span').textContent = report ? lists[b.dataset.diagnosticFilter].length : '—';
      });
      if (!report) return;
      const rows = lists[filter];
      $('#diagnostics-card-report').innerHTML = !rows.length ? '<div class="diag-empty">这个分类下没有记录。</div>' : `<div class="table-wrap"><table><thead><tr><th>卡片 / 卡台</th><th>需要核对什么</th><th>证据状态</th><th>操作</th></tr></thead><tbody>${rows.map((c,i) => {
        const id = `diag-evidence-${i}`, label = filter === 'unverifiable' ? '金额无法核对' : (findings[c.count?.finding] || c.count?.finding || '尚未判断');
        return `<tr><td><b class="diag-mono">${c.last4 ? `尾号 ${esc(c.last4)}` : '未记录尾号'}</b><small>${esc(sources.get(c.providerAccountId) || '卡台名称未读取')}</small></td><td>${esc(label)}${c.amount?.finding === 'AMOUNT_DIFF' ? '<small>金额也存在差异</small>' : ''}</td><td><span class="diag-badge ${filter === 'difference' ? 'warn' : ''}">${filter === 'unverifiable' ? '无法判断' : filter === 'pending' ? '待补记' : '待核对'}</span>${c.inputVerified === false ? '<small>输入证据存疑，需确认同步情况</small>' : ''}</td><td><button class="diag-btn" data-diagnostic-expand="${id}" aria-controls="${id}" aria-expanded="false">展开明细</button></td></tr>
          <tr class="diag-evidence" id="${id}" hidden><td colspan="4"><div class="diag-evidence-grid"><div><strong>系统账本</strong><p>已消费 ${esc(count(c.count?.ledgerConsumed))} 笔 · 付款未定 ${esc(count(c.count?.ledgerReconciliation))} 笔</p></div><div><strong>卡台记录</strong><p>已结算 ${esc(count(c.count?.settled))} 笔 · 待结算 ${esc(count(c.count?.pending))} 笔</p><p>消费 ${esc(money(c.amount?.charged))} · 拒付及费用 ${esc(money(c.amount?.chargebacks))}</p></div></div><p>${esc(reasons[c.amount?.unverifiableReason] || (c.amount?.finding === 'AMOUNT_DIFF' ? `金额差额 ${money(c.amount.delta)}` : '金额以已有可验证证据为准。'))}</p><p>余额 ${esc(money(c.amount?.balance))} · 卡片同步 ${esc(formatTime(c.lastSyncedAt))}</p>${c.count?.finding === 'PENDING_MANUAL_REGISTRATION' ? '<p>已有手动用卡登记，不作为无主扣款；这里不自动补账。</p>' : ''}<p>这里只读展示，不自动补账、重付或推测交易归属。</p>${c.providerCardId ? `<button class="diag-btn link" data-diagnostic-card="${esc(c.providerCardId)}" data-provider-account="${esc(c.providerAccountId || '')}">查看卡片流水与已关联订单</button>` : '<p>缺少卡片定位信息，无法打开流水。</p>'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    }
    async function loadDaily() {
      const ticket = ++generation;
      $('#diagnostics-report-refresh').disabled = true;
      try {
        const [data, sourceData] = await Promise.all([api('/api/v1/admin/reconciliation/daily'), api('/api/v1/admin/card-sources').catch(() => null)]);
        if (ticket !== generation) return;
        if (!Array.isArray(data.discrepancies) || !Array.isArray(data.pendingRegistration) || !Array.isArray(data.cards)) throw Error('invalid report');
        report = data;
        sources = new Map((sourceData?.sources || []).map(s => [s.id, s.label || s.displayName || s.code || '未命名卡台']));
        $('#diagnostics-report-time').textContent = `只读核对 · ${formatTime(data.generatedAt)}`;
        render();
      } catch {
        if (ticket !== generation) return;
        report = null; render();
        $('#diagnostics-report-time').textContent = '读取失败，不能确认是否有差异';
        $('#diagnostics-card-report').innerHTML = '<div class="diag-error"><span>逐卡报告读取失败，不能当作没有差异。</span><button class="diag-btn" data-diagnostic-retry>重试</button></div>';
      } finally { if (ticket === generation) $('#diagnostics-report-refresh').disabled = false; }
    }
    $('#diagnostics-view').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.diagnosticFilter) { filter = b.dataset.diagnosticFilter; render(); }
      if (b.dataset.diagnosticExpand) { const row = document.getElementById(b.dataset.diagnosticExpand); row.hidden = !row.hidden; b.setAttribute('aria-expanded', String(!row.hidden)); b.textContent = row.hidden ? '展开明细' : '收起明细'; }
      if (b.hasAttribute('data-diagnostic-retry')) loadDaily();
      if (b.dataset.diagnosticCard) openCard(b.dataset.diagnosticCard, b.dataset.providerAccount).catch(() => showNotice('卡片明细读取失败，请重试。'));
      if (b.dataset.diagnosticOrder) openOrder(b.dataset.diagnosticOrder).catch(() => showNotice('订单详情读取失败，请重试。'));
    });
    $('#diagnostics-report-refresh').addEventListener('click', loadDaily);
    $('#diagnostics-order-search').addEventListener('submit', async e => {
      e.preventDefault(); const publicNo = $('#diagnostics-public-no').value.trim(); if (!publicNo) return;
      const ticket = ++searchGeneration; const out = $('#diagnostics-order-result'); out.innerHTML = '<div class="diag-empty">正在查找订单…</div>';
      try {
        const data = await api(`/api/v1/admin/orders/${encodeURIComponent(publicNo)}`);
        if (ticket !== searchGeneration) return;
        const o = data.order || data;
        out.innerHTML = `<div class="diag-order-result"><strong class="diag-mono">${esc(o.publicNo || publicNo)}</strong><p>${esc(o.statusLabel || (o.status && orderStatusLabel(o.status)) || '查看订单详情确认状态')}</p><button class="diag-btn primary" data-diagnostic-order="${esc(publicNo)}">查看订单经过与处理入口</button></div>`;
      } catch (error) {
        if (ticket !== searchGeneration) return;
        out.innerHTML = `<div class="diag-empty">${error.status === 404 || /not_found/.test(error.message) ? '没有找到这个订单，请核对完整订单号。' : '订单读取失败，请重试；不能判断该订单是否存在。'}</div>`;
      }
    });
    $('#diagnostics-clear-search').addEventListener('click', () => { searchGeneration++; $('#diagnostics-public-no').value = ''; $('#diagnostics-order-result').innerHTML = ''; $('#diagnostics-public-no').focus(); });
    return { loadDaily };
  };
})();
