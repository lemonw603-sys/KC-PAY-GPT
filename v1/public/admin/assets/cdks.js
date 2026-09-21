/* CDK page controller; owns only #cdks-view. Shared auth/notice/order navigation stay in admin.js. */
window.cdkBatchDate = function (value) {
  if (!value) return '日期未记录';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '日期未记录';
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type).value;
  return `${pick('year')}/${pick('month')}/${pick('day')}`;
};

window.createCdkPage = function ({ api, escapeHtml: esc, formatTime, showNotice, askForm, downloadCodes, downloadCdkStatusCsv }) {
  const root = document.querySelector('#cdks-view');
  const el = (id) => root.querySelector(`#${id}`);
  const labels = { plus: 'Plus', pro_5x: 'Pro 5X', pro_20x: 'Pro 20X' };
  let page = 0, sequence = 0, rows = [], fresh = null, batches = [], cursor = null, busy = false;
  const selected = new Set();
  const size = 50;
  const recovery = document.createElement('button');
  recovery.type = 'button'; recovery.className = 'cdk-link'; recovery.id = 'cdk-recover-request';
  recovery.textContent = '恢复上次未确认的生成参数'; recovery.hidden = true;
  el('cdk-form').append(recovery);
  function pendingRequest() {
    try { return JSON.parse(sessionStorage.getItem('cdk-generation-request')); } catch { return null; }
  }
  function syncRecovery() { recovery.hidden = !pendingRequest()?.signature; }
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const errors = {
    invalid_expiry: '有效期需要是未来时间；请检查后重试。',
    invalid_amount: '金额请填写非负数字，最多两位小数。',
    cdk_selection_conflict: '选中的码有状态变化或已被使用，本次没有修改；请刷新核对。',
    expiry_cannot_shorten: '已发出卡密只能延期，不能缩短或给不过期码加期限。',
    idempotency_mismatch: '本次参数与上次请求不一致，请先核对上次批次。',
    batch_download_unavailable: '历史批次未留明文，无法下载。',
    batch_recovery_failed: '批次恢复数据异常，已停止导出。'
  };
  const fail = (error) => showNotice(errors[error.message] || '服务器未确认操作结果，请刷新核对后再操作。');
  function clearSelection() {
    selected.clear();
    el('cdk-select-page').checked = false;
    el('cdk-select-page').indeterminate = false;
    el('cdk-bulk-actions').hidden = true;
    root.querySelectorAll('[data-cdk-select]').forEach((box) => { box.checked = false; });
  }
  function selectionChanged() {
    el('cdk-bulk-actions').hidden = !selected.size;
    el('cdk-selected-count').textContent = `本页已选 ${selected.size} 张`;
    const available = rows.filter((r) => r.status === 'AVAILABLE');
    el('cdk-select-page').checked = available.length > 0 && selected.size === available.length;
    el('cdk-select-page').indeterminate = selected.size > 0 && selected.size < available.length;
  }
  function label(row) {
    if (row.status === 'REVOKED') return ['已作废', ''];
    if (row.status === 'REDEEMED') {
      if (row.orderStatus === 'RECHARGE_SUCCESS') return ['已成功交付', 'ok'];
      if (['RECHARGE_FAILED', 'CLOSED'].includes(row.orderStatus)) return ['兑了没成 · 码没退回', 'warn'];
      return ['处理中', 'info'];
    }
    if (row.expired) return ['已过期', 'warn'];
    if (row.issuanceKind === 'LEGACY' && !row.issuedAt) return ['历史未分类', ''];
    return row.issuanceKind === 'RESERVE' && !row.issuedAt ? ['应急备码', ''] : ['待兑换', 'info'];
  }
  function renderRows() {
    el('cdk-codes').innerHTML = rows.map((row) => {
      const [text, tone] = label(row);
      const available = row.status === 'AVAILABLE';
      const destination = row.issuedNote || row.batchNote || (row.batchCount > 1 ? `${window.cdkBatchDate(row.createdAt)} 那批 · ${row.batchCount} 张` : '—');
      return `<tr>
        <td><input type="checkbox" data-cdk-select="${esc(row.id)}" aria-label="选择 ${esc(row.code || '历史卡密')}" ${available ? '' : 'disabled'}></td>
        <td><span class="cdk-code">${esc(row.code || '—（未留明文）')}</span><small>${row.expiresAt ? `有效至 ${esc(formatTime(row.expiresAt))}` : '不过期'}</small></td>
        <td>${esc(labels[row.planType] || row.planType)}</td>
        <td><span class="cdk-tag ${tone}">${esc(text)}</span>${row.historical ? '<small>09-07 前</small>' : ''}${available && !row.expired && !row.redeemableNow ? '<small>产品暂不可兑</small>' : ''}</td>
        <td>${row.batchCount > 1 ? `<button class="cdk-link" type="button" data-cdk-batch="${esc(row.batchNo)}">${esc(destination)}</button>` : esc(destination)}${row.issuanceKind === 'MARKETPLACE' ? '<small>卡网投放</small>' : ''}</td>
        <td>${row.orderPublicNo ? `<button type="button" class="cdk-link cdk-email" data-open-order="${esc(row.orderPublicNo)}">${esc(row.customerEmail || '查看订单')}</button>` : '—'}</td>
        <td>${esc(formatTime(row.latestAt))}</td>
        <td><div class="cdk-actions">${row.code ? `<button type="button" data-cdk-copy="${esc(row.id)}">复制</button>` : ''}${available ? `<button type="button" data-cdk-row="${esc(row.id)}" data-action="expiry">延期</button><button type="button" class="cdk-danger" data-cdk-row="${esc(row.id)}" data-action="revoke">作废</button>` : ''}</div></td>
      </tr>`;
    }).join('') || '<tr><td colspan="8">没有符合条件的卡密，可以调整筛选或生成新码。</td></tr>';
  }
  async function load({ reset = false, automatic = false } = {}) {
    // Preserve the user's selected snapshot until explicitly refreshed or acted on.
    if (automatic && (busy || selected.size || root.querySelector('input:focus,select:focus,textarea:focus'))) return;
    if (reset) page = 0;
    const ticket = ++sequence;
    const params = new URLSearchParams({ limit: size, offset: page * size });
    for (const [id, key] of [['cdk-code-q', 'q'], ['cdk-code-plan', 'planType'], ['cdk-code-status', 'state'], ['cdk-code-kind', 'issuanceKind'], ['cdk-code-batch', 'batchNo']]) {
      const value = el(id).value.trim(); if (value) params.set(key, value);
    }
    try {
      const [payload, summary] = await Promise.all([post('/api/v1/admin/cdks/search', Object.fromEntries(params)), api('/api/v1/admin/cdks/liability')]);
      if (ticket !== sequence) return;
      if (page && page * size >= payload.total) { page = Math.max(0, Math.ceil(payload.total / size) - 1); return load(); }
      rows = payload.codes; clearSelection(); renderRows();
      for (const key of ['pending', 'reserve', 'done', 'attention']) {
        root.querySelector(`[data-cdk-state="${key}"] b`).textContent = summary[key];
      }
      root.querySelector('[data-cdk-state="attention"] small').textContent = `不含历史残留 ${summary.historical} 张`;
      el('cdk-code-page-info').textContent = `${payload.total ? page * size + 1 : 0}–${page * size + rows.length} / 共 ${payload.total}`;
      el('cdk-code-prev').disabled = page === 0;
      el('cdk-code-more').disabled = (page + 1) * size >= payload.total;
      el('cdk-select-page').disabled = !rows.some((r) => r.status === 'AVAILABLE');
    } catch (error) {
      if (ticket !== sequence) return;
      rows = []; clearSelection();
      el('cdk-codes').innerHTML = '<tr><td colspan="8">读取失败，请点击刷新重试。</td></tr>';
      root.querySelectorAll('.cdk-kpis b').forEach((b) => { b.textContent = '—'; });
      el('cdk-code-page-info').textContent = '读取失败，数据未更新';
      el('cdk-code-prev').disabled = el('cdk-code-more').disabled = true;
      throw error;
    }
  }
  function renderBatchOptions() {
    const value = el('cdk-code-batch').value;
    el('cdk-code-batch').innerHTML = '<option value="">全部批次</option>' + batches.map((b) => `<option value="${esc(b.batchNo)}">${esc(b.note || window.cdkBatchDate(b.createdAt) + ' 那批')} · ${b.count} 张</option>`).join('');
    if (value && !batches.some((b) => b.batchNo === value)) el('cdk-code-batch').add(new Option('当前批次', value));
    el('cdk-code-batch').value = value;
    el('cdk-more-batches').hidden = !cursor;
  }
  async function loadBatches(more = false) {
    const payload = await api('/api/v1/admin/cdks/batch-options' + (more && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''));
    batches = more ? [...batches, ...payload.batches] : payload.batches;
    cursor = payload.nextCursor; renderBatchOptions(); batchInfo();
  }
  function batchInfo() {
    const b = batches.find((b) => b.batchNo === el('cdk-code-batch').value);
    el('cdk-batch-info').textContent = b ? `${b.note || '未填备注'} · ${b.count} 张 · 这批收 ${b.amount == null ? '未记录' : b.amount + ' ' + b.currency}` : '先筛选一个批次，再修改或导出。';
  }
  function selectBatch(batchNo) {
    if (!Array.from(el('cdk-code-batch').options).some((o) => o.value === batchNo)) el('cdk-code-batch').add(new Option('刚生成那批', batchNo));
    for (const id of ['cdk-code-q', 'cdk-code-plan', 'cdk-code-status', 'cdk-code-kind']) el(id).value = '';
    el('cdk-code-batch').value = batchNo; clearSelection(); batchInfo();
    return load({ reset: true });
  }
  function generationFields() {
    const multiple = Number(el('cdk-count').value) > 1;
    el('cdk-amount-field').hidden = el('cdk-currency-field').hidden = !multiple;
    if (multiple || el('cdk-kind').value !== 'NORMAL') el('cdk-extra').hidden = false;
    el('cdk-expiry-field').hidden = el('cdk-expiry-mode').value !== 'CUSTOM';
    el('cdk-expires-at').required = el('cdk-expiry-mode').value === 'CUSTOM';
  }
  function cstTimestamp(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('invalid_expiry');
    const date = new Date(value + ':00+08:00');
    if (!Number.isFinite(date.getTime())) throw new Error('invalid_expiry');
    return date.toISOString();
  }
  function displayFresh(payload) {
    fresh = payload;
    el('cdk-result').hidden = false;
    el('cdk-batch-label').textContent = `刚生成 ${payload.count} 张 · ${labels[payload.planType]}`;
    el('generated-cdks').value = payload.codes.join('\n');
    el('generated-cdks').rows = Math.min(4, Math.max(2, payload.count));
  }
  el('cdk-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy) return;
    const button = event.submitter || el('cdk-form').querySelector('[type=submit]');
    let payload;
    try {
      const input = { count: Number(el('cdk-count').value), planType: el('cdk-plan').value,
        issuanceKind: el('cdk-kind').value, expiryMode: el('cdk-expiry-mode').value,
        note: el('cdk-note').value.trim(), amount: Number(el('cdk-count').value) > 1 ? el('cdk-amount').value.trim() : '',
        currency: el('cdk-currency').value };
      if (input.expiryMode === 'CUSTOM') input.expiresAt = cstTimestamp(el('cdk-expires-at').value);
      if (input.count > 10 && !window.confirm(`确认生成 ${input.count} 张${labels[input.planType]}码？`)) return;
      const signature = JSON.stringify(input);
      const prior = pendingRequest();
      if (prior && prior.signature !== signature) {
        syncRecovery();
        showNotice('上次生成结果尚未确认。请点击“恢复上次未确认的生成参数”，再点生成核对原请求，不会重复生成。'); return;
      }
      const key = prior?.key || crypto.randomUUID();
      sessionStorage.setItem('cdk-generation-request', JSON.stringify({ signature, key }));
      syncRecovery();
      busy = true; button.disabled = true; button.textContent = '生成中…';
      payload = await api('/api/v1/admin/cdks/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: signature });
      sessionStorage.removeItem('cdk-generation-request'); syncRecovery(); displayFresh(payload);
      try { await navigator.clipboard.writeText(payload.codes.join('\n')); showNotice(`已生成 ${payload.count} 张并复制。`, 'success'); }
      catch { showNotice('已生成，但自动复制失败。请从结果框手动复制，不要重新生成。', 'warning'); }
    } catch (error) {
      // A definite validation rejection made no batch; allow corrected input.
      // Network/5xx outcomes retain the key, so retries recover the same batch.
      if (error.status === 400 && error.message !== 'idempotency_mismatch') {
        sessionStorage.removeItem('cdk-generation-request'); syncRecovery();
      }
      fail(error);
    }
    finally { busy = false; button.disabled = false; button.textContent = '生成并复制'; }
    if (payload) {
      try { await loadBatches(); await selectBatch(payload.batchNo); }
      catch { showNotice('生成已成功，列表刷新失败；卡密仍在上方结果框中。', 'warning'); }
    }
  });
  async function bulk(action, ids) {
    if (busy || !ids.length) return;
    busy = true;
    const input = { action, ids: [...ids] };
    try {
      if (action === 'revoke') {
        const answer = await askForm({ title: `作废选中的 ${ids.length} 张卡密？`, message: '只允许作废未使用卡密，不可撤销；若状态已变，本次全部不修改。', fields: [{ name: 'note', label: '原因（选填）' }], confirmLabel: '确认作废', danger: true });
        if (!answer) return; input.note = answer.note;
      } else if (action === 'issue') {
        const answer = await askForm({ title: `登记 ${ids.length} 张已发出`, fields: [{ name: 'note', label: '去向备注（选填）' }] });
        if (!answer) return; if (answer.note) input.note = answer.note;
      } else {
        const answer = await askForm({ title: `设置 ${ids.length} 张卡密有效期`, message: '北京时间，已发出卡密只能延期。', fields: [
          { name: 'expiryMode', label: '有效期', type: 'select', value: 'CUSTOM', options: [{ value: 'CUSTOM', label: '自定义截止时间' }, { value: 'NEVER', label: '不过期' }] },
          { name: 'date', type: 'datetime-local', label: '截止时间（选择不过期时留空）' }
        ] });
        if (!answer) return; input.expiryMode = answer.expiryMode;
        if (answer.expiryMode === 'CUSTOM') input.expiresAt = cstTimestamp(answer.date);
      }
      const result = await post('/api/v1/admin/cdks/bulk', input);
      showNotice(`已处理 ${result.selected} 张：修改 ${result.changed} 张，无需重复修改 ${result.unchanged} 张。`, 'success');
      fresh = null; el('cdk-result').hidden = true;
      clearSelection();
      try { await load(); } catch { showNotice('操作已成功，列表刷新失败；请点刷新核对。', 'warning'); }
    } catch (error) { fail(error); }
    finally { busy = false; }
  }
  root.addEventListener('change', (event) => {
    const check = event.target.closest('[data-cdk-select]');
    if (check) { check.checked ? selected.add(check.dataset.cdkSelect) : selected.delete(check.dataset.cdkSelect); selectionChanged(); }
    if (event.target.id === 'cdk-select-page') {
      selected.clear(); root.querySelectorAll('[data-cdk-select]:not(:disabled)').forEach((box) => {
        box.checked = event.target.checked; if (box.checked) selected.add(box.dataset.cdkSelect);
      }); selectionChanged();
    }
    if (event.target.id === 'cdk-kind') { el('cdk-expiry-mode').value = event.target.value === 'MARKETPLACE' ? 'NEVER' : 'DEFAULT'; }
    if (['cdk-kind', 'cdk-count', 'cdk-expiry-mode'].includes(event.target.id)) generationFields();
    if (event.target.closest('#cdk-code-filters')) { clearSelection(); batchInfo(); }
  });
  el('cdk-count').addEventListener('input', generationFields);
  el('cdk-code-filters').addEventListener('submit', (event) => { event.preventDefault(); clearSelection(); load({ reset: true }).catch(fail); });
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    try {
      if (button.dataset.cdkState) { el('cdk-code-status').value = button.dataset.cdkState; clearSelection(); await load({ reset: true }); }
      if (button.dataset.cdkBatch) await selectBatch(button.dataset.cdkBatch);
      if (button.dataset.cdkCopy) { await navigator.clipboard.writeText(rows.find((r) => r.id === button.dataset.cdkCopy).code); showNotice('已复制卡密。', 'success'); }
      if (button.dataset.cdkBulk) await bulk(button.dataset.cdkBulk, [...selected]);
      if (button.dataset.cdkRow) await bulk(button.dataset.action, [button.dataset.cdkRow]);
      switch (button.id) {
        case 'cdk-recover-request': {
          const pending = pendingRequest(); if (!pending?.signature) break;
          const input = JSON.parse(pending.signature);
          for (const [id,key] of [['cdk-count','count'],['cdk-plan','planType'],['cdk-kind','issuanceKind'],['cdk-expiry-mode','expiryMode'],['cdk-note','note'],['cdk-amount','amount'],['cdk-currency','currency']]) el(id).value = input[key] ?? '';
          if (input.expiresAt) el('cdk-expires-at').value = new Date(Date.parse(input.expiresAt) + 8 * 3600_000).toISOString().slice(0,16);
          generationFields(); showNotice('已恢复原参数。再次点击生成会核对同一个请求。'); break;
        }
        case 'cdk-clear-selection': clearSelection(); break;
        case 'cdk-code-prev': clearSelection(); page = Math.max(0, page - 1); await load(); break;
        case 'cdk-code-more': clearSelection(); page++; await load(); break;
        case 'refresh-cdk-codes': clearSelection(); await load(); await loadBatches(); break;
        case 'cdk-more-batches': await loadBatches(true); break;
        case 'cdk-toggle-note': el('cdk-extra').hidden = !el('cdk-extra').hidden; break;
        case 'cdk-dismiss': el('cdk-result').hidden = true; break;
        case 'copy-cdks': if (fresh) { await navigator.clipboard.writeText(fresh.codes.join('\n')); showNotice('已复制。', 'success'); } break;
        case 'download-cdks': if (fresh) downloadCodes(fresh.batchNo, fresh.codes); break;
        case 'cdk-original': case 'cdk-report': case 'cdk-batch-meta': {
          const batch = el('cdk-code-batch').value;
          if (!batch) { showNotice('请先筛选一个批次。'); break; }
          if (button.id === 'cdk-batch-meta') {
            const b = batches.find((b) => b.batchNo === batch);
            const answer = await askForm({ title: '修改整批备注与金额', message: '只修改这批属性，不改变卡密用途、状态或有效期。', fields: [
              { name: 'note', label: '去向备注（选填）', value: b?.note || '' },
              { name: 'amount', label: '这批收（选填）', value: b?.amount || '' },
              { name: 'currency', label: '币种', type: 'select', value: b?.currency || 'CNY', options: [{ value: 'CNY', label: 'CNY' }, { value: 'USD', label: 'USD' }] }
            ] });
            if (answer) { await post(`/api/v1/admin/cdks/${encodeURIComponent(batch)}/metadata`, answer); showNotice('整批备注与金额已保存。', 'success'); await loadBatches(); await load(); }
          } else {
            if (button.id === 'cdk-original' && !window.confirm('原始整批文件可能含已发出、已兑换、已作废或过期的码，仅供留档。确认下载？')) break;
            button.disabled = true;
            const result = await post(`/api/v1/admin/cdks/${encodeURIComponent(batch)}/${button.id === 'cdk-original' ? 'download' : 'status-report'}`, {});
            if (button.id === 'cdk-original') downloadCodes(result.batchNo, result.codes); else downloadCdkStatusCsv(result);
          }
          break;
        }
      }
    } catch (error) { fail(error); }
    finally { if (['cdk-original', 'cdk-report'].includes(button.id)) button.disabled = false; }
  });
  generationFields();
  syncRecovery();
  return { load, async enter() { clearSelection(); await Promise.all([load({ reset: true }), loadBatches()]); }, displayFresh };
};
