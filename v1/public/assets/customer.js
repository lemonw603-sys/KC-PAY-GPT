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
  // 设计稿的「遇到问题」屏标题仍是当前阶段名（例如「正在提交支付」），
  // 换掉的只是下面那行说明——客户要知道卡在哪一步，不是只知道"出问题了"。
  // ticket 为 true 表示这一屏要给查询码：正常等待几分钟不需要，需要等或
  // 需要客户动手时才给。
  const STATUS_VIEW = {
    QUEUED:          { tone: 'ok',   poll: 5000 },
    PREPARING:       { tone: 'ok',   poll: 5000 },
    PAYING:          { tone: 'ok',   poll: 4000 },
    ACTIVATING:      { tone: 'ok',   poll: 5000 },
    CONFIRMING:      { tone: 'ok',   poll: 6000 },
    REVIEWING:       { tone: 'warn', poll: 30000, ticket: true,
      hint: '遇到点问题,我们已经收到通知在处理。本页会自动更新,你也可以记下查询码稍后回来看。' },
    ACTION_REQUIRED: { tone: 'warn', poll: 30000, ticket: true,
      hint: '当前账号不能开通,请在下方换一个免费账号的 Session,订单会继续处理。' },
    SUCCESS:         { tone: 'ok',   poll: null, ticket: true },
    // FAILED 的说明不写死在这里：能不能重新兑换要看后端的 canRetry，见 renderOrder。
    FAILED:          { tone: 'warn', poll: null, ticket: true }
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
    retryOrder: $('retry-order'),
    formCdk: $('form-cdk'), cdk: $('cdk'), fieldCdk: $('field-cdk'), cdkSubmit: $('cdk-submit'),
    formSession: $('form-session'), session: $('session'), fieldSession: $('field-session'),
    sessionSubmit: $('session-submit'), sessionBack: $('session-back'), sessionSub: $('session-sub'),
    sessionOk: $('session-ok'), sessionEmail: $('session-email'), sessionName: $('session-name'),
    confirmCdk: $('confirm-cdk'), confirmPlan: $('confirm-plan'), confirmEmail: $('confirm-email'),
    confirmName: $('confirm-name'), confirmNameRow: $('confirm-name-row'),
    confirmSubmit: $('confirm-submit'), confirmBack: $('confirm-back'),
    run: $('view-run'), ringFg: $('ring-fg'), ringNum: $('ring-num'), ringPct: $('ring-pct'),
    ringTick: $('ring-tick'), stageName: $('stage-name'), stageHint: $('stage-hint'),
    runSeal: $('run-seal'), runRows: $('run-rows'),
    runSublink: $('run-sublink'), runRisk: $('run-risk'),
    ticketCopy: $('ticket-copy'),
    formReplace: $('form-replace'), replaceSession: $('replace-session'), fieldReplace: $('field-replace'),
    replaceCheck: $('replace-check'), replaceSubmit: $('replace-submit'), replaceLimit: $('replace-limit'),
    formQuery: $('form-query'), queryInput: $('query-input'), fieldQuery: $('field-query'),
    queryResult: $('query-result'), queryResultTitle: $('query-result-title'),
    queryResultSub: $('query-result-sub'), queryRisk: $('query-risk'),
    querySubmit: $('query-submit'), queryBack: $('query-back'),
    navQuery: $('nav-query'), navGuide: $('nav-guide'), navTheme: $('nav-theme'),
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
  // 每一屏的明细逐字照设计稿：等待中是「订单/账号/方案」，成功是
  // 「订阅方案/账号/开通时间/查询码」，出问题是「订单/账号/查询码」。
  function renderRows(order, { ticket = false } = {}) {
    const rows = [];
    const label = order.product?.label || verified?.product?.label;
    const success = order.status === 'SUCCESS';
    if (success) {
      if (label) rows.push(['订阅方案', label, true]);
      if (order.customerEmail) rows.push(['账号', order.customerEmail]);
      rows.push(['开通时间', fmtTime(order.finishedAt || order.updatedAt) || '—', true]);
    } else {
      rows.push(['订单', order.publicNo]);
      if (order.customerEmail) rows.push(['账号', order.customerEmail]);
      if (!ticket && label) rows.push(['方案', label, true]);
    }
    if (ticket) rows.push(['查询码', order.publicNo]);
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
    // 成功屏把环缩小、风控提醒提到明细上方：13 寸笔记本的可视高度约 750px，
    // 原来那条提醒落在 856px，客户根本看不到，而它是硬规则要求必须看到的。
    el.run.classList.toggle('is-done', success);

    // 标题永远是当前阶段名——出问题时也是，客户要知道卡在哪一步。
    // 换掉的只有下面那行说明。
    const name = stage ? stage.label : '处理中';
    let hint = view.hint;
    // 失败单分两种：钱没动的，卡密已经退回（或提交时会当场退回），客户自己就能
    // 再来一次；点过付款、结果不明的，卡密留在原单上等人工核对，只能找客服。
    const canRetry = order.status === 'FAILED' && order.canRetry === true;
    if (order.status === 'FAILED') {
      hint = canRetry
        ? '这一单没有完成,没有扣费。你的卡密可以直接重新兑换。'
        : '这一单没有完成。请记下查询码联系客服核对。';
    }
    if (!hint) {
      const base = stage ? STAGE_HINT[stage.code] : '';
      hint = success ? withProduct(STAGE_HINT.SUBSCRIPTION_ACTIVE, order)
        : `${base || ''}${base ? KEEP_OPEN : ''}`.trim() || KEEP_OPEN;
    }
    swapStageText(withProduct(name, order), withProduct(hint, order));

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
    el.ticketCopy.hidden = !view.ticket;

    el.queryInput.value = order.publicNo;
    rememberPublicNo(order.publicNo);
    renderRows(order, { ticket: Boolean(view.ticket) });

    // 换号表单：remaining 为 null 表示不限次数（D-120），不能当成 0。
    const replacement = order.sessionReplacement || {};
    const expired = replacement.expiresAt && new Date(replacement.expiresAt).getTime() <= Date.now();
    const canReplace = order.status === 'ACTION_REQUIRED' && !expired
      && (replacement.remaining == null || Number(replacement.remaining) > 0);
    el.formReplace.hidden = !canReplace;
    el.retryOrder.hidden = !canRetry;
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
      toast('自动刷新已暂停,可以用查询码到「订单查询」继续看。');
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
        // 静默重试：一次刷新没成功不值得打扰客户，下一轮通常就好了。
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
        // 这张码已经有订单了。客户刚点过一次按钮，别让他到了新页面再点一次
        // 「查询」——直接把结果查出来摆在他面前。
        const lookup = result.order?.publicNo || cdk;
        el.queryInput.value = lookup;
        clearQueryResult();
        showView('query');
        await runQuery(lookup, { button: el.cdkSubmit });
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
  // 本地预检，与后端 src/domain/session-validation.js 同一套规则。纯本地、
  // 不发任何请求。以前这里只看 user.email，缺字段或 token 过期的内容会一路
  // 绿灯放到确认屏，客户点了「立即兑换」才被服务端拒绝——问题该在粘贴的
  // 那一刻就说出来。
  // 必需字段：user.id / user.email / account.id / accessToken / sessionToken / expires
  const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

  function jwtPayload(token) {
    const parts = String(token).split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) return null;
    try {
      const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(decodeURIComponent(escape(json)));
      return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    } catch { return null; }
  }

  const INCOMPLETE = '内容不完整。请在 Token 页面整页全选再复制一次,不要只复制一部分。';

  function checkSession(session) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) return { error: INCOMPLETE };
    if (!session.user || !nonEmpty(session.user.id) || !nonEmpty(session.user.email)) return { error: INCOMPLETE };
    if (!session.account || !nonEmpty(session.account.id)) return { error: INCOMPLETE };
    if (!nonEmpty(session.accessToken) || !nonEmpty(session.sessionToken) || !nonEmpty(session.expires)) {
      return { error: INCOMPLETE };
    }
    const sessionParts = String(session.sessionToken).split('.');
    if (sessionParts.length !== 5 || [0, 2, 3, 4].some((i) => !sessionParts[i])) return { error: INCOMPLETE };
    const expiresAt = Date.parse(session.expires);
    if (!Number.isFinite(expiresAt)) return { error: INCOMPLETE };
    if (expiresAt <= Date.now()) {
      return { error: '这份 Session 已经过期了,请重新打开 Token 页面复制一次。' };
    }
    const payload = jwtPayload(session.accessToken);
    if (!payload || !Number.isInteger(payload.exp)) return { error: INCOMPLETE };
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp <= nowSeconds) {
      return { error: '这份 Session 已经过期了,请重新打开 Token 页面复制一次。' };
    }
    // 与后端 minimumAccessTokenLifetimeSeconds 同一门槛：剩余不足半小时就
    // 别开始了，跑到一半过期更难处理。
    if (payload.exp - nowSeconds < 1800) {
      return { error: '这份 Session 马上就要过期了,请重新复制一次再提交。' };
    }
    return {
      email: session.user.email,
      name: typeof session.user.name === 'string' ? session.user.name : ''
    };
  }

  function refreshSessionPreview({ quiet = true } = {}) {
    let parsed = null;
    try { parsed = parseSessionInput(el.session.value); }
    catch {
      pending = null;
      el.sessionOk.hidden = true;
      el.sessionSubmit.disabled = true;
      // 还没粘完整时不报错，等客户粘完
      if (!quiet) fieldError(el.fieldSession, INCOMPLETE);
      return null;
    }
    if (parsed.hadTrailingText) el.session.value = JSON.stringify(parsed.value);
    const result = checkSession(parsed.value);
    if (result.error) {
      pending = null;
      el.sessionOk.hidden = true;
      el.sessionSubmit.disabled = true;
      // 过期这类问题即使还在输入也要立刻说——再粘几次也不会变好。
      if (!quiet || result.error !== INCOMPLETE) fieldError(el.fieldSession, result.error);
      return null;
    }
    fieldError(el.fieldSession, '');
    pending = { cdk: verified?.cdk || '', session: parsed.value, email: result.email, name: result.name };
    el.sessionEmail.textContent = result.email;
    el.sessionName.textContent = result.name
      ? `${result.name} · 账号信息完整,可以继续`
      : '账号信息完整,可以继续';
    el.sessionOk.hidden = false;
    el.sessionSubmit.disabled = false;
    return result.email;
  }
  // 客户的真实动作是在 Token 页面 Ctrl+A、Ctrl+C，回到这里 Ctrl+V —— 一次
  // 性粘贴，粘完就是完整内容，没有"还在输入"这回事。所以粘贴后立刻给结论，
  // 成功和失败都不等。只有真的在手工编辑时才留一点缓冲，免得边改边报错。
  let sessionHintTimer = null;
  el.session.addEventListener('input', (event) => {
    const pasted = !event.inputType || event.inputType.startsWith('insertFromPaste');
    if (sessionHintTimer) clearTimeout(sessionHintTimer);
    refreshSessionPreview({ quiet: !pasted });
    if (pasted) return;
    sessionHintTimer = setTimeout(() => {
      if (el.session.value.trim()) refreshSessionPreview({ quiet: false });
    }, 700);
  });

  el.formSession.addEventListener('submit', (event) => {
    event.preventDefault();
    fieldError(el.fieldSession, '');
    if (!refreshSessionPreview({ quiet: false }) || !pending) return;
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
      // 邮箱要留下来显示在进度屏（设计稿明细是「订单/账号/方案」三行），
      // Session 全文则在这里彻底切断回显路径。
      const submittedEmail = pending.email;
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
        customerEmail: submittedEmail,
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
  // 重新兑换：失败单里钱没动的那种，客户点一下就回到第一步。卡密不回填——
  // 客户可能是拿查询码查到这一屏的，我们手上不一定有那串码，留个空框比填错强。
  el.retryOrder.addEventListener('click', () => {
    stopPoll();
    stopRing();
    currentOrder = null;
    verified = null;
    pending = null;
    el.cdk.value = '';
    el.session.value = '';
    el.sessionOk.hidden = true;
    el.sessionSubmit.disabled = true;
    fieldError(el.fieldCdk, '');
    fieldError(el.fieldSession, '');
    el.retryOrder.hidden = true;
    showView('cdk');
    el.cdk.focus();
  });

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
    const value = currentOrder?.publicNo;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      el.ticketCopy.textContent = '已复制';
      setTimeout(() => { el.ticketCopy.textContent = '复制查询码'; }, 1600);
    } catch { toast('复制失败,请手动选中查询码。'); }
  });

  // ---------------------------------------------------- 屏 5 订单查询
  function clearQueryResult() {
    el.queryResult.hidden = true;
    el.queryRisk.hidden = true;
  }

  async function runQuery(value, { button = el.querySubmit } = {}) {
    setBusy(button, true);
    try {
      const { order } = await api.getStatus(value.startsWith('PJV1-') ? { publicNo: value } : { cdk: value });
      currentOrder = order;
      rememberPublicNo(order.publicNo);
      // 设计稿的查询屏就地给答案，不把客户推进完整的进度页。只有订单还在
      // 跑的时候才跳过去——那时他要看的是实时进度，一个静态结论没用。
      if (order.status === 'SUCCESS') {
        const label = order.product?.label || 'ChatGPT Plus';
        el.queryResultTitle.textContent = `${label} 已开通`;
        el.queryResultSub.textContent = fmtTime(order.finishedAt || order.updatedAt)
          ? `开通时间 ${fmtTime(order.finishedAt || order.updatedAt)}` : '';
        el.queryResult.hidden = false;
        el.queryRisk.hidden = false;
      } else if (order.status === 'FAILED' && order.canRetry !== true) {
        el.queryResultTitle.textContent = '这一单没有完成';
        el.queryResultSub.textContent = '请记下查询码联系客服核对。';
        el.queryResult.hidden = false;
      } else {
        pollStart = Date.now();
        stageSeenAt = new Map();
        renderOrder(order, { scroll: true });
      }
    } catch (error) {
      fieldError(el.fieldQuery, errText(error));
    } finally {
      setBusy(button, false);
    }
  }

  el.formQuery.addEventListener('submit', (event) => {
    event.preventDefault();
    fieldError(el.fieldQuery, '');
    clearQueryResult();
    clearToast();
    stopPoll();
    const value = el.queryInput.value.trim();
    if (!value) return fieldError(el.fieldQuery, '请输入查询码或卡密。');
    return runQuery(value);
  });
  el.queryBack.addEventListener('click', () => { clearQueryResult(); showView('cdk'); });
  el.navQuery.addEventListener('click', () => { stopPoll(); clearQueryResult(); showView('query'); });

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

  // --------------------------------------------------------- 深浅主题
  // 默认跟随系统；客户点过就按他选的来，记在他自己浏览器里。隐私模式下
  // localStorage 会抛错，读写都包起来，读不到就继续跟随系统。
  const THEME_KEY = 'pojia:theme';
  function currentTheme() {
    const stamped = document.documentElement.dataset.theme;
    if (stamped === 'light' || stamped === 'dark') return stamped;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  }
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  } catch { /* 存不了就跟随系统 */ }
  el.navTheme.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* 这次生效，下次再说 */ }
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
