/* =========================================================================
   mock-api.js — 原型专属的假后端。绝不连接生产，仅在浏览器内存里模拟。
   目的：让原型忠实复现真实客户契约（字段名、状态映射、错误码），
        而无需任何真实订单 / 卡台 / 付款。生产版本用真实 fetch 替换本文件。

   对齐的真实契约（来自 v1/src）：
   - POST /api/v1/orders           {cdk, session} -> {order:{publicNo,status}}
   - POST /api/v1/orders/status    {publicNo}|{cdk} -> {order}
   - POST /api/v1/orders/session   {publicNo, session} -> {order}
   - 客户状态仅 7 种；内部卡台/资金状态在后端已折叠，客户看不到。
   - 邮箱取自 session.user.email（与后端 customerEmail 同源）。
   ========================================================================= */
(function () {
  'use strict';

  // 内部状态 -> 客户状态（复刻 order-status-service.js 的 CUSTOMER_STATUS 映射）
  const CUSTOMER_STATUS = {
    CREATED: 'QUEUED',
    CARD_PURCHASING: 'PROCESSING', CARD_PROVISIONING: 'PROCESSING',
    CARD_READY: 'PROCESSING', WAITING_FOR_CARD: 'PROCESSING',
    CARD_FAILED: 'FAILED',
    WAITING_FOR_SESSION: 'ACTION_REQUIRED',
    SUBMITTING: 'PROCESSING', RECHARGE_PROCESSING: 'PROCESSING',
    SUBMIT_UNKNOWN: 'REVIEWING', RECONCILIATION_REQUIRED: 'REVIEWING',
    RECHARGE_SUCCESS: 'SUCCESS', RECHARGE_FAILED: 'FAILED',
    CANCELLATION_PENDING: 'FINALIZING', CANCELLATION_REVIEW_REQUIRED: 'REVIEWING'
  };
  const mapCustomer = (s) => CUSTOMER_STATUS[s] || 'REVIEWING';

  // 默认自动推进剧本（内部状态序列，模拟 worker 逐步处理）
  const HAPPY_PATH = [
    'CREATED', 'CARD_PURCHASING', 'SUBMITTING', 'RECHARGE_PROCESSING',
    'CANCELLATION_PENDING', 'RECHARGE_SUCCESS'
  ];

  const orders = new Map();      // publicNo -> order 内部记录
  const cdkIndex = new Map();    // cdk -> publicNo（模拟 CDK 一次性绑定）
  let speed = 3200;              // 每步推进毫秒（演示用，可调）

  function randPublicNo() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let s = '';
    for (let i = 0; i < 20; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return 'PJV1-' + s;
  }

  function apiError(code, status) {
    const e = new Error(String(code || 'request_failed').toLowerCase());
    e.code = code; e.status = status || 400;
    return e;
  }

  // 生成客户契约形态的 order（与 order-status-service.js 输出一致）
  function toCustomerOrder(rec) {
    const status = mapCustomer(rec.internal);
    // 事件去重（连续相同客户态合并），模拟 customerTimeline
    const timeline = [];
    for (const ev of rec.events) {
      const cs = mapCustomer(ev.to);
      if (!timeline.length || timeline[timeline.length - 1].status !== cs) {
        timeline.push({ status: cs, updatedAt: new Date(ev.at).toISOString() });
      }
    }
    const order = {
      publicNo: rec.publicNo,
      status,
      updatedAt: new Date(rec.updatedAt).toISOString(),
      timeline
    };
    if (rec.actionCode) {
      order.actionRequired = {
        code: rec.actionCode,
        message: rec.actionCode === 'ACCOUNT_ALREADY_PLUS'
          ? '当前账号已是 Plus，请更换一个免费账号的 Session。'
          : '当前 Session 无效，请重新获取完整 Session。'
      };
      order.sessionReplacement = {
        used: rec.replaceUsed,
        remaining: Math.max(0, 3 - rec.replaceUsed),
        expiresAt: new Date(rec.updatedAt + 30 * 60 * 1000).toISOString()
      };
    }
    if (status === 'SUCCESS') {
      order.customerEmail = rec.email;
      order.finishedAt = new Date(rec.updatedAt).toISOString();
    }
    return order;
  }

  function pushEvent(rec, internal) {
    rec.internal = internal;
    rec.updatedAt = Date.now();
    rec.events.push({ to: internal, at: rec.updatedAt });
  }

  function advance(rec) {
    if (!rec.autoplay || rec.stopped) return;
    const idx = HAPPY_PATH.indexOf(rec.internal);
    if (idx < 0 || idx >= HAPPY_PATH.length - 1) { rec.stopped = true; return; }
    pushEvent(rec, HAPPY_PATH[idx + 1]);
    if (rec.internal !== 'RECHARGE_SUCCESS') {
      rec.timer = setTimeout(() => advance(rec), speed);
    }
  }

  // ---- 模拟三个接口（返回 Promise，带真实网络延迟感） ----
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  async function createOrder({ cdk, session }) {
    await delay(650);
    cdk = String(cdk || '').trim();
    if (cdk.length < 8) throw apiError('CDK_UNAVAILABLE', 409);
    if (cdkIndex.has(cdk)) throw apiError('CDK_UNAVAILABLE', 409);   // 一次性：已绑定
    // 邮箱来自 session.user.email（后端同源）
    const email = session && session.user && session.user.email;
    if (!email || typeof email !== 'string') throw apiError('INCOMPLETE_SESSION', 400);
    // 演示钩子：邮箱以 expired@ 开头 → 模拟过期
    if (/^expired@/i.test(email)) throw apiError('ACCESS_TOKEN_EXPIRED', 400);

    const publicNo = randPublicNo();
    const rec = {
      publicNo, email, cdk, internal: 'CREATED', updatedAt: Date.now(),
      events: [{ to: 'CREATED', at: Date.now() }],
      autoplay: true, stopped: false, replaceUsed: 0, actionCode: null, timer: null
    };
    orders.set(publicNo, rec);
    cdkIndex.set(cdk, publicNo);
    rec.timer = setTimeout(() => advance(rec), speed);
    return { order: { publicNo, status: 'CREATED' } };
  }

  async function getStatus({ publicNo, cdk }) {
    await delay(320);
    let rec = null;
    if (publicNo) rec = orders.get(String(publicNo).trim());
    else if (cdk) rec = orders.get(cdkIndex.get(String(cdk).trim()));
    if (!rec) throw apiError('ORDER_NOT_FOUND', 404);
    return { order: toCustomerOrder(rec) };
  }

  async function replaceSession({ publicNo, session }) {
    await delay(600);
    const rec = orders.get(String(publicNo || '').trim());
    if (!rec) throw apiError('ORDER_NOT_FOUND', 404);
    if (rec.actionCode == null) throw apiError('SESSION_REPLACEMENT_NOT_ALLOWED', 409);
    if (rec.replaceUsed >= 3) throw apiError('SESSION_REPLACEMENT_LIMIT_REACHED', 409);
    const email = session && session.user && session.user.email;
    if (!email) throw apiError('INCOMPLETE_SESSION', 400);
    rec.replaceUsed += 1;
    rec.email = email;
    rec.actionCode = null;
    rec.stopped = false; rec.autoplay = true;
    pushEvent(rec, 'CARD_PURCHASING');
    rec.timer = setTimeout(() => advance(rec), speed);
    return { order: toCustomerOrder(rec) };
  }

  // ---- 演示控制（仅原型；生产不存在） ----
  function demoForceStatus(internalOrCustomer) {
    // 允许直接指定客户态，映射回一个代表性内部态
    const map = {
      QUEUED: 'CREATED', PROCESSING: 'RECHARGE_PROCESSING', REVIEWING: 'SUBMIT_UNKNOWN',
      FINALIZING: 'CANCELLATION_PENDING', ACTION_REQUIRED: 'WAITING_FOR_SESSION',
      SUCCESS: 'RECHARGE_SUCCESS', FAILED: 'RECHARGE_FAILED'
    };
    const internal = map[internalOrCustomer] || internalOrCustomer;
    const publicNo = randPublicNo();
    const now = Date.now();
    // 构造一段合理的历史事件，让时间线有内容
    const history = {
      CREATED: ['CREATED'],
      RECHARGE_PROCESSING: ['CREATED', 'CARD_PURCHASING', 'SUBMITTING', 'RECHARGE_PROCESSING'],
      SUBMIT_UNKNOWN: ['CREATED', 'CARD_PURCHASING', 'SUBMITTING', 'SUBMIT_UNKNOWN'],
      CANCELLATION_PENDING: ['CREATED', 'CARD_PURCHASING', 'SUBMITTING', 'RECHARGE_PROCESSING', 'CANCELLATION_PENDING'],
      WAITING_FOR_SESSION: ['CREATED', 'WAITING_FOR_SESSION'],
      RECHARGE_SUCCESS: ['CREATED', 'CARD_PURCHASING', 'SUBMITTING', 'RECHARGE_PROCESSING', 'CANCELLATION_PENDING', 'RECHARGE_SUCCESS'],
      RECHARGE_FAILED: ['CREATED', 'CARD_PURCHASING', 'SUBMITTING', 'RECHARGE_FAILED']
    }[internal] || ['CREATED', internal];
    const step = 60 * 1000;
    const events = history.map((to, i) => ({ to, at: now - (history.length - i) * step }));
    const rec = {
      publicNo, email: 'lin.zhao@gmail.com', cdk: 'DEMO-' + publicNo.slice(5, 13),
      internal, updatedAt: now, events,
      autoplay: false, stopped: true,
      replaceUsed: internal === 'WAITING_FOR_SESSION' ? 0 : 0,
      actionCode: internal === 'WAITING_FOR_SESSION' ? 'ACCOUNT_ALREADY_PLUS' : null,
      timer: null
    };
    orders.set(publicNo, rec);
    cdkIndex.set(rec.cdk, publicNo);
    return toCustomerOrder(rec);
  }

  function demoSetSpeed(ms) { speed = ms; }

  window.MockBackend = {
    createOrder, getStatus, replaceSession,
    demoForceStatus, demoSetSpeed,
    __isMock: true
  };
})();
