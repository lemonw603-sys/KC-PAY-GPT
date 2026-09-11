/* =========================================================================
   customer.js — 候光 · 客户充值页
   设计定稿：docs/design/README.md（2026-09-11 Lemon 确认「就用候光」）

   不变量（改动前先读）：
   1) Session 只在本地解析取邮箱与昵称，解析过程不发任何请求。
   2) 只有客户在确认屏点「立即兑换」，才调 createOrder，且恰好一次。
   3) 页面只回显邮箱和昵称；Session / Token 全文不回显，建单成功后立刻清空。
   4) 进度只用后端给的九阶段与订单状态，不显示任何内部/卡台/资金状态。
   5) 百分比在阶段上限之下逼近，永不冲线；只有真正订阅成功才置 100。
   6) 不承诺具体秒数，只写「通常几分钟之内完成」。
   ========================================================================= */
(function () {
  'use strict';

  // ---------------------------------------------------------------- API
  async function postJson(url, body) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch { throw new Error('network_error'); }
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('invalid_response'); }
    if (!response.ok) throw new Error(payload?.error || 'request_failed');
    return payload;
  }

  const api = Object.freeze({
    verifyCdk: (body) => postJson('/api/v1/cdks/verify', body),
    createOrder: (body) => postJson('/api/v1/orders', body),
    replaceSession: (body) => postJson('/api/v1/orders/session', body),
    getStatus: (body) => postJson('/api/v1/orders/status', body)
  });

  // ------------------------------------------------------------- 九阶段
  // 阶段名与上限由后端 src/domain/customer-stage.js 给出；这里只提供每个阶段
  // 的说明文案。段长与曲线常数必须与后端 STAGE_SEGMENT_MS 保持一致。
  const SEGMENT_MS = 90000;
  const STAGE_HINT = {
    ORDER_RECEIVED: '已收到你的卡密和账号,正在安排开通。',
    CARD_PREPARING: '正在为这笔订单准备专用支付卡。',
    QUEUED_FOR_RUN: '已进入开通队列,马上开始。',
    ACCOUNT_VERIFYING: '正在登录并核对账号,确认可以开通。',
    CHECKOUT_LOADING: '正在打开官方购买页面。',
    PAYMENT_SUBMITTING: '支付信息已填好,正在提交。',
    PAYMENT_AWAITING: '已提交,正在等待官方返回结果。',
    SUBSCRIPTION_CONFIRMING: '支付成功,正在确认订阅已生效。',
    SUBSCRIPTION_ACTIVE: 'Plus 已开通,现在就可以用了。'
  };
  const KEEP_OPEN = '请保持本页打开,通常几分钟之内完成。';

  // 后端映射态 → 本页呈现方式。poll 为 null 表示终态，停止轮询。
  const STATUS_VIEW = {
    QUEUED:          { tone: 'ok',   poll: 5000 },
    PREPARING:       { tone: 'ok',   poll: 5000 },
    PAYING:          { tone: 'ok',   poll: 4000 },
    ACTIVATING:      { tone: 'ok',   poll: 5000 },
    CONFIRMING:      { tone: 'ok',   poll: 6000 },
    REVIEWING:       { tone: 'warn', poll: 30000,
      name: '遇到点问题',
      hint: '遇到点问题,我们已经收到通知在处理。本页会自动更新,你也可以记下查询码稍后回来看。' },
    ACTION_REQUIRED: { tone: 'warn', poll: 30000,
      name: '需要换一个账号',
      hint: '当前账号不能开通,请在下方换一个免费账号的 Session,订单会继续处理。' },
    SUCCESS:         { tone: 'ok',   poll: null, name: '订阅成功' },
    FAILED:          { tone: 'warn', poll: null,
      name: '本次未能完成',
      hint: '这一单没有完成,不会产生扣费。请记下查询码联系客服核对。' }
  };

  const ERRORS = {
    invalid_cdk_request: '请输入卡密。',
    invalid_order_request: '请检查提交内容。',
    incomplete_session: '账号 Session 不完整,请重新复制完整内容。',
    invalid_access_token: '账号 Session 无效,请重新获取完整内容。',
    invalid_access_token_claims: '账号 Session 无效,请重新获取完整内容。',
    access_token_expired: '账号 Session 已过期,请重新获取后提交。',
    access_token_near_expiry: '账号 Session 即将过期,请重新获取后提交。',
    invalid_session_token: '账号 Session 无效,请重新获取完整内容。',
    invalid_session_expiry: '账号 Session 的有效期信息无效,请重新获取。',
    session_expired: '账号 Session 已过期,请重新获取。',
    cdk_unavailable: '这张卡密不可用,或者已经绑定了订单。可以到「订单查询」找回原订单。',
    ordering_paused: '当前暂停接收新订单,请稍后再试。',
    ordering_not_configured: '当前暂时无法创建订单,请稍后再试。',
    order_route_unavailable: '当前暂时无法创建订单,请稍后再试。',
    invalid_order_query: '请输入有效的查询码或卡密。',
    order_not_found: '没有找到对应订单,请检查输入。',
    session_replacement_not_allowed: '当前订单不需要更换账号。',
    session_replacement_expired: '更换时间已过,请保留查询码联系人工处理。',
    session_replacement_limit_reached: '更换次数已用完,请保留查询码联系人工处理。',
    funds_state_unsafe: '订单正在复核,暂时不能更换账号。',
    rate_limited: '操作太频繁了,请稍等一会儿再试。',
    body_too_large: '粘贴的内容过大,请检查是否多复制了东西。',
    invalid_json: '请求内容格式有误,请稍后重试。'
  };

  // ------------------------------------------------------------- 元素
  const $ = (id) => document.getElementById(id);
  const el = {
    glow: $('glow'), rail: $('rail'), toast: $('toast'),
    views: {
      cdk: $('view-cdk'), session: $('view-session'), confirm: $('view-confirm'),
      run: $('view-run'), query: $('view-query')
    },
    formCdk: $('form-cdk'), cdk: $('cdk'), fieldCdk: $('field-cdk'), cdkSubmit: $('cdk-submit'),
    formSession: $('form-session'), session: $('session'), fieldSession: $('field-session'),
    sessionSubmit: $('session-submit'), sessionBack: $('session-back'), sessionSub: $('session-sub'),
    sessionOk: $('session-ok'), sessionEmail: $('session-email'), sessionName: $('session-name'),
    confirmCdk: $('confirm-cdk'), confirmPlan: $('confirm-plan'), confirmEmail: $('confirm-email'),
    confirmName: $('confirm-name'), confirmNameRow: $('confirm-name-row'),
    confirmSubmit: $('confirm-submit'), confirmBack: $('confirm-back'),
    run: $('view-run'), ringFg: $('ring-fg'), ringNum: $('ring-num'), ringPct: $('ring-pct'),
    ringTick: $('ring-tick'), stageName: $('stage-name'), stageHint: $('stage-hint'),
    stageStep: $('stage-step'), runSeal: $('run-seal'), runRows: $('run-rows'),
    runSublink: $('run-sublink'), runRisk: $('run-risk'),
    ticketCode: $('ticket-code'), ticketCopy: $('ticket-copy'),
    formReplace: $('form-replace'), replaceSession: $('replace-session'), fieldReplace: $('field-replace'),
    replaceCheck: $('replace-check'), replaceSubmit: $('replace-submit'), replaceLimit: $('replace-limit'),
    pollNote: $('poll-note'), runNew: $('run-new'),
    formQuery: $('form-query'), queryInput: $('query-input'), fieldQuery: $('field-query'),
    querySubmit: $('query-submit'), queryBack: $('query-back'),
    navQuery: $('nav-query'), navGuide: $('nav-guide'),
    guide: $('guide'), guideClose: $('guide-close'), guideDone: $('guide-done'),
    sessionGuideOpen: $('session-guide-open'), replaceGuideOpen: $('replace-guide-open')
  };

  const RING_C = 2 * Math.PI * 88;
  const RAIL_AT = { cdk: 0, session: 1, confirm: 2, run: 3, query: -1 };

  // ------------------------------------------------------------- 状态
  let verified = null;      // 校验通过的卡密：{ cdk, product, state }
  let pending = null;       // 待确认：{ cdk, session, email, name } —— 尚未发请求
  let currentOrder = null;
  let pollTimer = null, pollStart = 0;
  let ringRaf = null, stageSeenAt = new Map(), shownStageCode = null;

  // ------------------------------------------------------------- 工具
  const reduceMotion = () => window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fmtTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '';
  }
  function maskCdk(code) {
    const s = String(code || '');
    return s.length <= 10 ? s : `${s.slice(0, 6)}…${s.slice(-4)}`;
  }
  function errText(error) {
    const code = String(error?.code || error?.message || '').toLowerCase();
    if (code === 'network_error') return '连不上服务,请检查网络后重试。';
    if (code === 'invalid_response') return '服务返回异常,请稍后重试。';
    return ERRORS[code] || '操作没有完成,请稍后重试。';
  }
  function rememberPublicNo(publicNo) {
    try { sessionStorage.setItem('pojia:lastPublicNo', publicNo); } catch { /* 隐私模式等 */ }
  }
  function readRememberedPublicNo() {
    try { return sessionStorage.getItem('pojia:lastPublicNo'); } catch { return null; }
  }
  function productShortName(order) {
    const label = String(order?.product?.label || verified?.product?.label || '');
    return label.replace(/^ChatGPT\s+/i, '').trim() || 'Plus';
  }
  function withProduct(text, order) {
    const short = productShortName(order);
    return short === 'Plus' ? text : String(text).replace(/Plus/g, short);
  }
  function setBusy(button, busy) {
    if (!button) return;
    button.classList.toggle('is-busy', busy);
    button.disabled = busy;
  }
  function fieldError(field, message) {
    if (!field) return;
    field.classList.toggle('is-invalid', Boolean(message));
    const slot = field.querySelector('[data-error]');
    if (slot) slot.textContent = message || '';
  }

  let toastTimer = null;
  function toast(message, kind = 'error') {
    el.toast.textContent = message;
    el.toast.dataset.kind = kind;
    el.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, kind === 'error' ? 6000 : 4200);
  }
  function clearToast() { el.toast.hidden = true; }

  // 健壮解析：剥掉浏览器扩展可能追加的非 JSON 尾随文本，只取第一个完整对象
  function parseSessionInput(raw) {
    const text = String(raw || '').trim();
    try { return { value: JSON.parse(text), hadTrailingText: false }; } catch { /* 继续 */ }
    const start = text.indexOf('{');
    if (start < 0) throw new Error('invalid_session_json');
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          return {
            value: JSON.parse(text.slice(start, i + 1)),
            hadTrailingText: Boolean(text.slice(i + 1).trim())
          };
        }
      }
    }
    throw new Error('invalid_session_json');
  }

  // ------------------------------------------------------------- 视图
  function setRail(index, { allDone = false } = {}) {
    el.rail.hidden = index < 0;
    if (index < 0) return;
    el.rail.querySelectorAll('.rail__st').forEach((step, i) => {
      step.classList.toggle('is-done', allDone || i < index);
      step.classList.toggle('is-current', !allDone && i === index);
    });
    el.rail.querySelectorAll('.rail__ln').forEach((line, i) => {
      line.classList.toggle('is-on', allDone || i < index);
    });
  }

  let shownView = null;
  function showView(name, { allDone = false } = {}) {
    const changed = shownView !== name;
    shownView = name;
    for (const key of Object.keys(el.views)) el.views[key].hidden = key !== name;
    const view = el.views[name];
    if (changed) {
      view.classList.remove('screen');
      void view.offsetWidth;            // 重新触发进入动效
      view.classList.add('screen');
    }
    setRail(RAIL_AT[name], { allDone });
    el.glow.dataset.on = name === 'run' ? '1' : '0';
    if (changed) {
      clearToast();
      window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
  }

  // ------------------------------------------------ 进度环（逐帧、连续）
  // 与后端 stagePercent 同一条曲线：floor+(ceiling-floor)*(1-e^-2.6t)，
  // 并同样钳在上限下方一个百分点——按段做 CSS 过渡再停住不是匀速的。
  function stopRing() {
    if (ringRaf) cancelAnimationFrame(ringRaf);
    ringRaf = null;
  }
  function paintRing(percent) {
    const clamped = Math.max(0, Math.min(100, percent));
    el.ringPct.textContent = String(Math.round(clamped));
    el.ringFg.style.strokeDashoffset = String(RING_C * (1 - clamped / 100));
  }
  function curve(stage, elapsedMs) {
    const floor = Number(stage.floor) || 0;
    const ceiling = Number(stage.ceiling) || 0;
    const t = Math.max(0, elapsedMs) / SEGMENT_MS;
    return Math.min(floor + (ceiling - floor) * (1 - Math.exp(-2.6 * t)), ceiling - 1);
  }
  function runRing(stage, startedAt, { frozen = false } = {}) {
    stopRing();
    if (!stage) return;
    if (stage.index >= stage.total) { paintRing(100); return; }
    if (frozen || reduceMotion()) { paintRing(curve(stage, Date.now() - startedAt)); return; }
    (function frame() {
      paintRing(curve(stage, Date.now() - startedAt));
      ringRaf = requestAnimationFrame(frame);
    })();
  }

  function swapStageText(name, hint) {
    if (el.stageName.textContent === name) {
      el.stageHint.textContent = hint;
      return;
    }
    if (reduceMotion()) {
      el.stageName.textContent = name;
      el.stageHint.textContent = hint;
      return;
    }
    el.stageName.classList.add('is-swapping');
    el.stageHint.style.opacity = '.35';
    setTimeout(() => {
      el.stageName.textContent = name;
      el.stageName.classList.remove('is-swapping');
      el.stageHint.textContent = hint;
      el.stageHint.style.opacity = '1';
    }, 170);
  }

  // ------------------------------------------------------------- 订单渲染
  function renderRows(order) {
    const rows = [];
    rows.push(['订单', order.publicNo]);
    if (order.customerEmail) rows.push(['账号', order.customerEmail]);
    const label = order.product?.label || verified?.product?.label;
    if (label) rows.push(['方案', label, true]);
    if (order.status === 'SUCCESS' && order.finishedAt) {
      rows.push(['开通时间', fmtTime(order.finishedAt), true]);
    }
    el.runRows.innerHTML = rows.map(([name, value, isText]) => {
      const div = document.createElement('div');
      div.className = 'rows__r';
      const key = document.createElement('span');
      key.textContent = name;
      const val = document.createElement('b');
      if (isText) val.className = 'is-text';
      val.textContent = value;
      div.append(key, val);
      return div.outerHTML;
    }).join('');
  }

  function renderOrder(order, { scroll = false } = {}) {
    currentOrder = order;
    const view = STATUS_VIEW[order.status] || STATUS_VIEW.REVIEWING;
    const success = order.status === 'SUCCESS';
    const stage = order.stage || null;

    el.run.dataset.tone = view.tone;
    el.glow.dataset.tone = view.tone;

    // 阶段文案：正常链路用九阶段，异常分支用本页自己的说法。
    let name = view.name;
    let hint = view.hint;
    if (!name && stage) name = stage.label;
    if (!hint) {
      const base = stage ? STAGE_HINT[stage.code] : '';
      hint = success ? withProduct(STAGE_HINT.SUBSCRIPTION_ACTIVE, order)
        : `${base || ''}${base ? KEEP_OPEN : ''}`.trim() || KEEP_OPEN;
    }
    swapStageText(withProduct(name || '处理中', order), withProduct(hint, order));

    // 「第几步 / 共九步」：卡住时这行比百分比更能说明还在哪一环。
    if (stage && !success) {
      el.stageStep.hidden = false;
      el.stageStep.textContent = `第 ${stage.index} 步 / 共 ${stage.total} 步`;
    } else {
      el.stageStep.hidden = true;
    }

    // 进度环
    el.ringNum.hidden = success;
    el.ringTick.classList.toggle('is-on', success);
    if (success) {
      stopRing();
      paintRing(100);
    } else if (stage) {
      // 后端给了阶段起点就用它；没有（阶段由订单状态推出）就用本地首见时间。
      const since = stage.since ? new Date(stage.since).getTime() : null;
      if (!stageSeenAt.has(stage.code)) stageSeenAt.set(stage.code, Date.now());
      const startedAt = Number.isFinite(since) && since ? since : stageSeenAt.get(stage.code);
      runRing(stage, startedAt, { frozen: view.poll === null || view.tone === 'warn' });
    } else {
      stopRing();
      paintRing(0);
    }
    shownStageCode = stage ? stage.code : null;

    el.runSeal.hidden = !success;
    el.runSublink.hidden = !success;
    el.runRisk.hidden = !success;

    el.ticketCode.textContent = order.publicNo;
    el.queryInput.value = order.publicNo;
    rememberPublicNo(order.publicNo);
    renderRows(order);

    // 换号表单：remaining 为 null 表示不限次数（D-120），不能当成 0。
    const replacement = order.sessionReplacement || {};
    const expired = replacement.expiresAt && new Date(replacement.expiresAt).getTime() <= Date.now();
    const canReplace = order.status === 'ACTION_REQUIRED' && !expired
      && (replacement.remaining == null || Number(replacement.remaining) > 0);
    el.formReplace.hidden = !canReplace;
    if (canReplace) {
      const reason = order.actionRequired?.message;
      if (reason) el.stageHint.textContent = reason;
      el.replaceLimit.textContent = replacement.remaining == null
        ? '可以随时换,不限次数,订单会继续等待。'
        : `还可以换 ${replacement.remaining} 次`
          + (replacement.expiresAt ? ` · 截止 ${fmtTime(replacement.expiresAt)}` : '');
    } else if (order.status === 'ACTION_REQUIRED') {
      el.stageHint.textContent = '更换次数或时间已经用完,请保留查询码联系客服处理。';
    }

    el.pollNote.textContent = view.poll === null
      ? '这一单已经结束,页面不再自动刷新。'
      : '页面会自动刷新进度,不用手动操作。';

    showView('run', { allDone: success });
    if (scroll) window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    schedulePoll(order.publicNo, view);
  }

  // ------------------------------------------------------------- 轮询
  function stopPoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }
  function schedulePoll(publicNo, view) {
    stopPoll();
    if (!view || view.poll === null) return;
    if (!pollStart) pollStart = Date.now();
    if (Date.now() - pollStart > 30 * 60 * 1000) {
      el.pollNote.textContent = '自动刷新已暂停,可以到「订单查询」继续查。';
      return;
    }
    // 页面在后台时降频而不是停掉：客户提交完常常切走等着，而有些环境
    // （嵌入式浏览器、iframe）里 visibilitychange 不会如期触发，真停掉
    // 就会让进度永远停在第一步。
    const delay = document.hidden ? Math.max(view.poll, 30000) : view.poll;
    pollTimer = setTimeout(async () => {
      try {
        const { order } = await api.getStatus({ publicNo });
        renderOrder(order);
      } catch {
        el.pollNote.textContent = '自动刷新暂时失败,稍后会再试。';
        pollTimer = setTimeout(() => schedulePoll(publicNo, view), 6000);
      }
    }, delay);
  }

  // ------------------------------------------------------- 屏 1 验证卡密
  el.formCdk.addEventListener('submit', async (event) => {
    event.preventDefault();
    fieldError(el.fieldCdk, '');
    clearToast();
    const cdk = el.cdk.value.trim();
    if (cdk.length < 8) return fieldError(el.fieldCdk, '请输入完整的卡密。');

    setBusy(el.cdkSubmit, true);
    try {
      const { cdk: result } = await api.verifyCdk({ cdk });
      if (result.state === 'INVALID') {
        return fieldError(el.fieldCdk, '这张卡密无效或已作废,请核对后重新输入。');
      }
      if (result.state === 'BOUND_TO_ORDER') {
        el.queryInput.value = result.order?.publicNo || cdk;
        showView('query');
        toast('这张卡密已经有订单了,下面可以直接查进度。', 'success');
        return;
      }
      verified = { cdk, product: result.product || null, state: result.state };
      el.sessionSub.textContent = result.state === 'NEEDS_SESSION'
        ? '之前那个账号不能开通,换一个免费账号:打开 Token 页面,把整页内容复制过来。'
        : '打开 Token 页面,把整页内容复制过来,我们据此确认是哪个账号。';
      showView('session');
      el.session.focus();
    } catch (error) {
      fieldError(el.fieldCdk, errText(error));
    } finally {
      setBusy(el.cdkSubmit, false);
    }
  });

  // ------------------------------------------------- 屏 2 粘贴 Session
  function refreshSessionPreview() {
    let email = null;
    let name = '';
    try {
      const parsed = parseSessionInput(el.session.value);
      const session = parsed.value;
      if (session && typeof session === 'object' && !Array.isArray(session)
          && session.user && typeof session.user.email === 'string' && session.user.email) {
        email = session.user.email;
        name = typeof session.user.name === 'string' ? session.user.name : '';
        if (parsed.hadTrailingText) el.session.value = JSON.stringify(session);
        pending = { cdk: verified?.cdk || '', session, email, name };
      }
    } catch { /* 还没粘完，安静等着 */ }
    if (!email) pending = null;
    el.sessionOk.hidden = !email;
    if (email) {
      el.sessionEmail.textContent = email;
      el.sessionName.textContent = name ? `${name} · 确认是要开通的这个账号` : '确认是要开通的这个账号';
    }
    el.sessionSubmit.disabled = !email;
    return email;
  }
  el.session.addEventListener('input', refreshSessionPreview);

  el.formSession.addEventListener('submit', (event) => {
    event.preventDefault();
    fieldError(el.fieldSession, '');
    if (!refreshSessionPreview() || !pending) {
      return fieldError(el.fieldSession, '账号 Session 不完整,请确认复制了整页内容。');
    }
    el.confirmCdk.textContent = maskCdk(pending.cdk);
    el.confirmPlan.textContent = verified?.product?.label || 'ChatGPT Plus';
    el.confirmEmail.textContent = pending.email;
    el.confirmName.textContent = pending.name || '';
    el.confirmNameRow.hidden = !pending.name;
    showView('confirm');
  });
  el.sessionBack.addEventListener('click', () => showView('cdk'));

  // ---------------------------------------------------- 屏 3 确认兑换
  el.confirmBack.addEventListener('click', () => showView('session'));
  el.confirmSubmit.addEventListener('click', async () => {
    if (!pending) return showView('session');
    clearToast();
    setBusy(el.confirmSubmit, true);
    try {
      const { order } = await api.createOrder({ cdk: pending.cdk, session: pending.session });
      // 建单成功，立刻切断 Session 的一切回显路径
      el.session.value = '';
      el.sessionOk.hidden = true;
      pending.session = null;
      pending = null;
      pollStart = Date.now();
      stageSeenAt = new Map();
      renderOrder({
        publicNo: order.publicNo,
        status: 'QUEUED',
        updatedAt: new Date().toISOString(),
        product: verified?.product || null,
        stage: { index: 1, code: 'ORDER_RECEIVED', label: '已收到订单', total: 9, floor: 0, ceiling: 10, since: null }
      });
      toast('订单已创建,请记下下面的查询码。', 'success');
    } catch (error) {
      const code = String(error?.code || error?.message || '').toLowerCase();
      if (code === 'cdk_unavailable') {
        el.queryInput.value = verified?.cdk || '';
        showView('query');
        toast(errText(error));
        return;
      }
      showView('session');
      fieldError(el.fieldSession, errText(error));
    } finally {
      setBusy(el.confirmSubmit, false);
    }
  });

  // ---------------------------------------------------- 屏 4 换号 / 复制
  el.formReplace.addEventListener('submit', async (event) => {
    event.preventDefault();
    fieldError(el.fieldReplace, '');
    clearToast();
    if (!currentOrder) return;
    if (!el.replaceCheck.checked) return fieldError(el.fieldReplace, '请先确认这个账号当前是免费账号。');
    let session;
    try { session = parseSessionInput(el.replaceSession.value).value; }
    catch { return fieldError(el.fieldReplace, '内容格式不对,请重新复制整页 Token 页面内容。'); }
    if (!session?.user?.email) return fieldError(el.fieldReplace, '请粘贴完整的账号 Session。');

    setBusy(el.replaceSubmit, true);
    try {
      const { order } = await api.replaceSession({ publicNo: currentOrder.publicNo, session });
      el.replaceSession.value = '';
      el.replaceCheck.checked = false;
      session = null;
      pollStart = Date.now();
      stageSeenAt = new Map();
      renderOrder({ ...order, updatedAt: order.updatedAt || new Date().toISOString() }, { scroll: true });
      toast('账号已更换,订单继续处理。', 'success');
    } catch (error) {
      fieldError(el.fieldReplace, errText(error));
    } finally {
      setBusy(el.replaceSubmit, false);
    }
  });

  el.ticketCopy.addEventListener('click', async () => {
    const value = el.ticketCode.textContent;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      el.ticketCopy.textContent = '已复制';
      el.ticketCopy.classList.add('is-done');
      setTimeout(() => {
        el.ticketCopy.textContent = '复制';
        el.ticketCopy.classList.remove('is-done');
      }, 1600);
    } catch { toast('复制失败,请手动选中查询码。'); }
  });

  el.runNew.addEventListener('click', () => {
    stopPoll();
    stopRing();
    verified = null;
    pending = null;
    currentOrder = null;
    stageSeenAt = new Map();
    el.cdk.value = '';
    el.session.value = '';
    el.sessionOk.hidden = true;
    el.sessionSubmit.disabled = true;
    fieldError(el.fieldCdk, '');
    fieldError(el.fieldSession, '');
    showView('cdk');
  });

  // ---------------------------------------------------- 屏 5 订单查询
  el.formQuery.addEventListener('submit', async (event) => {
    event.preventDefault();
    fieldError(el.fieldQuery, '');
    clearToast();
    stopPoll();
    const value = el.queryInput.value.trim();
    if (!value) return fieldError(el.fieldQuery, '请输入查询码或卡密。');
    setBusy(el.querySubmit, true);
    try {
      const { order } = await api.getStatus(value.startsWith('PJV1-') ? { publicNo: value } : { cdk: value });
      pollStart = Date.now();
      stageSeenAt = new Map();
      renderOrder(order, { scroll: true });
    } catch (error) {
      fieldError(el.fieldQuery, errText(error));
    } finally {
      setBusy(el.querySubmit, false);
    }
  });
  el.queryBack.addEventListener('click', () => showView('cdk'));
  el.navQuery.addEventListener('click', () => { stopPoll(); showView('query'); });

  // ------------------------------------------------------------- 教程
  function openGuide() { el.guide?.showModal?.(); }
  function closeGuide() { el.guide?.close?.(); }
  el.navGuide.addEventListener('click', openGuide);
  el.sessionGuideOpen.addEventListener('click', openGuide);
  el.replaceGuideOpen.addEventListener('click', openGuide);
  el.guideClose.addEventListener('click', closeGuide);
  el.guideDone.addEventListener('click', closeGuide);
  el.guide.addEventListener('click', (event) => { if (event.target === el.guide) closeGuide(); });

  // 标签页切回来时立刻刷新一次，不用等下一个轮询周期
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !currentOrder) return;
    const view = STATUS_VIEW[currentOrder.status];
    if (view && view.poll !== null) schedulePoll(currentOrder.publicNo, { ...view, poll: 300 });
  });

  // ------------------------------------------------------------- 初始
  const remembered = readRememberedPublicNo();
  if (remembered) el.queryInput.value = remembered;
  el.cdk.value = '';
  el.session.value = '';
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    verified = null;
    pending = null;
    el.cdk.value = '';
    el.session.value = '';
    el.sessionOk.hidden = true;
    el.sessionSubmit.disabled = true;
    fieldError(el.fieldCdk, '');
    fieldError(el.fieldSession, '');
    showView('cdk');
  });
  showView('cdk');
})();
