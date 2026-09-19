// 卡片页渲染的回归测试（第⑥块 D-280 ①③⑤⑥，A「台账优先」）。
//
// 这里的断言大半不是「显示得对不对」，而是「不知道的东西有没有被写成一个数」：
// 没设的底线不能显示成 $0、查不到的余额不能显示成 0、读失败的待销不能显示成
// 「没有待销的卡」、拿不到的可销时间不能显示成「—」。这几种退化都会让人照着一个
// 不存在的事实去销卡或开卡，比报错危险得多。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAdminJs } from './helpers/admin-dom-harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const RIG_HNSKJ = {
  providerAccountId: 'pa-1', accountCode: 'legacy-primary', providerKind: 'hnskj',
  label: 'HNSKJ 卡台', total: 14, inStock: 2, plusAssignable: 1, inUse: 0, anyUsed: 0,
  stockTarget: 5, walletBalance: '41.20', walletCurrency: 'USD',
  walletSyncedAt: '2026-09-20T00:59:00.000Z', walletLiveOnly: false, walletFloor: '25.50',
  openedToday: 2, dailyLimit: 3, supplyFaultState: 'OK', supplyFaultReason: null, tokenFault: false
};
const RIG_BACKUP = {
  providerAccountId: 'pa-3', accountCode: 'backup-a', providerKind: 'manual_excel',
  label: '备用卡台（highvcc）', total: 16, inStock: 7, plusAssignable: 1, inUse: 0, anyUsed: 0,
  stockTarget: 5, walletBalance: null, walletCurrency: 'USD', walletSyncedAt: null,
  walletLiveOnly: true, walletFloor: null, openedToday: 1, dailyLimit: 3,
  supplyFaultState: 'OK', supplyFaultReason: null, tokenFault: false
};
const CARD_READY = {
  providerAccountId: 'pa-1', providerCardId: 'h-1', externalCardId: 'h-1', last4: '4417',
  providerLabel: 'HNSKJ 卡台', currentBalance: '12.40', lastSyncedAt: '2026-09-20T00:59:00.000Z',
  usedCapacity: 0, maxCapacity: 3, category: 'READY', reason: '可直接分配 Plus',
  publicNo: null, createdAt: '2026-09-18T00:00:00.000Z', issueFee: '1.200000', assigned: false
};
const CARD_RETIRED = { ...CARD_READY, providerCardId: 'h-9', externalCardId: 'h-9',
  last4: '9999', category: 'RETIRED', reason: '已永久停用，不参与分配' };

test('三个渲染函数确有定义，且真实 admin.js 能加载（F-68 守门）', () => {
  const { sandbox } = loadAdminJs();
  for (const fn of ['renderCardRigs', 'renderStockCards', 'renderCardRetirement']) {
    assert.equal(typeof sandbox[fn], 'function', `${fn} 必须有定义`);
  }
});

test('没设过的钱包底线显示「未设底线」，绝不显示成 $0.00', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([RIG_HNSKJ, RIG_BACKUP]);
  const out = html('sel:#cards-rigs');
  assert.match(out, /未设底线/);
  // backup-a 的 walletFloor 是 null。一个编出来的 $0 底线会让「余额够不够」这句话失去意义。
  assert.doesNotMatch(out, /\/ \$0\.00/);
  // hnskj 设过的那个要照常显示
  assert.match(out, /\$25\.50/);
});

test('highvcc 不显示余额数字，只给「查余额」按钮（它没有快照，余额只能实时查）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([RIG_BACKUP]);
  const out = html('sel:#cards-rigs');
  assert.match(out, /data-rig-wallet="backup-a"/);
  assert.match(out, /查余额/);
  // walletBalance 是 null，不能被 formatMoney 成 0.00 顶上去
  assert.doesNotMatch(out, /\$0\.00 <small>\//);
});

test('token 只在 supply fault 是 HIGHVCC_TOKEN 时说「已失效」；没故障时不写「有效」', () => {
  const { sandbox, html } = loadAdminJs();

  sandbox.renderCardRigs([{ ...RIG_BACKUP, tokenFault: false }]);
  const healthy = html('sel:#cards-rigs');
  assert.doesNotMatch(healthy, /已失效/);
  // tokenStatus() 只答「配没配过」，答不了有效性——所以没告警时一个字都不能说「有效」。
  assert.doesNotMatch(healthy, /有效(?!性)/);

  sandbox.renderCardRigs([{ ...RIG_BACKUP, tokenFault: true,
    supplyFaultState: 'FAULT', supplyFaultReason: 'HIGHVCC_TOKEN_EXPIRED' }]);
  const faulty = html('sel:#cards-rigs');
  assert.match(faulty, /已失效/);
  assert.match(faulty, /is-alarm/, 'token 失效要整栏标红');
});

test('台账读取失败时说读取失败，不渲染成「还没有卡台」', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs({ __error: true });
  const out = html('sel:#cards-rigs');
  assert.match(out, /读取失败/);
  assert.doesNotMatch(out, /还没有卡台/);
});

test('待销清单读取失败时说读取失败，绝不显示成「当前没有待销的卡」', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRetirement({ __error: true });
  const out = html('sel:#card-retirement-list');
  assert.match(out, /读取失败/);
  assert.match(out, /先别据此销卡/);
  // 这一条是整份测试里最要紧的：把「读不到」显示成「没有」会让人以为没卡要销。
  assert.doesNotMatch(out, /当前没有待销的卡/);
});

test('未到期的卡不给「我已在卡台删掉」按钮，只显示还差多久', () => {
  const { sandbox, html } = loadAdminJs();
  const future = new Date(Date.now() + 3 * 3600_000).toISOString();
  sandbox.renderCardRetirement({
    minAgeHours: 6,
    due: [{ cardId: 'c1', last4: '7726', providerCode: 'hnskj', reasonLabels: ['余额已用尽'],
      currentBalance: '0.35', due: true, dueAt: '2026-09-19T00:00:00.000Z' }],
    notYetDue: [{ cardId: 'c2', last4: '5590', providerCode: 'manual_excel', reasonLabels: ['卡台标记失效'],
      currentBalance: '0.02', due: false, dueAt: future }],
    recentlyConfirmed: []
  });
  const out = html('sel:#card-retirement-list');
  assert.match(out, /data-retire-confirm="c1"/, '到期的要给按钮');
  assert.doesNotMatch(out, /data-retire-confirm="c2"/, '未到期的绝不能给按钮');
  assert.match(out, /未到可销时间/);
  assert.match(out, /还差/);
});

test('待销读取失败时，卡表「可销」列显示「读取失败」而不是「—」', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderStockCards([CARD_READY], { __error: true });
  const out = html('sel:#stock-cards');
  assert.match(out, /读取失败/);
});

test('在役表不含退役卡；退役卡进历史折叠', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderStockCards([CARD_READY, CARD_RETIRED], { due: [], notYetDue: [] });
  const active = html('sel:#stock-cards');
  assert.match(active, /4417/);
  assert.doesNotMatch(active, /9999/, '退役卡不能出现在在役表');
  const history = html('sel:#stock-cards-history');
  assert.match(history, /9999/);
  assert.match(history, /data-history-toggle/);
});

test('「我手动用了」必须带上 account 和 externalCardId，否则点了也登记不到卡', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderStockCards([CARD_READY], { due: [], notYetDue: [] });
  const out = html('sel:#stock-cards');
  const match = out.match(/data-manual-use="1"[\s\S]*?data-account="([^"]*)"[\s\S]*?data-ext="([^"]*)"/);
  assert.ok(match, '必须渲染出手动用卡按钮');
  assert.equal(match[1], 'pa-1');
  // overrides 端点按 external_card_id 匹配，不是 provider_card_id——别让页面拿错字段去顶。
  assert.equal(match[2], 'h-1');
});

test('使用中的卡不给「我手动用了」（先把那一单收口）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderStockCards([{ ...CARD_READY, category: 'IN_USE', publicNo: 'PJ-1', assigned: true }],
    { due: [], notYetDue: [] });
  assert.doesNotMatch(html('sel:#stock-cards'), /data-manual-use/);
});

test('卡片页不得使用 .workbench 作用域的 class（写了也不生效，会退化成纯文字）', () => {
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'workbench.css'), 'utf8');
  const stockView = html.slice(html.indexOf('id="stock-view"'), html.indexOf('id="settings-view"'));
  // workbench.css 里 `.workbench .wb-x{}` 这类规则只在 .workbench 子树生效。
  // 2026-09-19 CDK 页就是这么糊掉的，卡片页不能再犯。
  const scoped = [...css.matchAll(/\.workbench\s+\.([a-z0-9-]+)/g)].map((m) => m[1]);
  for (const cls of new Set(scoped)) {
    assert.doesNotMatch(stockView, new RegExp(`class="[^"]*\\b${cls}\\b`),
      `卡片页用了 .workbench 作用域下的 .${cls}，样式不会生效`);
  }
});

test('卡片页的样式表真的被引入（否则整页退化成无样式表格）', () => {
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
  assert.match(html, /cards\.css\?v=\d+/);
  const css = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'cards.css'), 'utf8');
  // 卡片页自己的类名不依赖任何祖先作用域
  for (const cls of ['cardrigs', 'cardtable', 'cardretire', 'cardfold']) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `cards.css 必须定义 .${cls}`);
  }
  // 去掉注释再查——注释里提 .workbench（说明为什么不用它）是允许的，选择器里不行。
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /\.workbench/, 'cards.css 的选择器不该依赖 .workbench 作用域');
});
