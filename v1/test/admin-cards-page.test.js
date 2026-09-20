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
  label: 'HNSKJ', total: 14, inStock: 2, plusAssignable: 1, inUse: 0, anyUsed: 0,
  stockTarget: 5, walletBalance: '41.20', walletCurrency: 'USD',
  walletSyncedAt: '2026-09-20T00:59:00.000Z', walletLiveOnly: false, walletFloor: '30.00', walletAlertThreshold: '35.00',
  openedToday: 2, dailyLimit: 3, supplyFaultState: 'OK', supplyFaultReason: null, tokenFault: false
};
const RIG_BACKUP = {
  providerAccountId: 'pa-3', accountCode: 'backup-a', providerKind: 'manual_excel',
  label: 'highvcc', total: 16, inStock: 7, plusAssignable: 1, inUse: 0, anyUsed: 0,
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

test('highvcc 不显示余额数字，只给「查余额」按钮（它没有快照，余额只能实时查）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([RIG_BACKUP]);
  const out = html('sel:#cards-rigs');
  assert.match(out, /data-rig-wallet="backup-a"/);
  assert.match(out, /查余额/);
  // walletBalance 是 null，不能被 formatMoney 成 0.00 顶上去
  assert.doesNotMatch(out, /\$0\.00 <small>\//);
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

test('② 两台都有「开卡…」与「刷新这台」，且开卡只是展开既有折叠区（不另造花钱入口）', () => {
  const { sandbox, html } = loadAdminJs();
  sandbox.renderCardRigs([RIG_HNSKJ, RIG_BACKUP]);
  const out = html('sel:#cards-rigs');
  assert.match(out, /data-rig-open="hnskj"/);
  assert.match(out, /data-rig-open="manual_excel"/);
  assert.match(out, /data-rig-refresh="hnskj"/);
  assert.match(out, /data-rig-refresh="manual_excel"/);
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  // 开卡按钮只许展开/滚动到既有折叠区，绝不能自己发起开卡请求
  const handler = src.slice(src.indexOf("closest('[data-rig-open]')"), src.indexOf("closest('[data-rig-refresh]')"));
  assert.doesNotMatch(handler, /card-stock\/jobs|highvcc\/open/,
    '「开卡…」不得自己发起开卡请求，只负责展开既有开卡区');
});

test('⑧ 导入备用卡降级为折叠的高级入口，能力保留', () => {
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
  const block = html.slice(html.indexOf('id="manual-card-import-card"'));
  assert.match(html, /<details[^>]*id="manual-card-import-card"/, '必须是 details（默认折叠）');
  assert.match(block, /接入无 API 的卡台：上传导出表/);
  // 能力保留：上传表单还在
  assert.match(block.slice(0, block.indexOf('</details>')), /manual-card-import-file/);
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

test('⑦ 卡台切换只剩工作台一个入口；卡片页那张表已只读', () => {
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // 同一个写操作不留两个入口（F-65 那类毛病的根）
  assert.doesNotMatch(code, /route-switch-button/);
  assert.match(code, /async function applyBrowserCardSource\(/);
  // 卡片页那张表的「Browser 操作」列由 admin.js 渲染，只剩一句指路
  assert.match(code, /去工作台切/);
});

test('后台的关键顶层事件绑定必须都在（2026-09-20 误删事故的守门人）', () => {
  // 那次删一个函数时用「下一个 async function」当边界，把夹在中间的 14 个顶层绑定
  // 一起切掉了：侧边栏导航点不动、订单筛选分页失灵、导出和对账表全哑。
  // node --check 只查语法，其余测试走 snippet/harness 不碰这些绑定 —— 951 条全绿，
  // 而后台已经不能用了。这条按「绑定是否存在」把它们钉住。
  const src = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'admin.js'), 'utf8');
  const required = [
    ['侧边栏导航', /elements\.navItems\.forEach\(\(item\) => item\.addEventListener\('click'/],
    ['订单筛选', /elements\.filters\.addEventListener\('submit'/],
    ['订单上一页', /elements\.prevPage\.addEventListener\('click'/],
    ['订单下一页', /elements\.nextPage\.addEventListener\('click'/],
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

test('B4：五条折叠条收进一个「高级」，六件一件不少', () => {
  const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
  const stockView = html.slice(html.indexOf('id="stock-view"'), html.indexOf('id="diagnostics-view"'));
  const advanced = stockView.slice(stockView.indexOf('id="stock-advanced"'));
  for (const id of ['card-source-admin', 'manual-card-import-card', 'hnskj-open-card',
    'highvcc-open-card', 'stock-jobs-card', 'card-intake-card']) {
    assert.match(advanced, new RegExp(`id="${id}"`), `高级区少了 ${id}`);
  }
  assert.equal((advanced.match(/class="cardadv-item"/g) || []).length, 6);
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
