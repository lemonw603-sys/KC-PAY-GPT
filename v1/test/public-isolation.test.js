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
  assert.match(html, /admin\.css\?v=26/);
  assert.match(html, /admin\.js\?v=48/);
  assert.match(script, /button\.textContent = '刷新中…'/);
  assert.match(script, /showNotice\('刷新完成。', 'success'\)/);
  assert.match(script, /showNotice\('刷新失败，请稍后重试。'\)/);
  assert.match(script, /等待 Session/);
  assert.match(script, /Plus 可分配卡/);
  assert.match(script, /decisions-grid/);
  assert.match(html, /五个决定/);
  assert.match(script, /card-stock\/minimum-balance/);
  // F-16/F-3 close-out for payment-result-unknown runs is reachable from the UI (run panel + order drawer),
  // and the client sends renewalCancelled as a real boolean (F-44).
  assert.match(script, /data-browser-control="RESOLVE_UNKNOWN_PAYMENT">确认核实结果</);
  assert.match(script, /data-order-run-control="RESOLVE_UNKNOWN_PAYMENT">确认核实结果</);
  assert.match(script, /input\.renewalCancelled = answers\.renewalCancelled === 'true'/);
  assert.match(html, /最低所需卡余额/);
  assert.match(script, /card-intake\/.*\/validate/);
  assert.match(script, /card-intake\/.*\/accept/);
  assert.doesNotMatch(script, /卡台当前 active 卡数/);
  assert.doesNotMatch(script, /卡台历史总卡数/);
  assert.match(script, /可分配.*使用中.*暂不可用.*永久停用/s);
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
  assert.match(html, /人工指定/);
  assert.match(html, /API 充值固定使用 HNSKJ/);
  assert.match(script, /\/api\/v1\/admin\/card-sources\/browser\/current/);
  assert.match(script, /Browser 卡台已切换/);
  assert.match(html, /只影响之后创建的新订单/);
  assert.doesNotMatch(`${html}\n${script}`, /secretRef|navigationUrl|leaseToken|resourceKeyHmac|card_credentials_ciphertext|recharge_card_key/i);
});

test('admin card page folds card sources, import, and balance funding into one view', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  const stockView = html.slice(html.indexOf('id="stock-view"'), html.indexOf('id="page-notice"'));
  for (const id of ['stock-summary', 'card-capacity-form', 'minimum-balance-form', 'provider-routes-table', 'manual-card-source-form',
    'manual-card-import-form', 'stock-cards', 'stock-open-form', 'card-funding-table', 'stock-jobs', 'card-intake-list']) {
    assert.match(stockView, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /data-view="provider-routes"|data-view="card-funding"|id="provider-routes-view"|id="card-funding-view"/);
  assert.doesNotMatch(html, /stock-threshold-form|replenishment-limit-form|stock-confirmation|stock-confirm-hint|提醒与自动补卡设置/);
  assert.doesNotMatch(script, /replenishment-settings|stockConfirmation|请输入确认词/);
  assert.match(script, /Promise\.all\(\[loadStock\(\), loadProviderRoutes\(\), loadCardFundingAttempts\(\)\]\)/);
});

test('CDK page generates per product and the card page sets the minimum balance per product', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(html, /id="cdk-plan"[^>]*>[\s\S]*?<option value="pro_20x">Pro 20X<\/option>/);
  assert.match(html, /id="cdk-batch-plan">[\s\S]*?<option value="pro_5x">Pro 5X<\/option>/);
  assert.match(html, /id="minimum-balance-plan"/);
  assert.doesNotMatch(html, /当前仅支持 Plus/);
  assert.match(script, /body: JSON\.stringify\(\{ count, planType \}\)/);
  assert.match(script, /body: JSON\.stringify\(\{ amount: Math\.round\(amount \* 100\) \/ 100, planType \}\)/);
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
  assert.ok(Number(scriptVersion[1]) >= 31, 'the asset version only ever moves forward');
});

test('admin navigation is exactly five pages and old views are gone', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  const nav = html.slice(html.indexOf('<nav aria-label="后台导航">'), html.indexOf('</nav>'));
  assert.deepEqual([...nav.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]), ['overview', 'orders', 'cdks', 'stock', 'diagnostics']);
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
  assert.match(script, /正常模式由系统自动执行/);
  assert.match(script, /取消并释放卡/);
  assert.match(script, /人工付款已完成/);
  assert.match(script, /确认 20X 已升级/);
  assert.match(script, /关闭对账案例/);
  assert.doesNotMatch(`${html}\n${script}`, /灰度批量许可|灰度单笔许可|撤销灰度许可|添加标签|添加备注|请输入后台密码/);
  assert.doesNotMatch(script, /#issue-compensation|#add-order-tag|#add-order-note|#arm-recharge-permit|#revoke-recharge-permit|data-record-cdk-delivery|data-search-cdk-delivery|data-select-order/);
  assert.doesNotMatch(html, /退款观察<\/th>|batch-authorize-recharge|select-page-orders|order-time-field/);
  assert.doesNotMatch(`${html}\n${script}`, /逐单确认|待确认充值/);
});
