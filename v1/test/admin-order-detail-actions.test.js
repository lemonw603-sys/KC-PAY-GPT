// 订单详情页动作区的回归测试（欠账 10：API 路线付款不明此前没有任何界面入口）。
//
// 为什么用 vm 加载真实 admin.js：动作区是 openOrder 内联拼的 HTML，后端单测覆盖不到。
// 这里给它一个最小 DOM stub、把 fetch 换成固定详情响应，真跑一遍 openOrder，读渲染结果。
// 它同时是 F-61 在详情页那一半的守门人：付款不明的 case 不许再出现「关闭对账案例」。
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAdminJs } from './helpers/admin-dom-harness.js';

// 顶层键取自隔离库一次真实 /admin/orders/:publicNo 响应（LOAD-0023）：
// stage / browserRun / money / reconciliationCases / order / card / reconciliation /
// paymentGate / compensation / cancellation / traceability / events / tasks /
// providerCalls / transactions / refund。少一个键 openOrder 就会在渲染中途抛错、
// 被它那个不带变量的 catch 吞成「订单详情读取失败」——自造的简化夹具会假装通过。
const BASE = {
  order: { publicNo: 'PJV1-abcdefgh', status: 'RECONCILIATION_REQUIRED', planType: 'plus', customerEmail: 'a@b.c' },
  stage: {}, browserRun: null, card: null, paymentGate: {}, compensation: {}, cancellation: {},
  reconciliation: {}, traceability: {}, refund: {},
  money: { attempts: [], ledger: [], operations: [] }, reconciliationCases: [],
  events: [], tasks: [], providerCalls: [], transactions: [],
  unknownSubmission: { eligible: false, reasonCode: 'UNKNOWN_RESOLUTION_NOT_ELIGIBLE', attemptId: null },
};

async function renderDetail(patch = {}) {
  const h = loadAdminJs();
  const data = { ...BASE, ...patch };
  h.sandbox.fetch = async () => ({ ok: true, status: 200, json: async () => data });
  await h.sandbox.openOrder('PJV1-abcdefgh');
  // detailContent 走 document.querySelector('#detail-content') 那条路
  return h.html('sel:#detail-content') || h.html('detail-content');
}

test('API 付款不明、资格合格 → 详情页出现「确认核实结果」按钮（此前一个入口都没有）', async () => {
  const html = await renderDetail({ unknownSubmission: { eligible: true, reasonCode: null, attemptId: 'att-1' } });
  assert.match(html, /id="resolve-unknown-submission"/, '合格时必须渲染 API 收口按钮');
  assert.match(html, /确认核实结果/);
});

test('资格不合格 → 不渲染该按钮（页面不给一个后端必然拒绝的钮）', async () => {
  const html = await renderDetail();
  assert.doesNotMatch(html, /id="resolve-unknown-submission"/);
});

test('F-61 详情页那一半：付款不明的 case 不再给「关闭对账案例」', async () => {
  const html = await renderDetail({
    unknownSubmission: { eligible: true, reasonCode: null, attemptId: 'att-1' },
    reconciliationCases: [
      { id: 'c-api', caseType: 'API_PAYMENT_UNKNOWN', status: 'OPEN' },
      { id: 'c-br', caseType: 'BROWSER_PAYMENT_UNKNOWN', status: 'OPEN' },
    ],
  });
  assert.doesNotMatch(html, /data-resolve-order-case="c-api"/, '付款不明不许给关记录的钮');
  assert.doesNotMatch(html, /data-resolve-order-case="c-br"/, '付款不明不许给关记录的钮');
  // 收口的路还在
  assert.match(html, /id="resolve-unknown-submission"/);
});

test('其它类型的对账 case 仍然可以「关闭对账案例」（只收窄付款不明那两类）', async () => {
  const html = await renderDetail({
    reconciliationCases: [{ id: 'c-x', caseType: 'PAYMENT_AMOUNT_MISMATCH', status: 'OPEN' }],
  });
  assert.match(html, /data-resolve-order-case="c-x"/);
  assert.match(html, /付款金额不一致/);
});

test('已解决的 case 一个钮都不出（openCases 过滤在前）', async () => {
  const html = await renderDetail({
    reconciliationCases: [{ id: 'c-done', caseType: 'PAYMENT_AMOUNT_MISMATCH', status: 'RESOLVED' }],
  });
  assert.doesNotMatch(html, /data-resolve-order-case="c-done"/);
});
