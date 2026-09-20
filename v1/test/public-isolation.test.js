import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public'
);

test('customer assets contain no remote or legacy runtime dependencies', () => {
  const files = [
    path.join(directory, 'index.html'),
    path.join(directory, 'assets', 'customer.css'),
    path.join(directory, 'assets', 'customer.js'),
    path.join(directory, 'assets', 'favicon.svg')
  ];
  const forbidden = [
    'src="http://',
    'src="https://',
    'url(http://',
    'url(https://',
    "fetch('http://",
    "fetch('https://",
    'playwright',
    'puppeteer',
    'stripe',
    'hcaptcha',
    '/api/verify-cdk',
    '/pay'
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${file} contains ${token}`);
    }
  }

  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  // 每一条外链都必须落在 chatgpt.com。断具体清单会随改版失效，而且旧的
  // 正则把带锚点的地址整条漏掉了（成功屏那条 #settings/Subscription 就
  // 在漏网里），所以这里连锚点一起抓，只断域。
  const externalLinks = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(externalLinks.length >= 3, 'the guide and the success screen link out');
  for (const link of externalLinks) {
    assert.equal(new URL(link).origin, 'https://chatgpt.com', `${link} leaves chatgpt.com`);
  }
  assert.match(html, /id="session-guide-open"/);
  assert.match(html, /id="run-sublink"/);
  assert.match(html, /rel="noopener noreferrer"/);
  // 教程示例要让客户认出自己屏幕上的东西，又不能像一份真的凭证：
  // 关键字段在，值一律省略号收尾。
  assert.match(html, /"accessToken":"[^"]*…"/);
  assert.match(html, /"email":"you@example\.com"/);
  // 示例必须画出真实结构：少画一个字段，客户就可能只复制一部分，直到
  // 「核对账号」那一屏才被拦。原型的示例是简化版，照搬会误导。
  for (const field of ['user', 'account', 'accessToken', 'sessionToken', 'expires']) {
    assert.match(html, new RegExp(`"${field}"`), `教程示例缺少 ${field}`);
  }
  assert.doesNotMatch(html, /已由人工接手核对/);

  const customerScript = fs.readFileSync(path.join(directory, 'assets', 'customer.js'), 'utf8');
  assert.match(customerScript, /REVIEWING:[\s\S]{0,180}poll: 30000/);
  assert.match(customerScript, /ACTION_REQUIRED:[\s\S]{0,220}poll: 30000/);
  assert.doesNotMatch(customerScript, /已转入人工核对/);
});

test('admin assets contain no remote, legacy, or secret-bearing dependencies', () => {
  const files = [
    path.join(directory, 'admin', 'index.html'),
    path.join(directory, 'admin', 'login.html'),
    path.join(directory, 'admin', 'assets', 'admin.css'),
    path.join(directory, 'admin', 'assets', 'admin.js'),
    path.join(directory, 'admin', 'assets', 'login.js')
  ];
  const forbidden = [
    'src="http://', 'src="https://', 'href="http://', 'href="https://',
    'url(http://', 'url(https://', 'playwright', 'stripe', 'hcaptcha',
    'session_ciphertext', 'recharge_card_key', 'card_credentials_ciphertext', 'api key', 'cvv',
    'style="'
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${file} contains ${token}`);
    }
  }
});

test('admin batch generation keeps generation and downloads separate and exposes audit history', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(html, />生成 CDK</);
  assert.match(html, /下载本批次 TXT/);
  assert.match(script, /下载原始 TXT/);
  assert.match(script, /下载状态清单 CSV/);
  assert.match(script, /已全部作废/);
  assert.match(script, /禁止把文件中的码重新发放/);
  assert.match(script, /已生成，但列表刷新失败/);
  assert.match(script, /已作废.*但批次列表刷新失败/);
});

test('admin sends sensitive unified search in a protected JSON body, never in the URL', () => {
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(script, /\/api\/v1\/admin\/orders\/search/);
  assert.doesNotMatch(script, /\/api\/v1\/admin\/orders\?[^'"`]*q=/);
  assert.doesNotMatch(script, /URLSearchParams[\s\S]{0,300}\.set\(['"]q['"]/);
});

test('admin refresh feedback and inset dropdown arrows remain visible', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  const styles = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.css'), 'utf8');
  // 缓存版本号：只守真正要守的——三份资源都带版本、JS 版本只能往上走。
  // 写死具体数字会让这条断言每次改版都挂，反过来诱导人去改断言（本文件客户页那条
  // 早就是这么写的，admin 这条一直还写死着）。
  assert.match(html, /admin\.css\?v=\d+/);
  assert.match(html, /workbench\.css\?v=\d+/);
  assert.match(html, /cards\.css\?v=\d+/);
  const adminJsVersion = html.match(/admin\.js\?v=(\d+)/);
  assert.ok(adminJsVersion, 'index.html 必须带 admin.js 的 ?v= 版本');
  assert.ok(Number(adminJsVersion[1]) >= 72, 'admin.js 的版本只能往上走（改了脚本必须 bump）');
  assert.match(script, /button\.textContent = '刷新中…'/);
  assert.match(script, /showNotice\('刷新完成。', 'success'\)/);
  assert.match(script, /showNotice\('刷新失败，请稍后重试。'\)/);
  // 第⑥步工作台重做（D-283）：overview 段改营业条 wb-decisions + 卡与钱「按台按产品」。
  // 原先断言的是「Plus 可分配」那个 chip 文案，2026-09-20 按 D-283 原规划改成
  // 每台一行、行内按产品「用 N / 剩 N」+ 会不会自动补 —— 信息还在，表达变了。
  // 「剩 N」用**库存口径**（stockAvailable），不是分配口径。分配口径多一条「15 分钟内
  // 同步过」，而 hnskj 每 3 小时才同步一次 —— 拿它当「还剩几张」会让好卡看起来不存在
  // （Lemon 2026-09-18 指出、2026-09-20 在页面这一侧查实并修，D-307）。
  assert.match(script, /用 \$\{x\.used\} \/ 剩 \$\{stock\}/);
  assert.match(script, /const stock = Number\(x\.stockAvailable \|\| 0\)/);
  assert.doesNotMatch(script, /剩 \$\{x\.bindableNow\}/, '「还剩几张」不许用分配口径');
  assert.match(script, /byProduct/);
  // 「剩 N」旁边必须标会不会自动补：水位 0 的产品断了只能人工开，
  // 「20X 剩 0」和「Plus 剩 0」严重程度完全不同（Lemon 2026-09-20）
  assert.match(script, /autoReplenished \? '自动补' : '需人工开'/);
  // 有多少人在等卡 —— 库存讲「有多少」，这个讲「有多少人在等」
  assert.match(script, /ordersWaitingForCard/);
  assert.match(script, /wb-decisions/);
  assert.match(html, /id="wb-decisions"/);
  assert.match(html, /需要我处理/);
  assert.match(script, /card-stock\/minimum-balance/);
  // F-16/F-3 close-out for payment-result-unknown runs is reachable from the UI (run panel + order drawer),
  // and the client sends renewalCancelled as a real boolean (F-44).
  assert.match(script, /data-browser-control="RESOLVE_UNKNOWN_PAYMENT">确认核实结果</);
  assert.match(script, /data-order-run-control="RESOLVE_UNKNOWN_PAYMENT">确认核实结果</);
  assert.match(script, /input\.renewalCancelled = answers\.renewalCancelled === 'true'/);
  // B1 删块 2 之后，「最低余额」的唯一入口在设置页（由 admin.js 渲染，不在 index.html）
  assert.match(script, /最低余额 · \$\{escapeHtml\(SETTINGS_PLAN_LABELS\[plan\]\)\}/);
  assert.match(script, /card-intake\/.*\/validate/);
  assert.match(script, /card-intake\/.*\/accept/);
  assert.doesNotMatch(script, /卡台当前 active 卡数/);
  assert.doesNotMatch(script, /卡台历史总卡数/);
  // 运营状态必须是人话，不是英文枚举。原来这条靠一个跨行正则去撞 STOCK_CATEGORY_LABELS
  // （那是个零引用的孤儿常量，已删）—— 撞常量太脆，而且它撞的不是运营真正看到的那张表。
  // 改成直接钉真正渲染到徽标上的 CARD_STATE_CHIPS：五个状态全中文，且与详情抽屉
  // 用的 INVENTORY_LABELS 同名状态必须**同词**（2026-09-20 实测 READY 和 RETIRED 各有两个叫法）。
  const chips = script.match(/const CARD_STATE_CHIPS = Object\.freeze\(\{[\s\S]*?\}\);/)[0];
  for (const word of ['可分配', '使用中', '永久停用', '限定产品', '暂不可用']) {
    assert.ok(chips.includes(word), `卡片状态徽标少了「${word}」`);
  }
  assert.doesNotMatch(chips, /READY:\s*\[[^\]]*'[A-Z_]{3,}'/, '徽标里不许出现英文枚举');
  const inventory = script.match(/const INVENTORY_LABELS = Object\.freeze\(\{[^}]*\}\);/)[0];
  for (const [state, word] of [['AVAILABLE', '可分配'], ['RETIRED', '永久停用'], ['PRODUCT_ONLY', '限定产品']]) {
    assert.ok(inventory.includes(`${state}: '${word}'`),
      `详情抽屉的 ${state} 必须和徽标同词：${word}`);
  }
  assert.match(html, /新卡接管记录/);
  assert.doesNotMatch(html, /待验证新卡（隔离区）/);
  assert.match(styles, /select\s*\{[\s\S]*appearance:\s*none/);
  assert.match(styles, /padding-right:\s*40px\s*!important/);
  assert.match(styles, /background-image:[^;]+!important/);
  assert.match(styles, /background-position:\s*calc\(100% - 19px\) 50%, calc\(100% - 14px\) 50%\s*!important/);
});

test('admin Browser view exposes operational metadata but no authority recovery field', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(html, /data-view="diagnostics"/);
  assert.match(html, /authority 不可见/);
  assert.match(script, /\/api\/v1\/admin\/browser\/runs/);
  assert.match(script, /确认付款结果未知/);
  assert.doesNotMatch(script, /\.secretRef|\.navigationUrl|\.leaseToken|\.resourceKeyHmac/);
});

test('admin separates recharge method from audited Browser card-source switching', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(html, /卡台管理/);
  assert.match(html, /API 充值固定使用 HNSKJ/);
  assert.match(script, /\/api\/v1\/admin\/card-sources\/browser\/current/);
  assert.match(script, /Browser 卡台已切换/);
  // D-280 ⑦ / B1：切换卡台只在工作台（那里带「同时接管排队单」和四项校验），
  // 卡片页这张表是只读的。所以这里要的是「指向工作台」，不是「人工指定」徽标。
  assert.match(html, /在工作台的工具栏里切/);
  // 只看代码，不看注释——注释里写「这一行为什么删了」是应该的，代码里还渲染它才是问题。
  const code = script.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /浏览器自动化充值当前卡台/,
    '这一行工作台已经有了，卡片页不再重复显示');
  assert.doesNotMatch(`${html}\n${script}`, /secretRef|navigationUrl|leaseToken|resourceKeyHmac|card_credentials_ciphertext|recharge_card_key/i);
});

test('admin card page folds card sources and import into one view (balance funding retired, D-280 ⑦)', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  const stockView = html.slice(html.indexOf('id="stock-view"'), html.indexOf('id="diagnostics-view"'));
  // 能力一个都不许丢：五条折叠只是收进「高级」，不是删掉。
  for (const id of ['provider-routes-table', 'manual-card-source-form',
    'manual-card-import-form', 'stock-cards', 'stock-open-form', 'stock-jobs', 'card-intake-list',
    // 第⑥块新增的三块（D-280 ①③⑤）
    'cards-rigs', 'card-retirement-list', 'stock-cards-history',
    // B4：六件低频事收进这一个入口
    'stock-advanced']) {
    assert.match(stockView, new RegExp(`id="${id}"`), id);
  }
  // B1：块 2「卡片概况 + 卡台管理」整块删掉。这三个写入口在设置页本来就有一份，
  // 同一个写操作不留两个入口（F-65 那类毛病的根）。它们不许回到卡片页。
  for (const gone of ['stock-summary', 'card-capacity-form', 'minimum-balance-form',
    'card-capacity', 'minimum-balance-plan', 'provider-summary']) {
    assert.doesNotMatch(stockView, new RegExp(`id="${gone}"`), `${gone} 已随块 2 删除，不许回到卡片页`);
  }
  // 删了不等于丢了：那两项现在由设置页渲染，端点没变。
  assert.match(script, /card-stock\/max-successful-payments/);
  assert.match(script, /card-stock\/minimum-balance/);
  // A 版顺序：两台 → 在役卡表 → 待销 → 高级。换序 = 换了另一版设计。
  const order = ['id="cards-rigs"', 'id="stock-cards"', 'id="card-retirement-list"', 'id="stock-advanced"']
    .map((needle) => stockView.indexOf(needle));
  assert.ok(order.every((i) => i >= 0), 'A 版四块必须都在');
  assert.deepEqual(order, [...order].sort((a, b) => a - b),
    'A 版原型的顺序是「在役列表在待销之前」，实现此前是反的，不许再反回去');
  // 块 2 删掉后，「为什么不能开卡」必须还有地方说——否则就是一个点不动又没人解释的按钮。
  assert.match(stockView, /id="stock-open-gate"/);
  assert.match(script, /卡台规则已过期，禁止开卡/);
  assert.match(script, /对账未完成，禁止新开卡/);
  assert.match(script, /剩余开卡额度/);
  // D-280 ⑦：补余额区块退休（D-218 已弃用补余额），连同工作台那条会跳到这里的待办一起。
  // 后端与数据都还在，只是后台不再有入口——恢复时连待办一起接。
  assert.doesNotMatch(stockView, /card-funding-table|card-funding-filters/);
  // 只看代码，不看注释——注释里写「这条待办为什么退休」是应该的，代码里还调它才是问题。
  const scriptCode = script.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(scriptCode, /loadCardFundingAttempts|cardFundingManualReview/);
  assert.doesNotMatch(html, /data-view="provider-routes"|data-view="card-funding"|id="provider-routes-view"|id="card-funding-view"/);
  assert.doesNotMatch(html, /stock-threshold-form|replenishment-limit-form|stock-confirmation|stock-confirm-hint|提醒与自动补卡设置/);
  assert.doesNotMatch(script, /replenishment-settings|stockConfirmation|请输入确认词/);
  assert.match(script, /Promise\.all\(\[loadStock\(\), loadProviderRoutes\(\)\]\)/);
});

test('CDK page generates per product and the card page sets the minimum balance per product', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(html, /id="cdk-plan"[^>]*>[\s\S]*?<option value="pro_20x">Pro 20X<\/option>/);
  assert.match(html, /id="cdk-batch-plan">[\s\S]*?<option value="pro_5x">Pro 5X<\/option>/);
  assert.doesNotMatch(html, /当前仅支持 Plus/);
  assert.match(script, /body: JSON\.stringify\(\{ count, planType \}\)/);
  // 最低余额按产品：入口随 B1 从卡片页块 2 搬到设置页，端点和「按产品」这件事都没变。
  assert.match(script, /SETTINGS_PLAN_ORDER = \['plus', 'pro_5x', 'pro_20x'\]/);
  assert.match(script, /body: JSON\.stringify\(\{ amount: Number\(input\.value\), planType: scope\.dataset\.plan \}\)/);
  const customer = fs.readFileSync(path.join(directory, 'assets', 'customer.js'), 'utf8');
  assert.match(customer, /function withProduct\(text, order\)/);
});

// F-5: the status API answers sessionReplacement.remaining = null for "no limit"
// (D-120). Reading null as 0 hid the re-submit form for every customer who was
// sent back; null must be treated as "may replace".
test('customer page shows the Session re-submit form when remaining is null (unlimited)', () => {
  const customer = fs.readFileSync(path.join(directory, 'assets', 'customer.js'), 'utf8');
  assert.match(customer, /replacement\.remaining == null \|\| Number\(replacement\.remaining\) > 0/);
  assert.doesNotMatch(customer, /Number\(replacement\.remaining \|\| 0\) > 0/);
  // 缓存版本号：改了脚本必须让客户拿到新文件，否则修好的东西在浏览器里
  // 看着还是坏的。写死某一个数字会让这条断言每次改版都挂，反过来诱导人去
  // 改断言；这里只守住真正要守的三件事——两个资源都带版本、版本一致、
  // 只能往上走。
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  const scriptVersion = html.match(/customer\.js\?v=(\d+)/);
  const styleVersion = html.match(/customer\.css\?v=(\d+)/);
  assert.ok(scriptVersion, 'index.html must load customer.js with a ?v= cache version');
  assert.ok(styleVersion, 'index.html must load customer.css with a ?v= cache version');
  assert.equal(scriptVersion[1], styleVersion[1], 'both assets ship together, so they share a version');
  assert.ok(Number(scriptVersion[1]) >= 35, 'the asset version only ever moves forward');
});

test('admin navigation is exactly six pages and old views are gone', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  const nav = html.slice(html.indexOf('<nav aria-label="后台导航">'), html.indexOf('</nav>'));
  // D-283：一级导航六个＝工作台/订单/CDK/卡片/设置/诊断
  assert.deepEqual([...nav.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]),
    ['overview', 'orders', 'cdks', 'stock', 'settings', 'diagnostics']);
  assert.doesNotMatch(html, /id="exceptions-view"|id="browser-view"|id="reconciliation-view"|data-view="exceptions"|data-view="browser"|data-view="reconciliation"/);
  const diagnostics = html.slice(html.indexOf('id="diagnostics-view"'), html.indexOf('id="page-notice"'));
  for (const id of ['diagnostics-heartbeat', 'diagnostics-readiness-list', 'export-orders', 'reconciliation-table', 'browser-runs-table', 'browser-dispatch-table', 'billing-address-settings']) {
    assert.match(diagnostics, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /cdk-delivery-capability/);
  assert.doesNotMatch(script, /'card-funding'|'provider-routes'|'exceptions'|view === 'browser'|view === 'reconciliation'/);
});

test('admin orders page is one table plus one drawer without permits, tags, notes or resend', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(html, /<th>订单<\/th><th>产品<\/th><th>当前阶段<\/th><th>需要我做什么<\/th><th>卡尾号<\/th><th>身份<\/th><th>创建时间<\/th>/);
  assert.match(html, /<option value="REVIEW_REQUIRED">需要处理<\/option>/);
  assert.match(html, /<option value="ACTIVE">进行中<\/option>/);
  assert.match(html, /<option value="FINISHED">已完成<\/option>/);
  assert.match(script, /取消并释放卡/);
  assert.match(script, /人工付款已完成/);
  assert.match(script, /确认 20X 已升级/);
  assert.match(script, /关闭对账案例/);
  assert.doesNotMatch(`${html}\n${script}`, /灰度批量许可|灰度单笔许可|撤销灰度许可|添加标签|添加备注|请输入后台密码/);
  assert.doesNotMatch(script, /#issue-compensation|#add-order-tag|#add-order-note|#arm-recharge-permit|#revoke-recharge-permit|data-record-cdk-delivery|data-search-cdk-delivery|data-select-order/);
  assert.doesNotMatch(html, /退款观察<\/th>|batch-authorize-recharge|select-page-orders|order-time-field/);
  assert.doesNotMatch(`${html}\n${script}`, /逐单确认|待确认充值/);
});
