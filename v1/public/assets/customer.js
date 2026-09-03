/* =========================================================================
   customer.js — 客户充值页视图状态机与真实客户 API 契约。
   关键不变量：
   1) 填写页仅在本地解析 Session 读取邮箱并就地显示，绝不发任何请求。
   2) 只有客户点「确认无误，创建订单」后，才调用 createOrder（恰好一次）。
   3) 页面只展示邮箱；Session / Token 全文不回显，创建成功后清空输入。
   4) 状态一律来自客户契约映射态（7 步进展链 + 复核/待换号/失败分支），从不显示内部/卡台/资金状态。
   ========================================================================= */
(function () {
  'use strict';

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
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('invalid_response'); }
    if (!response.ok) throw new Error(payload?.error || 'request_failed');
    return payload;
  }

  const api = Object.freeze({
    createOrder: (body) => postJson('/api/v1/orders', body),
    replaceSession: (body) => postJson('/api/v1/orders/session', body),
    getStatus: (body) => postJson('/api/v1/orders/status', body)
  });

  // ---- 客户可见 7 状态的展示文案（语义对齐 v1 现有 STATUS，措辞打磨） ----
  const STATUS = {
    QUEUED:          { label: '已创建',   title: '订单已创建',           desc: '系统已收到你的订单，正在排队安排开通。', terminal: false, poll: 5000 },
    PREPARING:       { label: '准备中',   title: '正在准备开通',         desc: '系统正在为你准备开通，通常一分钟左右完成。请稍候，无需重复提交，页面会自动刷新进度。', terminal: false, poll: 5000 },
    PAYING:          { label: '正在支付', title: '正在支付',             desc: '系统正在为你完成支付，请稍候。', terminal: false, poll: 4000 },
    ACTIVATING:      { label: '正在开通', title: '正在开通 Plus',        desc: '支付已提交，正在为你开通 ChatGPT Plus，马上完成。', terminal: false, poll: 5000 },
    CONFIRMING:      { label: '确认订阅', title: '正在确认订阅',         desc: '开通已提交，系统正在确认订阅结果，马上就好。', terminal: false, poll: 6000 },
    REVIEWING:       { label: '复核中',   title: '订单正在复核',         desc: '系统需要进一步确认结果，请保留查询码稍后查看。', terminal: false, poll: 30000 },
    ACTION_REQUIRED: { label: '待更换账号', title: '需要更换账号 Session', desc: '当前账号不符合开通条件，请在下方更换一个免费账号的 Session。', terminal: false, poll: 30000 },
    SUCCESS:         { label: '已开通',   title: 'Plus 已成功开通',      desc: '本次订单已全部完成，账号信息如下。', terminal: true,  poll: null },
    FAILED:          { label: '未成功',   title: '订单未能完成',         desc: '本次订单未能完成，请保留查询码联系客服核对。', terminal: true, poll: null }
  };

  // 时间线短标签
  const TL_LABEL = {
    QUEUED: '已创建', PREPARING: '准备中',
    PAYING: '正在支付', ACTIVATING: '正在开通 Plus', CONFIRMING: '正在确认订阅',
    REVIEWING: '复核中', ACTION_REQUIRED: '等待更换账号',
    SUCCESS: '已完成', FAILED: '未成功'
  };
  // 6 步正常进展链；横向进度条用短标签与百分比刻度（准备段占比大——真实等待最久）
  const CANON = ['QUEUED', 'PREPARING', 'PAYING', 'ACTIVATING', 'CONFIRMING', 'SUCCESS'];
  const STEP_SHORT = { QUEUED: '已创建', PREPARING: '准备中', PAYING: '支付', ACTIVATING: '开通', CONFIRMING: '确认', SUCCESS: '完成' };
  const PROGRESS_PCT = { QUEUED: 8, PREPARING: 34, PAYING: 55, ACTIVATING: 75, CONFIRMING: 92, SUCCESS: 100 };

  // 错误码 -> 客户文案（对齐现有 customer.js ERROR_MESSAGES）
  const ERRORS = {
    invalid_order_request: '请检查提交内容。',
    incomplete_session: '账号 Session 不完整，请重新复制完整内容。',
    invalid_access_token: '账号 Session 无效，请重新获取完整内容。',
    invalid_access_token_claims: '账号 Session 无效，请重新获取完整内容。',
    access_token_expired: '账号 Session 已过期，请重新获取后提交。',
    access_token_near_expiry: '账号 Session 即将过期，请重新获取后提交。',
    invalid_session_token: '账号 Session 无效，请重新获取完整内容。',
    invalid_session_expiry: '账号 Session 的有效期信息无效，请重新获取。',
    session_expired: '账号 Session 已过期，请重新获取。',
    cdk_unavailable: 'CDK 卡密不可用或已绑定订单，可到「查订单」找回原订单。',
    ordering_paused: '当前暂停接收新订单，请稍后再试。',
    ordering_not_configured: '当前暂时无法创建订单，请稍后再试。',
    order_route_unavailable: '当前暂时无法创建订单，请稍后再试。',
    invalid_order_query: '请输入有效的查询码或原 CDK 卡密。',
    order_not_found: '没有找到对应订单，请检查输入。',
    session_replacement_not_allowed: '当前订单不需要更换 Session。',
    session_replacement_expired: '更换时间已过，请保留查询码联系人工处理。',
    session_replacement_limit_reached: '更换次数已用完，请保留查询码联系人工处理。',
    funds_state_unsafe: '订单正在复核，暂时不能更换 Session。',
    rate_limited: '操作过于频繁，请稍后再试。',
    body_too_large: '账号 Session 内容过大，请检查是否粘贴了多余内容。',
    invalid_json: '请求内容格式有误，请稍后重试。'
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    stage: $('stage'), stepper: $('stepper'),
    views: { input: $('view-input'), tracking: $('view-tracking'), query: $('view-query') },
    inputForm: $('submit-form'), cdk: $('cdk'), session: $('session'),
    fieldCdk: $('field-cdk'), fieldSession: $('field-session'), toConfirm: $('to-confirm'),
    inlineEmail: $('inline-email'), inlineEmailValue: $('inline-email-value'),
    statusCard: $('status-card'), crest: $('status-crest'),
    chip: $('status-chip'), chipLabel: $('status-chip-label'), updated: $('status-updated'),
    title: $('status-title'), desc: $('status-desc'),
    successSummary: $('success-summary'), successEmail: $('success-email'), successTime: $('success-time'),
    subLink: $('subscription-link'),
    ticketCode: $('ticket-code'), ticketCopy: $('ticket-copy'),
    replaceForm: $('replace-form'), replaceSession: $('replace-session'), replaceCheck: $('replace-check'),
    replaceSubmit: $('replace-submit'), replaceLimit: $('replace-limit'),
    helpbox: $('helpbox'), helpText: $('helpbox-text'),
    progress: $('progress'), progressNum: $('progress-num'), progressCur: $('progress-cur'),
    progressStep: $('progress-step'), progressFill: $('progress-fill'), progressNodes: $('progress-nodes'),
    pollNote: $('poll-note'), trackingNew: $('tracking-new'),
    queryForm: $('query-form'), queryInput: $('query-input'), querySubmit: $('query-submit'), queryBack: $('query-back'),
    navQuery: $('nav-query'), toast: $('toast'),
    guideOpen: $('session-help-open'), replaceHelpOpen: $('replace-help-open'),
    guide: $('session-guide'), guideClose: $('guide-close'), guideDone: $('guide-done')
  };

  let pending = null;       // {cdk, session, email} —— 待确认，未发请求
  let currentOrder = null;
  let pollTimer = null, pollStart = 0, successShownFor = null;

  // ---------------- 工具 ----------------
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function fmtTime(v) {
    if (!v) return '';
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { hour12: false }) : '';
  }
  function rememberPublicNo(publicNo) {
    try { sessionStorage.setItem('pojia:lastPublicNo', publicNo); } catch { /* storage unavailable */ }
  }
  function readRememberedPublicNo() {
    try { return sessionStorage.getItem('pojia:lastPublicNo'); } catch { return null; }
  }
  function maskCdk(cdk) {
    const s = String(cdk || '');
    if (s.length <= 6) return s;
    return s.slice(0, 4) + '••••' + s.slice(-2);
  }
  function errText(err) {
    const code = String(err?.code || err?.message || '').toLowerCase();
    if (code === 'network_error') return '无法连接服务，请检查网络后重试。';
    if (code === 'invalid_response') return '服务返回异常，请稍后重试。';
    return ERRORS[code] || '操作未完成，请稍后重试。';
  }

  // 健壮解析：剥离浏览器扩展可能追加的非 JSON 尾随文本，只取第一个完整 JSON 对象
  function parseSessionInput(raw) {
    const text = String(raw || '').trim();
    try { return { value: JSON.parse(text), hadTrailingText: false }; }
    catch { /* fall through */ }
    const start = text.indexOf('{');
    if (start < 0) throw new Error('invalid_session_json');
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') { if (--depth === 0) { return { value: JSON.parse(text.slice(start, i + 1)), hadTrailingText: Boolean(text.slice(i + 1).trim()) }; } }
    }
    throw new Error('invalid_session_json');
  }

  function setBusy(btn, busy) { if (!btn) return; btn.classList.toggle('is-busy', busy); btn.disabled = busy; }

  let toastTimer = null;
  function toast(msg, kind = 'error') {
    el.toast.textContent = msg; el.toast.dataset.kind = kind; el.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    if (kind !== 'error') toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4200);
  }
  function clearToast() { el.toast.hidden = true; }

  function fieldError(field, msg) {
    field.classList.toggle('is-invalid', Boolean(msg));
    const p = field.querySelector('[data-error]');
    if (p) p.textContent = msg || '';
  }

  // ---------------- 视图切换 ----------------
  function setStepper(step, done) {
    el.stepper.hidden = !step;
    if (!step) return;
    el.stepper.querySelectorAll('.stepper__seg').forEach((s) => {
      const n = Number(s.dataset.step);
      s.classList.toggle('is-current', n === step && !done);
      s.classList.toggle('is-done', n < step || (done && n <= step));
    });
  }

  function showView(name, { step, done } = {}) {
    for (const k in el.views) el.views[k].hidden = k !== name;
    // 重新触发进入动效
    const v = el.views[name];
    v.classList.remove('view'); void v.offsetWidth; v.classList.add('view');
    if (step) setStepper(step, done); else setStepper(0);
    clearToast();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------- 横向进度条：百分比 + 6 节点 + 平滑动画 ----------------
  let lastPct = 0;
  const prefersReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animateProgress(from, to) {
    if (prefersReduced()) { el.progressFill.style.width = to + '%'; el.progressNum.textContent = to; return; }
    const dur = 900, t0 = performance.now();
    (function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 3);       // easeOutCubic：先快后缓、顺滑不跳格
      const v = Math.round(from + (to - from) * eased);
      el.progressFill.style.width = v + '%';
      el.progressNum.textContent = v;
      if (t < 1) requestAnimationFrame(frame);
    })(performance.now());
  }

  function renderProgress(order) {
    const cur = order.status;
    const idx = CANON.indexOf(cur);
    if (idx < 0) { el.progress.hidden = true; return; }   // 复核 / 待换号 / 失败等异常态不进正常进度条
    el.progress.hidden = false;
    const terminal = cur === 'SUCCESS';
    el.progressNodes.innerHTML = CANON.map((s, i) => {
      const state = i < idx ? 'done' : (i === idx ? (terminal ? 'done' : 'current') : 'future');
      return `<div class="hp__node" data-state="${state}"><span class="hp__dot" aria-hidden="true"></span><span class="hp__lbl">${escapeHtml(STEP_SHORT[s])}</span></div>`;
    }).join('');
    el.progressCur.textContent = (STATUS[cur] && STATUS[cur].title) || TL_LABEL[cur] || '';
    el.progressStep.textContent = `第 ${idx + 1} / ${CANON.length} 步`;
    const target = PROGRESS_PCT[cur] || Math.round((idx + 1) / CANON.length * 100);
    animateProgress(lastPct, target);
    lastPct = target;
  }

  // ---------------- 渲染状态卡 ----------------
  function renderStatus(order, { scroll = true } = {}) {
    currentOrder = order;
    const meta = STATUS[order.status] || STATUS.REVIEWING || STATUS.PROCESSING;
    const terminal = meta.terminal;
    const success = order.status === 'SUCCESS';
    const failed = order.status === 'FAILED';

    el.statusCard.dataset.status = order.status;
    el.statusCard.classList.toggle('is-terminal', terminal);

    el.chipLabel.textContent = meta.label;
    el.title.textContent = meta.title;
    el.updated.textContent = order.updatedAt ? '更新于 ' + fmtTime(order.updatedAt) : '';

    // 需更换账号：优先用后端 actionRequired.message
    const replacement = order.sessionReplacement || {};
    const expired = replacement.expiresAt && new Date(replacement.expiresAt).getTime() <= Date.now();
    const canReplace = order.status === 'ACTION_REQUIRED' && Number(replacement.remaining || 0) > 0 && !expired;
    el.desc.textContent = (order.status === 'ACTION_REQUIRED' && !canReplace)
      ? '更换次数或时间窗口已用完，请保留查询码联系人工处理。'
      : (order.actionRequired && order.actionRequired.message) || meta.desc;

    // 查询码
    el.ticketCode.textContent = order.publicNo;
    el.queryInput.value = order.publicNo;
    rememberPublicNo(order.publicNo);

    // 成功
    el.crest.hidden = !success;
    el.successSummary.hidden = !success;
    el.subLink.hidden = !success;
    el.statusCard.classList.toggle('is-success', success && successShownFor !== order.publicNo);
    if (success) {
      el.successEmail.textContent = order.customerEmail || '—';
      el.successTime.textContent = fmtTime(order.finishedAt || order.updatedAt) || '—';
      successShownFor = order.publicNo;
    }

    // 需更换表单
    el.replaceForm.hidden = !canReplace;
    if (canReplace) {
      el.replaceLimit.textContent = `还可更换 ${replacement.remaining} 次` +
        (replacement.expiresAt ? ` · 截止 ${fmtTime(replacement.expiresAt)}` : '');
    }

    // 失败求助
    el.helpbox.hidden = !failed;

    // 横向进度条
    renderProgress(order);

    // 轮询提示
    el.pollNote.textContent = terminal
      ? '订单已进入最终状态，自动刷新已停止。'
      : '页面会自动刷新进度，无需手动操作。';
    el.pollNote.hidden = false;

    setStepper(order.status === 'SUCCESS' ? 3 : 2, order.status === 'SUCCESS');
    if (scroll) el.statusCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    schedulePoll(order.publicNo, meta);
  }

  // ---------------- 轮询 ----------------
  function stopPoll() { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; }
  function schedulePoll(publicNo, meta) {
    stopPoll();
    if (!meta || meta.terminal || !meta.poll) return;
    if (!pollStart) pollStart = Date.now();
    if (Date.now() - pollStart > 30 * 60 * 1000) { el.pollNote.textContent = '自动刷新已暂停，可到「查订单」继续查询。'; return; }
    pollTimer = setTimeout(async () => {
      if (document.hidden) return schedulePoll(publicNo, meta);
      try {
        const { order } = await api.getStatus({ publicNo });
        renderStatus(order, { scroll: false });
      } catch {
        el.pollNote.textContent = '自动刷新暂时失败，将稍后重试。';
        pollTimer = setTimeout(() => schedulePoll(publicNo, meta), 6000);
      }
    }, meta.poll);
  }

  // ---------------- 填写页：本地解析邮箱、就地核对、一步创建订单 ----------------
  // 不变量：邮箱在建单前就地显示供核对；只有点「创建订单」才 createOrder；
  // 绝不回显 Session/Token 全文；建单成功后清空 Session。
  function refreshInputEmail() {
    const cdk = el.cdk.value.trim();
    let email = null;
    try {
      const parsed = parseSessionInput(el.session.value);
      const session = parsed.value;
      if (session && typeof session === 'object' && !Array.isArray(session)
          && session.user && typeof session.user.email === 'string' && session.user.email) {
        email = session.user.email;
        if (parsed.hadTrailingText) el.session.value = JSON.stringify(session);
        pending = { cdk, session, email };
      }
    } catch { /* 尚未粘贴完整，静默等待 */ }
    if (!email) pending = null;
    if (email) { el.inlineEmailValue.textContent = email; el.inlineEmail.hidden = false; }
    else { el.inlineEmail.hidden = true; }
    el.toConfirm.disabled = !(cdk.length >= 8 && email);
    return email;
  }

  el.session.addEventListener('input', refreshInputEmail);
  el.cdk.addEventListener('input', refreshInputEmail);

  el.inputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    fieldError(el.fieldCdk, ''); fieldError(el.fieldSession, ''); clearToast();

    const cdk = el.cdk.value.trim();
    if (cdk.length < 8) return fieldError(el.fieldCdk, '请输入有效的 CDK 卡密（至少 8 位）。');
    if (!refreshInputEmail() || !pending) {
      return fieldError(el.fieldSession, '账号 Session 无效或不完整，请确认粘贴了完整内容。');
    }

    setBusy(el.toConfirm, true);
    try {
      const { order } = await api.createOrder({ cdk: pending.cdk, session: pending.session });
      // 清空敏感输入，切断回显
      el.session.value = ''; el.inlineEmail.hidden = true;
      pending.session = null; pending = null;
      pollStart = Date.now(); successShownFor = null;
      showView('tracking', { step: 2 });
      renderStatus({ publicNo: order.publicNo, status: 'QUEUED', updatedAt: new Date().toISOString(), timeline: [] });
      toast('订单已创建，请保存下方查询码。', 'success');
    } catch (err) {
      if (String(err?.code || err?.message || '').toLowerCase() === 'cdk_unavailable') {
        el.queryInput.value = cdk;
        showView('query'); toast(errText(err)); return;
      }
      toast(errText(err));
    } finally {
      setBusy(el.toConfirm, false);
    }
  });

  // ---------------- 更换 Session ----------------
  el.replaceForm.addEventListener('submit', async (e) => {
    e.preventDefault(); clearToast();
    if (!currentOrder) return;
    if (!el.replaceCheck.checked) return toast('请确认新账号当前是免费账号。');
    let session;
    try { session = parseSessionInput(el.replaceSession.value).value; }
    catch { return toast('新 Session 格式不正确，请检查后重试。'); }
    if (!session || !session.user || !session.user.email) return toast('请粘贴完整的新账号 Session。');
    setBusy(el.replaceSubmit, true);
    try {
      const { order } = await api.replaceSession({ publicNo: currentOrder.publicNo, session });
      el.replaceSession.value = ''; el.replaceCheck.checked = false; session = null;
      pollStart = Date.now();
      renderStatus({ ...order, updatedAt: order.updatedAt || new Date().toISOString(), timeline: order.timeline || [] }, { scroll: true });
      toast('账号已更换，订单继续处理。', 'success');
    } catch (err) { toast(errText(err)); }
    finally { setBusy(el.replaceSubmit, false); }
  });

  // ---------------- 查询 ----------------
  function openQuery() { showView('query'); }
  el.navQuery.addEventListener('click', openQuery);
  el.queryBack.addEventListener('click', () => showView('input', { step: 1 }));
  el.trackingNew.addEventListener('click', () => { stopPoll(); el.cdk.value = ''; el.session.value = ''; showView('input', { step: 1 }); });

  el.queryForm.addEventListener('submit', async (e) => {
    e.preventDefault(); clearToast(); stopPoll();
    const v = el.queryInput.value.trim();
    if (!v) return toast('请输入查询码或原 CDK 卡密。');
    const q = v.startsWith('PJV1-') ? { publicNo: v } : { cdk: v };
    setBusy(el.querySubmit, true);
    try {
      const { order } = await api.getStatus(q);
      pollStart = Date.now(); successShownFor = order.status === 'SUCCESS' ? null : successShownFor;
      showView('tracking', { step: 2 });
      renderStatus(order);
    } catch (err) { toast(errText(err)); }
    finally { setBusy(el.querySubmit, false); }
  });

  // ---------------- 复制查询码 ----------------
  el.ticketCopy.addEventListener('click', async () => {
    const v = el.ticketCode.textContent;
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
      el.ticketCopy.textContent = '已复制'; el.ticketCopy.classList.add('is-done');
      setTimeout(() => { el.ticketCopy.textContent = '复制'; el.ticketCopy.classList.remove('is-done'); }, 1600);
    } catch { toast('复制失败，请手动选中查询码。'); }
  });

  // ---------------- Session 获取教程弹层 ----------------
  function openGuide() { if (el.guide && typeof el.guide.showModal === 'function') el.guide.showModal(); }
  function closeGuide() { el.guide?.close?.(); }
  el.guideOpen?.addEventListener('click', openGuide);
  el.replaceHelpOpen?.addEventListener('click', openGuide);
  el.guideClose?.addEventListener('click', closeGuide);
  el.guideDone?.addEventListener('click', closeGuide);
  el.guide?.addEventListener('click', (e) => { if (e.target === el.guide) closeGuide(); }); // 点背景关闭


  // ---------------- 初始 ----------------
  const rememberedPublicNo = readRememberedPublicNo();
  if (rememberedPublicNo) el.queryInput.value = rememberedPublicNo;
  el.cdk.value = '';
  el.session.value = '';
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    pending = null;
    el.cdk.value = '';
    el.session.value = '';
    fieldError(el.fieldCdk, '');
    fieldError(el.fieldSession, '');
    showView('input', { step: 1 });
  });
  setStepper(1);
  showView('input', { step: 1 });
})();
