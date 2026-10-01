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
  label: 'HNSKJ', total: 14, inStock: 2, stockAvailable: 1, bindableNow: 1, inUse: 0, anyUsed: 0,
  stockTarget: 5, walletBalance: '41.20', walletCurrency: 'USD',
  walletSyncedAt: '2026-09-20T00:59:00.000Z', walletLiveOnly: false, walletFloor: '30.00', walletAlertThreshold: '35.00',
  openedToday: 2, dailyLimit: 3, supplyFaultState: 'OK', supplyFaultReason: null, tokenFault: false
};
const RIG_BACKUP = {
  providerAccountId: 'pa-3', accountCode: 'backup-a', providerKind: 'manual_excel',
  label: 'highvcc', total: 16, inStock: 7, stockAvailable: 1, bindableNow: 1, inUse: 0, anyUsed: 0,
  stockTarget: 5, walletBalance: null, walletCurrency: 'USD', walletSyncedAt: null,
  walletLiveOnly: true, walletFloor: '20.00', walletAlertThreshold: '25.00', openedToday: 1, dailyLimit: 3,
  supplyFaultState: 'OK', supplyFaultReason: null, tokenFault: false
};
const CARD_READY = {
  providerAccountId: 'pa-1', providerCardId: 'h-1', externalCardId: 'h-1', last4: '4417',
  providerLabel: 'HNSKJ', currentBalance: '12.40', lastSyncedAt: '2026-09-20T00:59:00.000Z',
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

test('底线显示的就是挡开卡那条硬底线（provider_accounts.wallet_floor），不是另造的键', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([RIG_HNSKJ, RIG_BACKUP]);
  const out = html('sel:#cards-rigs');
  // 生产实值：hnskj 30 / backup-a 20，就是 walletPreflight 里那条「低于硬底线就不开卡」的线。
  // D-273 的教训：别为一个已经实现的东西再造第二份，页面上的底线必须和挡开卡的是同一个数。
  assert.match(out, /\$30\.00/);
  assert.match(out, /\$20\.00/);
});

test('真取不到底线时显示「未设底线」，绝不显示成 $0.00', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([{ ...RIG_HNSKJ, walletFloor: null }]);
  const out = html('sel:#cards-rigs');
  assert.match(out, /未设底线/);
  assert.doesNotMatch(out, /\/ \$0\.00/);
});

test('卡片页不给改底线的入口（wallet_floor 挡开卡，改它是资金动作，归设置页）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([RIG_HNSKJ, RIG_BACKUP]);
  assert.doesNotMatch(html('sel:#cards-rigs'), /data-rig-floor/);
});

// ④（Lemon 2026-09-24）：旧规则「highvcc 没有快照，只给查余额按钮」的前提已不成立——D-249 T1 起
// highvcc 每小时落 provider_balance_snapshots（生产 2026-09-24 最新 02:13 UTC）。现在那格直接显示
// 上次余额 + 查询时间，「刷新」原地更新；读的是本地快照，打开页面仍不打外网。
test('highvcc 那格直接显示上次余额 + 查询时间，刷新按钮原地更新；没快照不冒充 $0.00', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([RIG_BACKUP]);
  const none = html('sel:#cards-rigs');
  assert.match(none, /data-rig-wallet="backup-a"[^>]*>刷新</);
  assert.match(none, /data-rig-wallet-value>—<\/span>/);
  assert.match(none, /data-rig-wallet-when[^>]*>还没查过</);
  assert.doesNotMatch(none, /<label>[^<]*<button/, '刷新按钮不能包在 label 里（点标题会误触发）');
  assert.doesNotMatch(none, /\$0\.00 <small>/, '没有快照不能被 formatMoney 成 0.00 顶上去');

  const observedAt = new Date().toISOString();
  sandbox.renderCardRigs([{ ...RIG_BACKUP, walletObserved: { balance: '34.240000', currency: 'USD', observedAt } }]);
  const seen = html('sel:#cards-rigs');
  assert.match(seen, /data-rig-wallet-value>\$34\.24<\/span> <small>\/ \$20\.00<\/small>/, '数值行与 hnskj 同形：余额 / 底线');
  assert.match(seen, /data-rig-wallet-when[^>]*>查询于 \d{2}:\d{2}</, '查询时间在标题行右侧');
  assert.doesNotMatch(seen, /cardrig-q is-bad/, '34.24 高于底线 20，不标红');

  sandbox.renderCardRigs([{ ...RIG_BACKUP, walletObserved: { balance: '12.00', currency: 'USD', observedAt } }]);
  assert.match(html('sel:#cards-rigs'), /cardrig-q is-bad/, '低于底线 20 要标红');
});

test('hnskj 快照缺一次也不会被当成 highvcc 渲染（按 providerKind 认，2026-09-24 本机撞到）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([{ ...RIG_HNSKJ, walletLiveOnly: true, walletBalance: null, walletSyncedAt: null }]);
  const out = html('sel:#cards-rigs');
  assert.doesNotMatch(out, /data-rig-wallet=/, 'hnskj 那栏不出现 highvcc 的刷新按钮');
  assert.match(out, /无快照/);
});

test('token 认 PROVIDER_TOKEN_EXPIRED 告警，不认 supply_fault_state（B2）', () => {
  const { sandbox, html } = loadAdminJs();

  // 生产 2026-09-20 实测正处在这个矛盾态：supply_fault_state=OK 而告警 OPEN。
  // 旧口径据 supply_fault_state 说「已配置」，工作台据告警说「已失效」，同一个后台两页相反。
  // 权威信号是告警——这一条钉住：supplyFault 说没事也压不住告警。
  sandbox.renderCardRigs([{ ...RIG_BACKUP, tokenExpiredAlert: true, tokenFault: false,
    supplyFaultState: 'OK' }], { configured: true, updatedAt: '2026-09-20T06:12:00.000Z' });
  const alarmed = html('sel:#cards-rigs');
  assert.match(alarmed, /已失效/);
  assert.match(alarmed, /is-alarm/, 'token 失效要整栏标红');

  // 反过来：开卡失败写的那个 supply fault **不是** token 信号，不许让它冒充「已失效」。
  sandbox.renderCardRigs([{ ...RIG_BACKUP, tokenExpiredAlert: false, tokenFault: true,
    supplyFaultState: 'FAULT', supplyFaultReason: 'HIGHVCC_TOKEN_EXPIRED' }],
  { configured: true, updatedAt: '2026-09-20T06:12:00.000Z' });
  const supplyFaultOnly = html('sel:#cards-rigs');
  assert.doesNotMatch(supplyFaultOnly, /已失效/);
  assert.doesNotMatch(supplyFaultOnly, /is-alarm/);
});

test('没有 token 告警时只报上次贴的时间，一个字都不写「有效」', () => {
  const { sandbox, html } = loadAdminJs();

  sandbox.renderCardRigs([{ ...RIG_BACKUP, tokenExpiredAlert: false }],
    { configured: true, updatedAt: '2026-09-20T06:12:00.000Z' });
  const healthy = html('sel:#cards-rigs');
  assert.doesNotMatch(healthy, /已失效/);
  // token 两小时不活动就过期，configured=true 推不出有效 —— 观察与结论分开。
  assert.doesNotMatch(healthy, /有效(?!性)/);
  assert.doesNotMatch(healthy, /已配置/);
  assert.match(healthy, /上次贴/);

  // 没贴过就说没贴过；状态读不到就说读不到。都不许含糊成一个像样的词。
  sandbox.renderCardRigs([{ ...RIG_BACKUP, tokenExpiredAlert: false }], { configured: false });
  assert.match(html('sel:#cards-rigs'), /还没贴 token/);

  sandbox.renderCardRigs([{ ...RIG_BACKUP, tokenExpiredAlert: false }], null);
  const unknown = html('sel:#cards-rigs');
  assert.match(unknown, /状态读取失败/);
  assert.doesNotMatch(unknown, /有效(?!性)/);
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

/* ===== D-280 ②④⑧（第二轮）===== */

test('④ 尾号必须是进流水的入口（data-card），不能再被重做掉一次', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderStockCards([CARD_READY], { due: [], notYetDue: [] });
  const out = html('sel:#stock-cards');
  // 上一轮把表格重做时删掉了 data-card，点击处理器还在、没元素可匹配，入口静默断了。
  assert.match(out, /data-card="h-1"/);
  assert.match(out, /data-card-account="pa-1"/);
});

test('④ 外部卡台记录不给流水入口（它在本地没有卡，点开必 404）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderStockCards([{ ...CARD_READY, externalOnly: true }], { due: [], notYetDue: [] });
  assert.doesNotMatch(html('sel:#stock-cards'), /data-card=/);
});

test('④ 流水类型说人话，且大小写不敏感（生产里 purchase 与 PURCHASE 并存）', () => {
  const { evalIn } = loadAdminJs();
  assert.equal(evalIn("cardTxTypeLabel('PURCHASE')"), '消费');
  assert.equal(evalIn("cardTxTypeLabel('purchase')"), '消费');
  assert.equal(evalIn("cardTxTypeLabel('chargeback')"), '拒付');
  assert.equal(evalIn("cardTxTypeLabel('NORMAL_CANCEL_RETURN')"), '回笼');
  assert.equal(evalIn("cardTxTypeLabel('CARD_ISSUE_FEE')"), '开卡费');
  // 认不出的原样显示，不编一个好听的
  assert.equal(evalIn("cardTxTypeLabel('SOMETHING_NEW')"), 'SOMETHING_NEW');
});

test('highvcc 钱包不得随页面加载自动查（Lemon 2026-09-20 定：全部按需）', () => {
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const start = src.indexOf('async function loadHighvccStatus(');
  assert.ok(start > 0, 'loadHighvccStatus 必须存在');
  const body = src.slice(start, src.indexOf('\n}', start));
  // loadStock 无条件调 loadHighvccStatus；它里面一旦直接查 wallet，就等于「打开卡片页即打外网」。
  assert.doesNotMatch(body, /highvcc\/wallet/,
    'loadHighvccStatus 不得直接查钱包——余额只在点按钮或展开开卡区时查');

  // 同一条规矩在 loadStock 自己身上也要成立：B2 之后它会预取 token 状态，
  // 顺手把钱包也取了就是一行的事，所以这里钉死。
  const stockStart = src.indexOf('async function loadStock()');
  const stockBody = src.slice(stockStart, src.indexOf('\n}', stockStart));
  assert.doesNotMatch(stockBody, /highvcc\/wallet/, 'loadStock 不得查钱包');
  // 而 token 状态只许取一次：B2 让台账栏也要用它，取两次就是同一个端点打两遍。
  assert.equal((stockBody.match(/highvcc\/status/g) || []).length, 1,
    'token 状态在 loadStock 里只许取一次，取到的那份传给 loadHighvccStatus 复用');
});

test('② 两台都有「开卡…」；「同步这台」只有 highvcc 有，且开卡只是展开既有折叠区', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([RIG_HNSKJ, RIG_BACKUP]);
  const out = html('sel:#cards-rigs');
  assert.match(out, /data-rig-open="hnskj"/);
  assert.match(out, /data-rig-open="manual_excel"/);
  // D-309：两台的「刷新这台」做的根本不是一回事 —— hnskj 那个刷的是**卡段规则**
  // （开卡块里已有同端点的「刷新卡段规则」，重复且名不副实），跟这一栏四个数几乎无关；
  // 而且 hnskj 的卡每 15 秒自动同步一次，不需要手动催。只留 highvcc 那个。
  assert.doesNotMatch(out, /data-rig-refresh="hnskj"/);
  assert.match(out, /data-rig-refresh="manual_excel"/);
  assert.match(out, /同步这台/);
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  // 开卡按钮只许展开/滚动到既有折叠区，绝不能自己发起开卡请求
  const handler = src.slice(src.indexOf("closest('[data-rig-open]')"), src.indexOf("closest('[data-rig-refresh]')"));
  assert.doesNotMatch(handler, /card-stock\/jobs|highvcc\/open/,
    '「开卡…」不得自己发起开卡请求，只负责展开既有开卡区');
});

test('⑧ 导入并进「接入新卡台」（D-309），折叠且能力保留', () => {
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
  // D-309：导入和「新增备用卡台」并成一件事 —— 接入没有 API 的卡台本来就是
  // 「先建卡台、再传它的导出表」一条链，分两块做这件事要跳两个地方。
  assert.match(html, /<details[^>]*id="card-source-intake"/, '必须是 details（默认折叠）');
  const block = html.slice(html.indexOf('id="card-source-intake"'));
  const body = block.slice(0, block.indexOf('</details>'));
  assert.match(body, /接入新卡台/);
  // 两样能力都还在，且建台在前、传表在后（顺序就是操作顺序）
  assert.ok(body.indexOf('manual-card-source-form') < body.indexOf('manual-card-import-form'),
    '先建卡台、再导入表格——顺序反了就不是一条链了');
  assert.match(body, /manual-card-import-file/);
});

/* ===== D-280 ⑦：卡台切换搬到工作台，「同时接管」这半边不能丢 ===== */

const DECISIONS_OVERVIEW = { decisions: {}, providerHealth: { rechargeMethod: 'BROWSER' } };
const CARD_SOURCES = {
  browserProviderAccountId: 'pa-1', browserSelectionVersion: 3,
  sources: [
    { id: 'pa-1', displayName: 'HNSKJ', supportsBrowserRecharge: true, operationalEnabled: true },
    { id: 'pa-3', displayName: 'highvcc', supportsBrowserRecharge: true, operationalEnabled: true }
  ]
};

test('⑦ 有排队单时，工作台给出「同时接管 N 单」的勾选', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderDecisions(DECISIONS_OVERVIEW, CARD_SOURCES, { count: 4 });
  const out = html('wb-routes');
  assert.match(out, /id="decision-card-source-takeover"/);
  assert.match(out, /同时接管 4 张排队单/);
});

test('⑦ 没有排队单时不给勾选，也不占一行说明（界面不做旁白）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderDecisions(DECISIONS_OVERVIEW, CARD_SOURCES, { count: 0 });
  const out = html('wb-routes');
  assert.doesNotMatch(out, /decision-card-source-takeover/);
  assert.doesNotMatch(out, /可接管/, '没有可接管的单时不该占一行说明');
});

test('⑦ 待接管单数读取失败时说读取失败，不静默当成 0', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderDecisions(DECISIONS_OVERVIEW, CARD_SOURCES, { __error: true });
  const out = html('wb-routes');
  // 吞成 0 会让这个选项在卡台断供那天悄悄消失
  assert.match(out, /待接管单数读取失败/);
  assert.doesNotMatch(out, /decision-card-source-takeover/);
});

// ---- D-401：API 路线也能切卡台；下拉框跟着当前路线走，API 按钮带点数 ----
const API_OVERVIEW = { decisions: {}, providerHealth: { rechargeMethod: 'API', zzshuPoints: { points: 12, observedAt: '2026-09-27T03:00:00.000Z' } } };
const API_CARD_SOURCES = {
  apiProviderAccountId: 'pa-3', apiSelectionVersion: 2, apiSelectionLocked: false,
  browserProviderAccountId: 'pa-1', browserSelectionVersion: 3,
  sources: [
    { id: 'pa-1', displayName: 'HNSKJ', supportsApiRecharge: false, supportsBrowserRecharge: true, operationalEnabled: true },
    { id: 'pa-3', displayName: 'highvcc', supportsApiRecharge: true, supportsBrowserRecharge: true, operationalEnabled: true }
  ]
};

test('D-401 走 API 时：标签是 API，只列能做 API 直充的卡台，选中 API 行的卡台；按钮不再带点数（D-405 第二批挪进「卡与钱」）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderDecisions(API_OVERVIEW, API_CARD_SOURCES, { count: 0 });
  const out = html('wb-routes');
  assert.match(out, /<span class="wb-k">API<\/span>/);
  assert.match(out, /aria-label="API 卡台"/);
  assert.match(out, /<option value="pa-3" selected>highvcc<\/option>/);
  assert.doesNotMatch(out, /value="pa-1"/, '不支持 API 直充的卡台不该出现在 API 行的候选里');
  assert.match(out, /class="is-on" disabled>API 充值</);
  assert.doesNotMatch(out, /点</, 'Lemon 2026-09-27：点数挂在按钮上太丑');
});

test('D-401 走 Browser 时照旧：标签是浏览器，候选按 Browser 能力；没读到点数就不显示', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderDecisions({ decisions: {}, providerHealth: { rechargeMethod: 'BROWSER', zzshuPoints: { points: null } } }, API_CARD_SOURCES, { count: 0 });
  const out = html('wb-routes');
  assert.match(out, /<span class="wb-k">浏览器<\/span>/);
  assert.match(out, /<option value="pa-1" selected>HNSKJ<\/option>/);
  assert.match(out, /data-method="API">API 充值</);
});

test('D-405 第二批 / D-414 补记五：点数在「卡与钱」脚注；≤5 标黄、0 标红，同推送门槛；超过 999 写 999+；没读到不显示', () => {
  const { sandbox } = loadAdminJs();
  const row = (points, observedAt = null) => sandbox.zzshuPointsRow({ points, observedAt });
  assert.equal(row(15), '<span class="cm-zz">直充平台 剩 <b>15</b> 点</span>');
  assert.match(row(5), /<span class="cm-zz is-warn">直充平台 剩 <b>5<\/b> 点/);
  assert.match(row(0), /<span class="cm-zz is-danger">直充平台 剩 <b>0<\/b> 点/);
  assert.match(row(1000), /剩 <b>999\+<\/b> 点/);
  assert.match(row(99990), /剩 <b>999\+<\/b> 点/);
  assert.match(row(12, '2026-09-27T03:00:00.000Z'), /剩 <b>12<\/b> 点 · (查询于|上次查询) /);
  assert.equal(row(null), '', '没读到不显示，不写 0');
  assert.equal(sandbox.zzshuPointsRow(undefined), '');
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(src, /<p class="cm-foot">\$\{zzshuPointsRow\(overview\.providerHealth\?\.zzshuPoints\)\}/, '挂在「卡与钱」脚注里');
});

test('D-401 API 行仍被固定（locked）时，下拉框与切换按钮都不可点', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderDecisions(API_OVERVIEW, { ...API_CARD_SOURCES, apiSelectionLocked: true }, { count: 0 });
  const out = html('wb-routes');
  assert.match(out, /<select class="wb-field" id="decision-card-source" aria-label="API 卡台" disabled>/);
  assert.match(out, /id="decision-card-source-apply" disabled>切换/);
});

test('D-401 切卡台按当前行走对应端点与版本；加载时按当前路线挑对应的接管单数', () => {
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const apply = src.slice(src.indexOf('async function applyBrowserCardSource('), src.indexOf('// 营业条 toggle'));
  assert.match(apply, /card-sources\/\$\{kind === 'API' \? 'api' : 'browser'\}\/current/);
  assert.match(apply, /expectedVersion: state\.cardSourceVersion/);
  assert.doesNotMatch(apply, /state\.browserSelectionVersion/, '版本要取当前行的，不再写死 Browser 行');
  const load = src.slice(src.indexOf('async function loadOverview('), src.indexOf('renderWbWall(overview);'));
  assert.match(load, /card-sources\/api\/takeover-estimate/);
  assert.match(load, /activeMethod === 'API' \? apiTakeoverEstimate : browserTakeoverEstimate/);
});

test('⑦ 卡台切换只剩工作台一个入口；卡片页那张表已只读', () => {
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // 同一个写操作不留两个入口（F-65 那类毛病的根）
  assert.doesNotMatch(code, /route-switch-button/);
  assert.match(code, /async function applyBrowserCardSource\(/);
  // D-309：卡片页那张「卡台管理」表整个删了 —— 四列里能力是静态配置、Browser 操作
  // 只是一句指路，有用的「告知状态」和「快照时间」已并进台账栏（providerHealthIssue）。
  assert.doesNotMatch(code, /provider-routes-table/, '那张表已删，不许回来');
  assert.match(code, /function providerHealthIssue\(/, '卡台健康改在台账栏上报');
  // 指路仍然要有，只是搬到「接入新卡台」那块的说明里
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
  assert.match(html, /在工作台的工具栏里切/);
});

test('后台的关键顶层事件绑定必须都在（2026-09-20 误删事故的守门人）', () => {
  // 那次删一个函数时用「下一个 async function」当边界，把夹在中间的 14 个顶层绑定
  // 一起切掉了：侧边栏导航点不动、订单筛选分页失灵、导出和对账表全哑。
  // node --check 只查语法，其余测试走 snippet/harness 不碰这些绑定 —— 951 条全绿，
  // 而后台已经不能用了。这条按「绑定是否存在」把它们钉住。
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  // 订单页 v3（D-357）：订单筛选与翻页归 orders.js，绑定也在那里钉住。
  const ordersSrc = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'orders.js'), 'utf8');
  const requiredOrders = [
    ['订单筛选提交', /el\('od-filters'\)\.addEventListener\('submit'/],
    ['订单上一页', /el\('od-prev'\)\.addEventListener\('click'/],
    ['订单下一页', /el\('od-next'\)\.addEventListener\('click'/],
    ['订单页点击委托（邮箱/卡尾号/展开/动作）', /root\.addEventListener\('click'/]
  ];
  const missingOrders = requiredOrders.filter(([, re]) => !re.test(ordersSrc)).map(([name]) => name);
  assert.deepEqual(missingOrders, [], `orders.js 里这些绑定不见了：${missingOrders.join('、')}`);
  const required = [
    ['侧边栏导航', /elements\.navItems\.forEach\(\(item\) => item\.addEventListener\('click'/],
    ['全局搜索', /#wb-search-input'\)\?\.addEventListener\('keydown'/],
    ['document 级委托', /^document\.addEventListener\('click'/m],
    ['订单导出', /#export-orders'\)\?\.addEventListener\('click'/],
    ['对账筛选', /#reconciliation-filters'\)\?\.addEventListener\('submit'/],
    ['对账表', /elements\.reconciliationTable\?\.addEventListener\('click'/]
  ];
  const missing = required.filter(([, re]) => !re.test(src)).map(([name]) => name);
  assert.deepEqual(missing, [], `这些顶层事件绑定不见了，后台对应功能会静默失灵：${missing.join('、')}`);
});

test('卡台显示名只有一份来源：前端不得自己拼名字（2026-09-20 一致性摸排第 5 条）', () => {
  // 摸排前同一台卡台有三个叫法：工作台「HNSKJ」、卡片页「HNSKJ 卡台」、设置页又自己拼一次。
  // Lemon 定统一用简称 HNSKJ / highvcc，来源是 src/domain/provider-labels.js。
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // 前端不得出现「按 providerKind 三元拼名」这种第二份定义
  assert.doesNotMatch(code, /providerKind\s*===\s*'hnskj'\s*\?\s*'/,
    '显示名要用后端给的 label，不要在页面里按 providerKind 拼');
  assert.doesNotMatch(code, /'HNSKJ 卡台'|'highvcc卡台'/, '旧的全称写法已废弃');

  const labels = fs.readFileSync(path.join(here, '..', 'src', 'domain', 'provider-labels.js'), 'utf8');
  assert.match(labels, /hnskj:\s*'HNSKJ'/);
  assert.match(labels, /manual_excel:\s*'highvcc'/);
});

test('卡片页标题不再提「补钱」——补余额区块已随 D-280 ⑦ 退休', () => {
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
  assert.doesNotMatch(src, /库存、卡台、导入、补钱/);
  assert.doesNotMatch(html, /库存、卡台、导入、补钱/);
});

/* ===== B 部分：删块 2、收高级区、撤销路径（B1 / B3 / B4） ===== */

test('B1：开卡被禁时逐条说为什么，不只是把按钮变灰', () => {
  const { evalIn, html } = loadAdminJs();
  // state 是顶层 const，不挂在 sandbox 上，只能在脚本作用域里赋值（见 harness 注释）
  const render = (provider, catalog) => evalIn(
    `state.stockProvider = ${JSON.stringify(provider)};`
    + `state.stockCatalog = ${JSON.stringify(catalog)};`
    + 'renderStockOpenGate();');

  // 块 2 删掉前，这几句话只在「卡片概况」那一格里；删掉后 updateStockEstimate() 就只剩
  // 把提交按钮置灰、把费用框变黄，一个字都不说为什么 —— 和 F-65「生产开着而界面上
  // 关不掉」同型。这条钉住：每一条阻断原因都要落到页面上。
  render({ syncedAt: '2026-09-20T00:00:00.000Z', rulesFresh: false, purchaseEnabled: false,
    cardLimit: { remaining: 7 }, selectedCardType: { name: '卡段 A' } },
  { fresh: false, openingBlocked: true, syncedAt: '2026-09-20T00:00:00.000Z' });
  const blocked = html('sel:#stock-open-gate');
  assert.match(blocked, /卡台规则已过期，禁止开卡/);
  assert.match(blocked, /卡台当前禁止开卡/);
  assert.match(blocked, /卡片对账已过期/);
  assert.match(blocked, /对账未完成，禁止新开卡/);

  // 没有阻断时报的是「还能开几张」，不写「一切正常」——那是结论不是观察。
  render({ syncedAt: '2026-09-20T00:00:00.000Z', rulesFresh: true, purchaseEnabled: true,
    cardLimit: { remaining: 7 }, selectedCardType: { name: '卡段 A' } },
  { fresh: true, openingBlocked: false, syncedAt: '2026-09-20T00:00:00.000Z' });
  const ok = html('sel:#stock-open-gate');
  assert.match(ok, /剩余开卡额度 7/);
  assert.doesNotMatch(ok, /禁止/);

  // 连卡台规则都没取到时，说的是「禁止开卡」，不是一个空格子
  render(null, {});
  assert.match(html('sel:#stock-open-gate'), /尚未取得卡台规则，禁止开卡/);
});

test('B3：历史里两种撤销各归各的，不混成一个按钮', () => {
  const { sandbox, html } = loadAdminJs();
  // 「我已在卡台删掉」的结果：inventory_status 真的变 RETIRED
  const retiredCard = { ...CARD_READY, providerCardId: 'h-7', externalCardId: 'h-7', last4: '7726',
    category: 'RETIRED', inventoryStatus: 'RETIRED', allocationPolicy: 'RETIRED' };
  // 「我手动用了」的结果：只有 override 是 RETIRED，卡本身没动
  const manualUsed = { ...CARD_READY, providerCardId: 'h-8', externalCardId: 'h-8', last4: '5590',
    category: 'RETIRED', inventoryStatus: 'AVAILABLE', allocationPolicy: 'RETIRED' };
  sandbox.renderStockCards([retiredCard, manualUsed], { due: [], notYetDue: [] });
  const history = html('sel:#stock-cards-history');

  assert.match(history, /data-undo-retire="1"[\s\S]*?data-last4="7726"/);
  assert.match(history, /data-undo-manual-use="1"[\s\S]*?data-last4="5590"/);
  // 撤销退役要走 card-retirement/undo，撤销登记要删 override —— 两个不同的动作，
  // 给错按钮就等于用错端点。
  assert.equal((history.match(/data-undo-retire="1"/g) || []).length, 1);
  assert.equal((history.match(/data-undo-manual-use="1"/g) || []).length, 1);

  // 在役的卡给的是「我手动用了」，不是撤销
  const active = html('sel:#stock-cards');
  assert.doesNotMatch(active, /data-undo-retire|data-undo-manual-use/);
});

test('B3：登记退役不再要确认词，但仍必须带 last4 定位到卡', () => {
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const start = src.indexOf("closest('[data-retire-confirm]')");
  const handler = src.slice(start, src.indexOf('\n});', start));
  // D-301：确认词不留。手打一次就会被复制粘贴，挡不住误点。
  assert.doesNotMatch(handler, /confirmation/, '确认词已按 D-301 去掉');
  assert.doesNotMatch(handler, /ask-confirmation|name: 'confirmation'/);
  // last4 是定位用的，不是闸门，得留着
  assert.match(handler, /\\d\{4\}/);
  assert.match(handler, /last4/);
  // 去确认词的前提是有回头路，提示里必须说出来
  assert.match(handler, /撤销/);
});

test('B3：撤销必须填理由——没有理由的撤销在审计里等于没发生过', () => {
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const start = src.indexOf("closest('[data-undo-manual-use]')");
  const block = src.slice(start, src.indexOf('/* =====', start));
  assert.match(block, /name: 'reason', label: '为什么撤销（必填，会进审计）', required: true/);
  assert.equal((block.match(/required: true/g) || []).length, 2, '两种撤销都要必填理由');
  assert.match(block, /card-operational-overrides[\s\S]*?method: 'DELETE'/);
  assert.match(block, /card-retirement\/undo/);
});

test('B4/D-309：高级区 4 件，合并都有业务理由，能力一个不少', () => {
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
  const stockView = html.slice(html.indexOf('id="stock-view"'), html.indexOf('id="diagnostics-view"'));
  const advanced = stockView.slice(stockView.indexOf('id="stock-advanced"'));
  // 从 6 件压到 4 件，两处合并各有理由，**不是为了少一个折叠条**（Lemon 2026-09-20：
  // 「不要为了美观而强行合并，如果合并能更稳定和提效，那是可以的」）：
  //   接入新卡台 = 新增卡台 + 导入导出表 —— 一条链（先建台、再传表）
  //   执行记录   = 开卡任务 + 新卡接管 —— 排查「卡怎么没进来」要连着看
  // 两台开卡**不合并**：表单结构差异大（卡段/数量/预估 vs token/拒付统计/报价），
  // 合成一个块内切换要引状态管理、降稳定；而台账栏每台已有「开卡…」直达。
  for (const id of ['hnskj-open-card', 'highvcc-open-card', 'card-source-intake', 'stock-records']) {
    assert.match(advanced, new RegExp(`id="${id}"`), `高级区少了 ${id}`);
  }
  assert.equal((advanced.match(/class="cardadv-item"/g) || []).length, 4);
  // 能力一个都不许丢：合并只是换了摆法
  for (const id of ['manual-card-source-form', 'manual-card-import-form', 'stock-open-form',
    'highvcc-open-form', 'stock-jobs', 'card-intake-list', 'card-source-summary']) {
    assert.match(advanced, new RegExp(`id="${id}"`), `合并时把 ${id} 弄丢了`);
  }
  // 六件都默认折起：展开着就等于没收
  assert.doesNotMatch(advanced, /class="cardadv-item"[^>]*\sopen/);
  // 高级区自己也默认折起
  assert.doesNotMatch(stockView, /id="stock-advanced"[^>]*\sopen/);
});

test('B4：「开卡…」要把外层「高级」一起展开，只开里层等于点了没反应', () => {
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const start = src.indexOf("closest('[data-rig-open]')");
  const handler = src.slice(start, src.indexOf("closest('[data-rig-refresh]')"));
  assert.match(handler, /closest\('details'\)/, '要沿祖先链把每一层 details 都打开');
  assert.match(handler, /node\.open = true/);
});

test('D-307：台账主数用库存口径，分配口径一个字都不上界面', () => {
  const { sandbox, html } = loadAdminJs();

  // 生产那个场景：卡是好的，但在同步窗口外（库存 2 / 可立即绑 0）
  sandbox.renderCardRigs([{ ...RIG_HNSKJ, stockAvailable: 2, bindableNow: 0, stockTarget: 2, readyOrders: 2, walletOrders: null }]);
  const gap = html('sel:#cards-rigs');
  // D-414：主数按钱看——卡上的钱够付几单（后端按库存口径算，分配口径 0 不影响它；措辞 D-414 补记五）
  assert.match(gap, /卡上够付 \/ 钱包够付（Plus）/);
  assert.match(gap, />2 <small>单 \/ —<\/small>/, '主数必须是库存口径算出的 2 单，不是分配口径 0；不能补钱的卡台钱包那格写「—」');
  assert.doesNotMatch(gap, /is-warn/, '库存 2 已达水位 2，不该报库存偏低');

  // 分配口径不上界面（Lemon 2026-09-20 定）：它是个会自己恢复的瞬时值，客户下单
  // 分不到卡时系统会自动排一次按需同步再重试，运营不需要为它操心。第一版在这里挂了
  // 一句「此刻可立即绑 N 张，其余在等下一次同步（会自行恢复）」——那句话在说一件
  // 运营做不了也不用做的事，摆出来只会让人以为卡出了事。
  assert.doesNotMatch(gap, /此刻可立即绑|会自行恢复|等下一次同步/);

  // 库存真的低于水位才报警（这才是「卡不够了」）
  sandbox.renderCardRigs([{ ...RIG_HNSKJ, stockAvailable: 1, bindableNow: 1, stockTarget: 2 }]);
  assert.match(html('sel:#cards-rigs'), /is-warn/);
});

test('术语一致：同一个状态在一页上只能有一个叫法', () => {
  const { evalIn } = loadAdminJs();
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');

  // READY 这个状态，运营会在三处看到它：台账栏那格、卡片列表的徽标、点开卡片的详情抽屉。
  // 2026-09-20 实测三处两个叫法——徽标写「待分配」，另两处写「可分配」，
  // 而徽标恰恰是天天看的那个。两个叫法逼运营自己猜它们是不是一回事。
  assert.equal(evalIn('CARD_STATE_CHIPS.READY[1]'), '可分配');
  assert.equal(evalIn('INVENTORY_LABELS.AVAILABLE'), '可分配');

  // 台账栏那格的标题由 admin.js 渲染，不在 index.html 里
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(src, /rigCell\('卡上够付 \/ 钱包够付（Plus）'/);
  // 页面上的说明也得用同一个词，否则解释的是另一件事（D-414 补记五：格子写「卡上够付 / 钱包够付」，说明就解释「卡上」「钱包」）
  assert.match(html, /“卡上”＝/);
  assert.match(html, /“钱包”＝/);
  assert.match(html, /<h2>现在还能付几单<\/h2>/);

  // 已经删掉的孤儿常量不许回来——它定义了第三份同义标签，零引用
  assert.doesNotMatch(src, /STOCK_CATEGORY_LABELS/);
});

/* ===== 停用这张卡：理由决定下一步（D-311）===== */

test('「停用这张卡」的理由是选项，且原因码写进 reason 的最前面', () => {
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const start = src.indexOf("closest('[data-manual-use]')");
  const handler = src.slice(start, src.indexOf('\n});', start));

  // 生产现有的 override 正好是三类（手动挪用 / 卡台作废 / 运营主动取消），
  // 当初全塞在自由文本里（highvcc-manual-used / highvcc-cancelled / hnskj-voided），
  // 事后只能靠读字符串区分。改成选项。
  assert.match(handler, /type: 'select'/);
  for (const code of ['MANUAL_USED', 'PROVIDER_VOIDED', 'CARD_FAULTY', 'OPERATOR_CANCELLED', 'OTHER']) {
    assert.ok(handler.includes(code), `少了停用原因 ${code}`);
  }
  // D-405 第二批（Lemon：原因啰嗦，尽量简单）：选项改短；说明改选填，只有选「其他」时必填 ——
  // 其余四个原因码本身已说清接下来做什么，「其他」没有，得写。
  for (const label of ['手动用掉了', '卡台已作废', '卡有问题', '已在卡台取消', "'其他'"]) assert.ok(handler.includes(label), label);
  assert.doesNotMatch(handler, /我拿它手动充值了|（在下面写清楚）|必填，会进审计/);
  assert.match(handler, /name: 'note'[^}]*hint: '选填'[\s\S]{0,120}requiredWhen: \{ field: 'cause', value: 'OTHER'/);
  assert.doesNotMatch(handler, /name: 'note'[^\n]*required: true/);
  // 原因码必须在 reason 最前面（冒号结尾），待销清单靠它认；没写备注时也保留冒号
  assert.match(handler, /reason: answer\.note \? `\$\{answer\.cause\}: \$\{answer\.note\}` : `\$\{answer\.cause\}:`/);
  // 通用弹窗认 requiredWhen：提交时按当前选择判断必填，切换选择时同步 required 与提示字
  const ask = src.slice(src.indexOf('function askForm'), src.indexOf('async function controlBrowserRun'));
  assert.match(ask, /const isRequired = \(field, form\) => Boolean\(field\.required \|\| \(field\.requiredWhen && form/);
  assert.match(ask, /if \(isRequired\(field, form\) && !value\)/);
  assert.match(ask, /form\.addEventListener\('change', syncConditional\)/);
});

test('原因决定「接下来去卡台做什么」，认不出的不猜', () => {
  const { evalIn } = loadAdminJs();
  // 卡台自己作废的不用再去删；自己挪用或卡有问题的要去删 —— 动作不同
  assert.match(evalIn("stopCauseOf('PROVIDER_VOIDED: 后台显示已作废').next"), /已经没了/);
  assert.match(evalIn("stopCauseOf('MANUAL_USED: 给客户手动充了 20X').next"), /去卡台把它删掉/);
  assert.equal(evalIn("stopCauseOf('MANUAL_USED: x').label"), '手动充值用掉了');
  assert.equal(evalIn("stopCauseOf('MANUAL_USED:').label"), '手动充值用掉了', '没写备注时只有原因码加冒号，也要认得出');
  // 旧数据（本轮之前写的 override）没有原因码前缀 —— 返回 null，按普通停用显示，不猜
  assert.equal(evalIn("stopCauseOf('Lemon paid a customer 20X manually with this card')"), null);
  assert.equal(evalIn("stopCauseOf(null)"), null);
  assert.equal(evalIn("stopCauseOf('NOT_A_CODE: x')"), null);
});

test('待销清单把「运营已标永久停用」换成具体原因 + 下一步；认不出就照旧', () => {
  const { sandbox, html } = loadAdminJs();
  const base = { providerAccountId: 'pa-1', providerCode: 'hnskj', currentBalance: '0.35',
    due: true, dueAt: '2026-09-19T00:00:00.000Z', reasonLabels: ['运营已标永久停用'] };
  sandbox.renderCardRetirement({ minAgeHours: 6, notYetDue: [], recentlyConfirmed: [], due: [
    { ...base, cardId: 'c1', last4: '1111', retiredOverrideReason: 'PROVIDER_VOIDED: 卡台作废' },
    { ...base, cardId: 'c2', last4: '2222', retiredOverrideReason: 'MANUAL_USED: 手动充了' },
    { ...base, cardId: 'c3', last4: '3333', retiredOverrideReason: 'Lemon cancelled the card on highvcc' }
  ] });
  const out = html('sel:#card-retirement-list');
  assert.match(out, /卡台已禁用\/作废[\s\S]*?卡台那边已经没了/);
  assert.match(out, /手动充值用掉了[\s\S]*?去卡台把它删掉/);
  // 认不出原因码的旧数据：保留原来那句，且**不许**编一个下一步出来
  assert.match(out, /运营已标永久停用/);
  const legacyRow = out.slice(out.indexOf('3333'));
  assert.doesNotMatch(legacyRow.slice(0, legacyRow.indexOf('</tr>')), /去卡台把它删掉|已经没了/);
});

// ——— D-405 第一批（Lemon 2026-09-28 看过演示 v3）———
test('D-405 待销清单：「卡台上」一列按后端 platform 显示；卡台已作废 / 已不见给「登记已销」；已到期是小标签不是整行黄底', () => {
  const { sandbox, html } = loadAdminJs();
  const due = (cardId, last4, platform) => ({ cardId, last4, providerCode: 'manual_excel', reasonLabels: ['用满 3 次'],
    currentBalance: '1.00', due: true, dueAt: '2026-09-19T00:00:00.000Z', platform });
  sandbox.renderCardRetirement({ minAgeHours: 6, recentlyConfirmed: [], notYetDue: [], due: [
    due('c1', '1657', { state: 'THERE', syncedAt: '2026-09-27T13:45:00.000Z', note: null }),
    due('c2', '0577', { state: 'VOID', syncedAt: '2026-09-27T10:15:00.000Z', note: null }),
    due('c3', '1111', { state: 'GONE', syncedAt: '2026-09-27T13:45:00.000Z', note: null }),
    due('c4', '2222', { state: 'UNKNOWN', syncedAt: null, note: '卡台登录失效，同步不了' })
  ] });
  const out = html('sel:#card-retirement-list');
  assert.match(out, /<th>卡台上<\/th>/);
  assert.doesNotMatch(out, /<th>可销时间<\/th>/, '可销时间并进小标签');
  assert.match(out, /<col class="rc-why"><col class="rc-bal"><col class="rc-src">/);
  assert.match(out, /src-state is-there[\s\S]{0,80}还在[\s\S]{0,120}核对/);
  assert.match(out, /data-retire-confirm="c1"[^>]*>我已在卡台删掉/);
  assert.match(out, /data-retire-confirm="c2"[^>]*>登记已销/, '卡台已作废不用去删');
  assert.match(out, /data-retire-confirm="c3"[^>]*>登记已销/, '已不见多半已删');
  assert.match(out, /data-retire-confirm="c4"[^>]*>我已在卡台删掉/);
  assert.match(out, /卡台登录失效，同步不了/);
  assert.match(out, /<span class="due-tag">已到期<\/span>/);
});

test('D-405 卡片列表：列宽照演示（用量贴近余额）；可销「已到期」用小标签', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderStockCards([CARD_READY], { due: [{ providerAccountId: 'pa-1', providerCardId: 'h-1', due: true, reasonLabels: ['用满 3 次'] }], notYetDue: [] });
  const out = html('sel:#stock-cards');
  assert.match(out, /<table class="is-fixed"><colgroup><col class="cc-last4"><col class="cc-rig"><col class="cc-bal"><col class="cc-use"><col>/);
  assert.match(out, /<span class="due-tag">已到期<\/span>/);
  const css = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'cards.css'), 'utf8');
  assert.doesNotMatch(css, /tr\.is-due td\{background/, '整行黄底去掉了');
  assert.match(css, /col\.cc-use\{width:100px\}/);
  assert.match(css, /col\.rc-bal\{width:150px\}/);
});


// D-405 第二批：订单页「提交时间」后加「结束时间」
test('D-405 订单页「结束时间」：结束的单写北京时间，处理中写「—」，已结束但没记时间的老单写「—」并说明', async () => {
  const { sandbox, evalIn, html } = loadAdminJs();
  sandbox.__ordersApi = async () => ({ total: 3, summary: { buckets: {} }, orders: [
    { publicNo: 'PJV1-done', status: 'RECHARGE_SUCCESS', planType: 'plus', customerEmail: 'a@example.com',
      createdAt: '2026-09-27T17:12:00.000Z', finishedAt: '2026-09-27T17:13:30.000Z', stage: { label: '已成功', tone: 'green' } },
    { publicNo: 'PJV1-run', status: 'RECHARGE_PROCESSING', planType: 'plus', customerEmail: 'b@example.com',
      createdAt: '2026-09-27T17:40:00.000Z', finishedAt: null, stage: { label: '处理中', tone: 'blue' } },
    { publicNo: 'PJV1-old', status: 'RECHARGE_FAILED', planType: 'plus', customerEmail: 'c@example.com',
      createdAt: '2026-09-13T08:01:00.000Z', finishedAt: null, stage: { label: '失败', tone: 'red' } }
  ] });
  const page = evalIn('window.createOrdersPage({ api: globalThis.__ordersApi, escapeHtml, showNotice: () => {}, openOrder: () => {}, actions: {} })');
  await page.load();
  const rows = html('od-rows').split('<tr class="od-mainrow"').slice(1);
  assert.equal(rows.length, 3);
  const cells = (row) => [...row.matchAll(/<td class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => [m[1], m[2]]);
  const done = cells(rows[0]);
  assert.deepEqual(done.map(([cls]) => cls), ['od-cust', 'od-plan', 'od-route', 'od-time', 'od-time', 'od-stagecell'], '六格，结束时间紧跟提交时间');
  assert.equal(done[3][1], '09-28 01:12');
  assert.equal(done[4][1], '09-28 01:13', '北京时间');
  assert.deepEqual(cells(rows[1])[4], ['od-time is-none', '—']);
  assert.doesNotMatch(rows[1], /没记结束时间/, '处理中的单不是「没记」');
  assert.match(rows[2], /<td class="od-time is-none" title="这张老单当时没记结束时间">—<\/td>/);
});

test('D-414：台账第一格按钱看——卡上够付几单 / 钱包够付几单（能补钱的卡台才有后一个数）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([{ ...RIG_HNSKJ, stockAvailable: 1, readyOrders: 1, walletOrders: 1, stockTarget: 1 }]);
  assert.match(html('sel:#cards-rigs'), />1 <small>单 \/ 1 单<\/small>/);
  sandbox.renderCardRigs([{ ...RIG_HNSKJ, stockAvailable: 0, readyOrders: 0, walletOrders: 0, stockTarget: 1 }]);
  assert.match(html('sel:#cards-rigs'), />0 <small>单 \/ 0 单<\/small>/);
  assert.match(html('sel:#cards-rigs'), /is-warn/);
});

// D-414 补记五：卡与钱＝丁「一台一行」（Lemon 2026-10-01 挑定）。
const WB_HV = (plus = {}, extra = {}) => ({ providerAccountId: 'pa-3', providerCode: 'backup-a', providerKind: 'manual_excel', label: 'highvcc',
  supplyFaultState: 'OK', spentToday: '0.500000', spentCurrency: 'USD',
  byProduct: [{ productCode: 'plus', label: 'Plus', readyOrders: 1, walletOrders: 0, autoReplenished: true, ...plus },
    { productCode: 'pro_5x', label: '5X', readyOrders: 0, walletOrders: null, autoReplenished: false },
    { productCode: 'pro_20x', label: '20X', readyOrders: 2, walletOrders: null, autoReplenished: false }], ...extra });
const WB_HN = (extra = {}) => ({ providerAccountId: 'pa-1', providerCode: 'legacy-primary', providerKind: 'hnskj', label: 'HNSKJ',
  supplyFaultState: 'OK', spentToday: '0',
  byProduct: [{ productCode: 'plus', label: 'Plus', readyOrders: 2, walletOrders: null, autoReplenished: true },
    { productCode: 'pro_5x', label: '5X', readyOrders: 1, walletOrders: null }, { productCode: 'pro_20x', label: '20X', readyOrders: 0, walletOrders: null }], ...extra });

test('D-414 补记五：标题行「Plus 还能接 N 单」＝各台卡上够付 + 钱包够付之和；每台一行；5X / 20X 进脚注；不再写「自动补 / 需人工开」', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbCards({ cardStockByProvider: [WB_HN(), WB_HV({ walletOrders: 1 })], decisions: { cardAutoReplenishmentEnabled: true } });
  assert.equal(html('wb-cards-title'), 'Plus 还能接 <span class="cm-n">4</span> 单', 'HNSKJ 卡上 2 + highvcc 卡上 1 + 钱包 1');
  const out = html('wb-cards');
  assert.equal((out.match(/class="cm-row"/g) || []).length, 2, '每台一行');
  assert.match(out, /<b>highvcc<\/b><\/span>\s*<span class="cm-nums">卡上够付 <span class="cm-num">1<\/span> <span class="cm-unit">单<\/span> · 钱包够付 <span class="cm-num">1<\/span>/);
  assert.match(out, /<b>HNSKJ<\/b><\/span>\s*<span class="cm-nums">卡上够付 <span class="cm-num">2<\/span> <span class="cm-unit">单<\/span> · 钱包够付 <span class="cm-num is-dim">—<\/span>/, '不能补钱的卡台写「—」，不写 0');
  assert.match(out, /<span>5X 卡上够付 <b>1<\/b> 单 · 20X 卡上够付 <b>2<\/b> 单<\/span>/, '两台相加');
  assert.match(out, /data-hnskj-wallet-refresh>刷新<\/button>/);
  assert.match(out, /data-highvcc-refresh>刷新<\/button><button type="button" class="wb-btn out sm" data-highvcc-login-check>更新登录<\/button>/, '只有 highvcc 有「更新登录」');
  assert.match(out, /今天 没花钱/);
  assert.match(out, /今天 <span class="wb-mono" title="[^"]*">\$0\.50<\/span>/);
  assert.doesNotMatch(out, /自动补|需人工开|现成/);
  assert.equal(html('wb-cards-flags'), '', '没人等卡、能接单、总闸开着：右边什么都不写');
});

test('D-414 补记五：一单都接不了写「再来一单要等卡」；有人等卡写「N 单正在等卡」；总闸关写在标题行右边（后端此时钱包给 null）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderWbCards({ cardStockByProvider: [WB_HV({ readyOrders: 0, walletOrders: 0 })], decisions: { cardAutoReplenishmentEnabled: true } });
  assert.equal(html('wb-cards-title'), 'Plus 还能接 <span class="cm-n">0</span> 单');
  assert.match(html('wb-cards-flags'), /再来一单要等卡/);
  sandbox.renderWbCards({ cardStockByProvider: [WB_HV({ readyOrders: 0, walletOrders: 0 })], ordersWaitingForCard: 2 });
  assert.match(html('wb-cards-flags'), /wb-chip warn[\s\S]*2 单正在等卡/);
  assert.doesNotMatch(html('wb-cards-flags'), /再来一单要等卡/, '有人在等时只说等卡，不重复');
  sandbox.renderWbCards({ cardStockByProvider: [WB_HV({ readyOrders: 1, walletOrders: null })], decisions: { cardAutoReplenishmentEnabled: false } });
  assert.match(html('wb-cards-flags'), /title="不补钱、不开新卡；卡上现成的钱照常能付"><span class="wb-chip warn">[\s\S]*自动开卡总闸关着/);
  assert.match(html('wb-cards'), /钱包够付 <span class="cm-num is-dim">—<\/span>/);
  sandbox.renderWbCards({ cardStockByProvider: [WB_HV()] });
  assert.doesNotMatch(html('wb-cards-flags'), /总闸/, '读不到总闸状态时不猜，按开着算');
});

test('D-414 补记五：出问题只在名字后跟一小段红字；token 失效只认告警且只标用 token 的那台；认识的原因码才翻译', () => {
  const { sandbox, html } = loadAdminJs();
  const fault = (reason) => WB_HN({ supplyFaultState: 'FAULT', supplyFaultReason: reason });
  sandbox.renderWbCards({ cardStockByProvider: [fault('CARD_STOCK_PURCHASE_DISABLED'), WB_HV()] }, { alerts: [{ type: 'PROVIDER_TOKEN_EXPIRED' }] });
  const out = html('wb-cards');
  assert.match(out, /<b>HNSKJ<\/b><span class="cm-st is-danger" title="卡台那边暂停开卡，开不出新卡（CARD_STOCK_PURCHASE_DISABLED）"><span class="wb-d"><\/span>暂停开卡<\/span><\/span>/);
  assert.match(out, /<b>highvcc<\/b><span class="cm-st is-danger" title="补钱、开卡都会失败；去卡片页重新贴 token"><span class="wb-d"><\/span>token 失效<\/span>/);
  assert.equal((out.match(/token 失效/g) || []).length, 1, 'HNSKJ 用 API Key，不标 token');
  sandbox.renderWbCards({ cardStockByProvider: [fault('SOMETHING_NEW')] });
  assert.match(html('wb-cards'), /title="开不出新卡（SOMETHING_NEW）"><span class="wb-d"><\/span>供卡故障</, '不认识的原因码不编，原码放悬停');
  for (const alertData of [null, { alerts: [], __error: true }, { alerts: [{ type: 'CARD_STOCK_LOW' }] }]) {
    sandbox.renderWbCards({ cardStockByProvider: [WB_HV()] }, alertData);
    assert.doesNotMatch(html('wb-cards'), /token 失效/, '没有 token 告警（或告警没读到）就不说失效');
  }
});

test('D-414 补记五：钱包写「$24.35 08:43」；刷新失败写「上次 … · 刷新失败」并标黄；从没查到写清楚，不写 $0', () => {
  const { sandbox } = loadAdminJs();
  const part = () => ({ textContent: '' });
  const make = () => { const v = part(); const w = part(); const cls = new Set();
    return { v, w, cls, el: { title: '', querySelector: (s) => (s === '[data-wal-v]' ? v : s === '[data-wal-when]' ? w : null),
      classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } } }; };
  const at = new Date();
  at.setHours(8, 43, 0, 0);
  let x = make();
  sandbox.paintWalletInline(x.el, { balance: '24.350000', at: at.toISOString(), currency: 'USD' }, false);
  assert.equal(x.v.textContent, '$24.35');
  assert.equal(x.w.textContent, '08:43');
  assert.equal(x.cls.has('is-failed'), false);
  assert.match(x.el.title, /^钱包余额 24\.35 USD · 查询于 08:43$/);
  x = make();
  sandbox.paintWalletInline(x.el, { balance: '24.350000', at: at.toISOString(), currency: 'USD' }, true);
  assert.equal(x.w.textContent, '上次 08:43 · 刷新失败');
  assert.equal(x.cls.has('is-failed'), true);
  x = make();
  sandbox.paintWalletInline(x.el, null, false);
  assert.equal(x.v.textContent, '—');
  assert.equal(x.w.textContent, '还没查过');
  sandbox.paintWalletInline(x.el, null, true);
  assert.equal(x.w.textContent, '查询失败，请检查登录');
});

test('D-411：订单抽屉「付款前补钱」按补钱状态说人话，原因码只翻已知的', () => {
  const { evalIn } = loadAdminJs();
  const text = (item) => evalIn(`topUpText(${JSON.stringify(item)})`);
  assert.equal(text({ status: 'CONFIRMED', amount: '16.000000', cardLast4: '8499',
    submittedAt: '2026-09-30T01:00:00.000Z', finishedAt: '2026-09-30T01:00:12.000Z' }), '往卡 8499 补了 $16.00（12 秒到账）');
  assert.equal(text({ status: 'SUBMITTED', amount: '16', cardLast4: '8499' }), '正在往卡 8499 补 $16.00，到账后自动付款');
  assert.equal(text({ status: 'REJECTED', amount: '16', cardLast4: '8499', errorCode: 'WALLET_LOW', orderDetached: true }), '卡 8499 没补成（钱包不够），已换卡');
  assert.equal(text({ status: 'REJECTED', amount: '16', cardLast4: '8499', errorCode: 'SOMETHING_NEW' }), '卡 8499 没补成（钱没动）');
  assert.equal(text({ status: 'UNKNOWN', amount: '16', cardLast4: '8499', orderDetached: true }), '卡 8499 补钱结果不明，已换卡；那张卡锁着等核对');
  assert.equal(evalIn('STATUS_META.CARD_PROVISIONING[0]'), '给卡补钱中');
});
