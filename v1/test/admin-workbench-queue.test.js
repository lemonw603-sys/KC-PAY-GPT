// 工作台队列/日对账渲染的回归测试（第⑥块 付款不明链，F-61/62/63 + F-68）。
//
// 为什么用 vm 加载真实 admin.js：admin.js 是浏览器端全局脚本（非 module、无 IIFE），
// 顶层函数就是全局函数。此前 F-68 那次事故正是「renderWbQueue 引用了一个根本没定义的
// 常量」——后端单测天然覆盖不到前端 JS，页面一有 case 就 ReferenceError。这里给它一个
// 最小 DOM stub 真正执行一遍，任何未定义引用/渲染异常都会在断言前先抛出来。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAdminJs } from './helpers/admin-dom-harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const adminJsPath = path.join(here, '..', 'public', 'admin', 'assets', 'admin.js');

const OVERVIEW = { operationalBacklog: {} };
const openCase = (caseType, publicNo, id) => ({
  id, caseType, severity: 'critical', status: 'OPEN', publicNo,
  lastSeenAt: '2026-09-19T00:00:00.000Z',
});

test('F-68: 真实 admin.js 能加载，且付款不明用的常量确有定义（不是 undefined）', () => {
  const { sandbox, evalIn } = loadAdminJs();
  assert.equal(typeof sandbox.renderWbQueue, 'function');
  assert.equal(typeof sandbox.renderWbRecon, 'function');
  // 这一条就是 F-68 的守门人：常量缺失时 renderWbQueue 一遇 case 就 ReferenceError。
  assert.equal(evalIn('typeof PAYMENT_UNKNOWN_CASE_TYPES'), 'object',
    'PAYMENT_UNKNOWN_CASE_TYPES 必须有定义，否则队列一有 case 就崩');
  assert.equal(evalIn('PAYMENT_UNKNOWN_CASE_TYPES instanceof Set'), true);
  assert.equal(evalIn("PAYMENT_UNKNOWN_CASE_TYPES.has('API_PAYMENT_UNKNOWN')"), true);
  assert.equal(evalIn("PAYMENT_UNKNOWN_CASE_TYPES.has('BROWSER_PAYMENT_UNKNOWN')"), true);
});

test('F-61/F-68: 队列里带真实 caseType 的付款不明 case → 渲染「去核实收口」并跳订单详情，不给直接关 case 的按钮', () => {
  const { sandbox, html } = loadAdminJs();
  // 不 try/catch：常量缺失或渲染异常必须让这条测试直接红。
  sandbox.renderWbQueue(OVERVIEW, null, { alerts: [] }, {
    cases: [
      openCase('API_PAYMENT_UNKNOWN', 'PJV1-APITEST01', 'case-api'),
      openCase('BROWSER_PAYMENT_UNKNOWN', 'PJV1-BROWTEST1', 'case-brw'),
    ],
  });
  const out = html('wb-queue');
  assert.ok(out.includes('去核实收口'), '付款不明应引导去订单详情做正式收口');
  assert.ok(out.includes('data-open-case-order-wb="PJV1-APITEST01"'), 'API 单应带单号跳订单详情');
  assert.ok(out.includes('data-open-case-order-wb="PJV1-BROWTEST1"'), 'Browser 单应带单号跳订单详情');
  assert.ok(!out.includes('data-resolve-wb-case'),
    '付款不明不得提供「只关 case 不收口」的按钮（F-61 病根）');
});

test('F-61: 非付款不明的对账 case 仍可「关闭记录」，且不叫「解决」', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbQueue(OVERVIEW, null, { alerts: [] }, {
    cases: [openCase('PAYMENT_AMOUNT_MISMATCH', 'PJV1-OTHER0001', 'case-other')],
  });
  const out = html('wb-queue');
  assert.ok(out.includes('关闭记录'), '非付款不明保留纯记录动作');
  assert.ok(out.includes('data-resolve-wb-case="case-other"'));
  assert.ok(!out.includes('去核实收口'));
});

test('F-63: 待办来源接口失败时，空队列必须说「读取失败」，不得冒充「今天清爽」', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbQueue(OVERVIEW, { __error: true }, { alerts: [], __error: true }, { cases: [], __error: true });
  const out = html('wb-queue');
  assert.ok(out.includes('接口失败'), '必须明示读取失败');
  assert.ok(!out.includes('今天清爽'), '读取失败不能显示成没有待办');
});

test('查过确实没有待办时，才显示「今天清爽」', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbQueue(OVERVIEW, null, { alerts: [] }, { cases: [] });
  assert.ok(html('wb-queue').includes('今天清爽'));
});

test('F-62: 日对账「无法核对」读 unverifiableAmountCount，显真实值而非 0', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbRecon({
    discrepancyCount: 6, pendingRegistrationCount: 1,
    unverifiableAmountCount: 30, persistentCount: 0,
  });
  const out = html('wb-recon');
  assert.ok(out.includes('30'), '应显示服务端真实的 30');
  assert.ok(out.includes('无法核对'));
});

test('F-62: 字段缺失显「—」，把「未知」和「真实 0」分开', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbRecon({ discrepancyCount: 0, pendingRegistrationCount: 0, persistentCount: 0 });
  assert.ok(html('wb-recon').includes('—'), '缺字段不得默认成 0');
});

test('F-63: 日对账接口失败显「读取失败」，与「今天还没对账」分开', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbRecon({ __error: true });
  assert.ok(html('wb-recon').includes('读取失败'));
  sandbox.renderWbRecon(null);
  assert.ok(html('wb-recon').includes('暂无数据'));
});

// ——— 上游测试：loadOverview → api() → 渲染 整条 ———
// 教训：此前只把 {__error:true} 直接喂给 renderWbQueue，测的是下游渲染，
// 于是「loadOverview 根本没产生 __error」这一半漏了整整一轮：真实页面接口 500 时
// 照样显示「今天清爽」。这个用例从 fetch 层注入 500，必须走完 api() 的 throw、
// loadOverview 的 catch、再到渲染，才算真的证明 F-63。
function stubResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test('F-63 上游：待办接口 500 时，loadOverview 必须让队列说「接口失败」而不是「今天清爽」', async () => {
  const { sandbox, html } = loadAdminJs();
  const overviewPayload = {
    operationalBacklog: {}, decisions: {}, todayOrders: 0, successRate: null,
    cardStockByProvider: [], alerts: [],
  };
  sandbox.fetch = (url) => {
    const u = String(url);
    if (u.includes('/admin/overview')) return Promise.resolve(stubResponse(200, overviewPayload));
    // 待办三源全挂
    if (u.includes('/reconciliation-cases') || u.includes('/reconciliation/daily') || u.includes('/alerts')) {
      return Promise.resolve(stubResponse(500, { error: 'boom' }));
    }
    return Promise.resolve(stubResponse(200, {}));
  };
  await sandbox.loadOverview();
  const q = html('wb-queue');
  assert.ok(q.includes('接口失败'), '接口挂了必须明说，当前渲染=' + q.slice(0, 120));
  assert.ok(!q.includes('今天清爽'), '读取失败绝不能显示成「没有待办」');
  assert.ok(html('wb-recon').includes('读取失败'), '日对账失败也要说失败');
});

test('F-63 上游对照：接口都正常且确实没有待办时，才显示「今天清爽」', async () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.fetch = (url) => {
    const u = String(url);
    if (u.includes('/admin/overview')) return Promise.resolve(stubResponse(200, { operationalBacklog: {}, decisions: {} }));
    if (u.includes('/reconciliation-cases')) return Promise.resolve(stubResponse(200, { cases: [] }));
    if (u.includes('/reconciliation/daily')) return Promise.resolve(stubResponse(200, null));
    if (u.includes('/alerts')) return Promise.resolve(stubResponse(200, { alerts: [] }));
    return Promise.resolve(stubResponse(200, { orders: [] }));
  };
  await sandbox.loadOverview();
  const q = html('wb-queue');
  assert.ok(q.includes('今天清爽'), '真的没有待办时才说清爽，当前渲染=' + q.slice(0, 120));
  assert.ok(!q.includes('接口失败'));
});

// ——— D-285：数字墙与队列按原型 C 恢复 ———
test('D-285 数字墙：五格按原型，后端没有的三项必须标「待接入」而不是拿别的指标顶替', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbWall({
    metrics: { todayOrders: 12, processingOrders: 1, successRate: 92, completedOrders: 12 },
    cardStockByProvider: [{ plusAssignable: 2 }],
    operationalBacklog: { reconciliationCasesOpen: 5 },
    openAlertCount: 48,
  });
  const out = html('wb-wall');
  assert.ok(out.includes('今日单数') && out.includes('12'), '今日单数接真实值');
  assert.ok(out.includes('成功率') && out.includes('92%'), '成功率接真实值');
  assert.ok(out.includes('自动完成率') && out.includes('今日花费') && out.includes('异常支出'),
    '五格必须是原型那五格');
  assert.equal((out.match(/待接入/g) || []).length, 3, '后端没有的三项都要标「待接入」');
  // 撤销在途版换上的三项，别再混进来
  assert.ok(!out.includes('可分配卡') && !out.includes('待核对') && !out.includes('开着的告警'),
    '不得保留在途版擅自替换的指标（D-285）');
  // 关键：不许拿手头数字顶替空位
  assert.ok(!out.includes('48') && !out.includes('>5<'), '不得用告警数/案例数顶替未接入的格子');
});

test('D-285 队列：待销到期与 token 失效按原型放回工作台（F-64 在本块闭合）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbQueue(
    { operationalBacklog: {} },
    { retirementDueCount: 4, discrepancyCount: 0, persistentCount: 0, pendingRegistrationCount: 0 },
    { alerts: [{ id: 'a1', type: 'PROVIDER_TOKEN_EXPIRED', title: 'token 过期', message: '重新贴一次 token', createdAt: '2026-09-19T12:58:00.000Z' }] },
    { cases: [] },
  );
  const out = html('wb-queue');
  assert.ok(out.includes('待销到期 4 张卡'), '待销到期要出现在工作台队列');
  assert.ok(out.includes('token 已失效'), 'token 失效要出现在工作台队列');
  assert.ok(!out.includes('今天清爽'), '有待办就不能说清爽');
});

test('D-285 队列：没有 token 失效告警时，不得擅自显示「token 有效」', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbQueue({ operationalBacklog: {} }, { retirementDueCount: 0 }, { alerts: [] }, { cases: [] });
  const out = html('wb-queue');
  assert.ok(!out.includes('token 有效'), 'configured 推不出有效，不许写成有效（观察≠结论）');
  assert.ok(!out.includes('token 已失效'), '没有失效告警也不能报失效');
});

// ——— D-284 ① 营业条方向 A：路线切换留在工作台 ———
test('D-284① 营业条：3 个 toggle + 路线切换块都在工作台', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderDecisions(
    { decisions: { acceptNewOrders: true, dispatchNewRecharges: true, browserPaymentWritesEnabled: false },
      providerHealth: { rechargeMethod: 'API' } },
    { sources: [{ id: 's1', displayName: 'HighVCC', supportsBrowserRecharge: true, operationalEnabled: true }],
      browserProviderAccountId: 's1', browserSelectionVersion: 3 },
  );
  const bar = html('wb-decisions');
  ['accept', 'dispatch', 'pay'].forEach((op) => assert.ok(bar.includes(`data-op="${op}"`), `营业条缺 ${op} toggle`));
  const routes = html('wb-routes');
  // 断结构不断文案：措辞按 Lemon 2026-09-20 的反馈改过（「切到浏览器」看不懂），
  // 这两条保护的是「路线与卡台的控件在工作台」，不是某几个字。
  assert.match(routes, /default-recharge-method/, '路线切换块必须在工作台（D-284 ①，不许挪去设置页）');
  assert.match(routes, /id="decision-card-source"/, '卡台选择仍在工作台');
});

test('D-284① 路线切换：当前路线标出来，另一条给可点的切换按钮', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderDecisions({ decisions: {}, providerHealth: { rechargeMethod: 'API' } }, { sources: [] });
  let routes = html('wb-routes');
  // 当前那条走 chip（wb-chip ok）标出来，不给切自己的按钮；文案可变，形态不变
  assert.match(routes, /wb-chip ok[^>]*>[\s\S]{0,40}API/, '应标出当前走 API');
  assert.ok(routes.includes('class="wb-btn sm out default-recharge-method" data-method="BROWSER"'),
    '另一条应给切换按钮（这个按钮此前从未被渲染，功能等于下线）');
  assert.ok(!routes.includes('data-method="API"'), '当前那条不该再给切自己的按钮');

  sandbox.renderDecisions({ decisions: {}, providerHealth: { rechargeMethod: 'BROWSER' } }, { sources: [] });
  routes = html('wb-routes');
  assert.match(routes, /wb-chip ok[^>]*>[\s\S]{0,40}浏览器/);
  assert.ok(routes.includes('data-method="API"'));
});

test('D-284① VERSION_MATCH 的根因：rechargeMethod 必须写进 state，否则路线永远切不动', () => {
  const { sandbox, evalIn } = loadAdminJs();
  sandbox.renderDecisions({ decisions: {}, providerHealth: { rechargeMethod: 'API' } }, { sources: [] });
  // state.rechargeMethod 是 setDefaultRechargeMethod 传给后端的 expectedCurrentMethod；
  // 从前它只被读、从不被写 → 恒 undefined → 传 'NONE' → 与实际 API 对不上 → 四项校验必拒。
  assert.equal(evalIn('state.rechargeMethod'), 'API',
    'overview.rechargeMethod 必须落进 state，否则 VERSION_MATCH 恒失败');
  sandbox.renderDecisions({ decisions: {}, providerHealth: { rechargeMethod: 'BROWSER' } }, { sources: [] });
  assert.equal(evalIn('state.rechargeMethod'), 'BROWSER');
});

test('D-284① 拒切时逐项原因能显示（四项校验的 checks 交给 switchCheckReasons）', () => {
  const { evalIn } = loadAdminJs();
  const reasons = evalIn(`switchCheckReasons({ payload: { checks: [
    { code: 'ROUTE_UNIQUE', ok: true },
    { code: 'TARGET_POOL_AVAILABLE', ok: false, detail: '目标卡台可分配 0 张' },
    { code: 'VERSION_MATCH', ok: false, detail: '页面看到的是 API，实际已是 BROWSER；请刷新' }
  ] } })`);
  assert.ok(reasons.includes('目标卡台可分配 0 张'), '没过的校验要逐条说原因');
  assert.ok(reasons.includes('请刷新'), '多条原因要都显示');
  assert.ok(!reasons.includes('ROUTE_UNIQUE'), '通过的项不该混进拒绝原因');
});

test('D-284① 字段位置锁死：rechargeMethod 在 providerHealth 下，读顶层拿不到（外部字段先验真）', () => {
  const { sandbox, evalIn } = loadAdminJs();
  // 真实 /admin/overview 响应里没有顶层 rechargeMethod；若哪天有人改回读顶层，这条会红。
  sandbox.renderDecisions({ decisions: {}, rechargeMethod: 'API' }, { sources: [] });
  assert.equal(evalIn('state.rechargeMethod'), null, '顶层 rechargeMethod 不是真实字段，不该被读到');
  sandbox.renderDecisions({ decisions: {}, providerHealth: { rechargeMethod: 'API' } }, { sources: [] });
  assert.equal(evalIn('state.rechargeMethod'), 'API', '真实字段在 providerHealth 下');
});

// ——— D-279 ③⑦：全局搜索贴码的展示 + 状态说人话 ———
test('D-279⑦ 状态说人话：「使用中」与「已交付」按订单是否成功区分', () => {
  const { sandbox } = loadAdminJs();
  const label = (row) => sandbox.cdkStatusLabel(row).text;
  assert.equal(label({ status: 'AVAILABLE', redeemableNow: true }), '可用·在手里');
  assert.equal(label({ status: 'AVAILABLE', redeemableNow: true, issuedAt: '2026-09-19T00:00:00Z' }), '已发出·待兑');
  // 码被绑走只说明开始用了；订单成功才算交付 —— 这两个不能混
  assert.equal(label({ status: 'REDEEMED', orderStatus: 'RECHARGE_PROCESSING' }), '使用中');
  assert.equal(label({ status: 'REDEEMED', orderStatus: 'RECHARGE_SUCCESS' }), '已交付');
  assert.equal(label({ status: 'REVOKED' }), '已作废');
  assert.equal(label({ status: 'AVAILABLE', expired: true }), '已过期');
  // 路线关掉时不能显示成「可用」（D-286 ②）
  assert.equal(label({ status: 'AVAILABLE', redeemableNow: false }), '暂不可兑');
  // 不许出现内部枚举词
  for (const row of [{ status: 'REDEEMED', orderStatus: 'X' }, { status: 'REVOKED' }]) {
    assert.ok(!/REDEEMED|REVOKED/.test(label(row)), '页面不得显示内部状态词');
  }
});

test('D-279③ 一键进详情的按钮必须有处理器（不能是能点但到不了对象的假落点）', () => {
  const src = fs.readFileSync(adminJsPath, 'utf8');
  assert.ok(/data-open-order="/.test(src), '存在 data-open-order 按钮');
  assert.ok(/closest\('\[data-open-order\]'\)/.test(src),
    'data-open-order 必须有点击处理器 —— 渲染了按钮却没处理器就是 F-64 那种假落点');
});

test('CDK 页不得使用 .workbench 作用域的 class（写了也不生效，会退化成纯文字）', () => {
  const src = fs.readFileSync(adminJsPath, 'utf8');
  const css = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'workbench.css'), 'utf8');
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
  // 前提：wb-* 样式确实被限定在 .workbench 里，且 CDK 视图不在该作用域
  assert.ok(/\.workbench \.wb-chip\{/.test(css), 'wb-chip 应是 .workbench 作用域限定的');
  assert.ok(/id="cdks-view" class="view"/.test(html), 'CDK 视图不带 workbench 作用域');
  // loadCdkCodes 的渲染里不许出现 wb-* class（注释不算）
  const fn = src.slice(src.indexOf('async function loadCdkCodes'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  const codeOnly = body.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(!/class="[^"]*\bwb-/.test(codeOnly),
    'CDK 页渲染不得用 .workbench 作用域的 wb-* class；旧页请用 .status-chip 等 admin.css 的类');
});
