// 订单页 v3 实现的真实浏览器验收（本地后台 8803 + 隔离库 step6_demo 造数）。
// 用法：ADMIN_BASE=http://127.0.0.1:8803 ADMIN_PASSWORD=... node docs/reviews/2026-09-24-orders-v3-impl-check.mjs
// 从 browser-mvp 目录跑（那里装了 playwright）。断言与 Demo 验收脚本同一批意图，落在真实页面与真实接口上。
import { chromium } from 'playwright';
const BASE = process.env.ADMIN_BASE || 'http://127.0.0.1:8803';
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) { console.error('ADMIN_PASSWORD is required'); process.exit(2); }
const out = { checks: [] };
const ok = (name, cond, detail = '') => { out.checks.push({ name, ok: Boolean(cond), detail }); if (!cond) process.exitCode = 1; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
await page.fill('#password', PASSWORD);
await Promise.all([page.waitForURL(/\/admin\/?$/), page.click('#login-form button[type=submit], #login-form button')]);
await page.waitForSelector('#overview-view:not([hidden])', { timeout: 15000 }).catch(() => {});
await page.click('.nav-item[data-view="orders"]');
await page.waitForSelector('#orders-view:not([hidden])');
await page.waitForFunction(() => document.querySelectorAll('#od-rows tr').length > 0);
ok('登录后进入订单页，无 JS 错误', errors.length === 0, errors.join(' | '));
ok('视口 1280', await page.evaluate(() => window.innerWidth) === 1280);

// 近 7 天默认：造数在 09-20，若今天已超 7 天则应为空态；先切「全部」
const initialCount = await page.locator('#od-count').textContent();
await page.click('[data-range="all"]');
await page.waitForFunction(() => document.querySelectorAll('#od-rows tr.od-mainrow').length > 0);
const mainAll = await page.locator('#od-rows tr.od-mainrow').count();
ok('「全部」有主行且每码一行（LOAD-0020/0021 并进 0022 的码）', mainAll > 0 && !(await page.locator('#od-rows tr.od-mainrow[data-no="LOAD-0020"]').count()), `${mainAll} 行；默认计数「${initialCount}」`);
const nAll = Number(await page.locator('[data-n="all"]').textContent());
ok('状态角标全部 = 主行数', nAll === mainAll, `${nAll}`);
const nAction = Number(await page.locator('[data-n="action"]').textContent());
ok('「需要我处理」角标 ≥ 3（等 Session ×2 + 付款不明 + 续费待确认）', nAction >= 3, `${nAction}`);

// 同码多次：LOAD-0022 主行带「2 ▾」，展开出 2 条历史行
const badge = page.locator('tr.od-mainrow[data-no="LOAD-0022"] .od-tries');
ok('LOAD-0022 主行带历史小标「2」', (await badge.count()) === 1 && (await badge.locator('b').textContent()) === '2');
await badge.click();
await page.waitForFunction(() => document.querySelectorAll('#od-rows tr.od-hist:not([data-hist-loading])').length === 2);
ok('展开后 2 条历史行（LOAD-0021 / LOAD-0020）', (await page.locator('#od-rows tr.od-hist[data-no="LOAD-0021"]').count()) === 1 && (await page.locator('#od-rows tr.od-hist[data-no="LOAD-0020"]').count()) === 1);
await badge.click();
ok('再点收起', (await page.locator('#od-rows tr.od-hist').count()) === 0);

// 行点击边界
const row22 = page.locator('tr.od-mainrow[data-no="LOAD-0022"]');
await row22.locator('td.od-plan').click();
ok('点产品格不开抽屉', !(await page.locator('#detail-drawer').evaluate((d) => d.open)));
await row22.locator('.od-email').click();
await page.waitForFunction(() => document.querySelector('#detail-drawer').open && /卡与钱/.test(document.querySelector('#detail-content').textContent));
const drawer = await page.locator('#detail-content').textContent();
ok('抽屉头是邮箱、副行是单号', /cust05@example\.com/.test(await page.locator('#detail-title').textContent()) && /LOAD-0022/.test(await page.locator('#detail-kicker').textContent()));
ok('抽屉含此刻可做 / 进度 / 客户与卡密 / 卡与钱 / 技术证据', /进度/.test(drawer) && /客户与卡密/.test(drawer) && /这单用的卡/.test(drawer) && /扣了没/.test(drawer) && /技术证据/.test(drawer));
ok('抽屉含提交时间与充值成功时间', /提交时间/.test(drawer) && /充值成功时间/.test(drawer));
ok('这张码的尝试 = 3 次', /这张码的尝试\s*3 次/.test(drawer.replace(/\s+/g, ' ')), drawer.match(/这张码的尝试[^次]*次/)?.[0] || '');
ok('未成功单抽屉有「标为已手工充值」按钮', (await page.locator('#manual-fulfilled').count()) === 1);
ok('抽屉正文无内部编号', !/\b[DF]-\d{2,3}\b/.test(drawer));
await page.click('#close-detail');
await page.waitForFunction(() => !document.querySelector('#detail-drawer').open);

// 卡尾号 → 本单抽屉并定位卡与钱（造数里 LOAD-0023 绑 5590、LOAD-0018 绑 7726）
const cardLink = page.locator('#od-rows .od-cardlink').first();
if (await cardLink.count()) {
  const cardNo = await cardLink.getAttribute('data-card');
  await cardLink.click();
  await page.waitForFunction((no) => document.querySelector('#detail-drawer').open && document.querySelector('#od-money') && document.querySelector('#detail-kicker').textContent.includes(no), cardNo);
  ok('点卡尾号打开本单抽屉并高亮「卡与钱」', await page.locator('#od-money.is-focus').count() === 1);
  await page.click('#close-detail');
} else ok('点卡尾号打开本单抽屉并高亮「卡与钱」', true, '造数无已分卡的主行，跳过');

// 需要我处理：行内动作
await page.click('[data-status="action"]');
// 切桶后旧表还在，只等「有行」会数到上一桶的行；等主行数 = 角标数才算这桶加载完
await page.waitForFunction(() => document.querySelectorAll('#od-rows tr.od-mainrow').length === Number(document.querySelector('[data-n="action"]').textContent));
const actRows = await page.locator('#od-rows tr.od-mainrow').count();
ok('「需要我处理」每行都有行内动作链接', actRows > 0 && (await page.locator('#od-rows tr.od-mainrow .od-rowact').count()) === actRows, `${actRows} 行`);
const verify = page.locator('tr.od-mainrow[data-no="LOAD-0019"] [data-action="verify"]');
ok('付款不明（LOAD-0019）的动作是「去核实」', (await verify.count()) === 1);
await verify.click();
await page.waitForFunction(() => document.querySelector('#detail-drawer').open && /进度/.test(document.querySelector('#detail-content').textContent));
ok('「去核实」打开抽屉且顶部有付款未知警示', /不会重付/.test(await page.locator('#detail-content').textContent()));
await page.click('#close-detail');
const cancel = page.locator('tr.od-mainrow[data-no="LOAD-0023"] [data-action="cancel"]');
ok('等 Session（LOAD-0023）的动作是「取消并放卡」', (await cancel.count()) === 1);
await cancel.click();
await page.waitForFunction(() => document.querySelector('#od-confirm').open);
ok('点「取消并放卡」先弹确认框', /放回卡/.test(await page.locator('#od-confirm-title').textContent()));
await page.click('#od-confirm-no');
const renewal = page.locator('#od-rows [data-action="renewal"]');
ok('续费待确认的单动作是「已在账号里取消续费」', (await renewal.count()) >= 1);

// 搜索 / 产品 / 路线 / 空态
await page.click('[data-status="all"]');
await page.fill('#od-q', 'LOAD-0023');
await page.waitForFunction(() => document.querySelectorAll('#od-rows tr.od-mainrow').length === 1);
ok('按单号搜索只剩那一单', (await page.locator('#od-rows tr.od-mainrow[data-no="LOAD-0023"]').count()) === 1);
await page.fill('#od-q', '');
await page.selectOption('#od-plan', 'pro_20x');
await page.waitForTimeout(600);
const n20 = await page.locator('#od-rows tr.od-mainrow').count();
ok('产品筛选 20X 有结果且少于全部', n20 > 0 && n20 < mainAll, `${n20}`);
await page.selectOption('#od-plan', '');
await page.selectOption('#od-route', 'API');
await page.waitForTimeout(600);
ok('路线筛选 API 有结果或明确空态', (await page.locator('#od-rows tr.od-mainrow').count()) > 0 || /没有订单/.test(await page.locator('#od-rows').textContent()));
await page.selectOption('#od-route', '');
await page.fill('#od-q', 'nobody@nowhere.invalid');
await page.waitForFunction(() => /没有订单/.test(document.querySelector('#od-rows').textContent));
ok('无结果时显示明确空态', true);
await page.fill('#od-q', '');

// 接口失败态：500 → 读取失败 + 重试
await page.route('**/api/v1/admin/orders/search', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
await page.click('[data-status="processing"]');
await page.waitForFunction(() => /读取失败/.test(document.querySelector('#od-rows').textContent));
ok('接口 500 时显示「读取失败」与重试，不冒充空态', (await page.locator('#od-rows [data-retry]').count()) === 1);
await page.unroute('**/api/v1/admin/orders/search');
await page.click('#od-rows [data-retry]');
await page.waitForFunction(() => !/读取失败/.test(document.querySelector('#od-rows').textContent));
ok('重试后恢复', true);

// 宽屏 1920：内容区封顶 1280，时间列在进度列前（第八轮，Lemon 2026-09-24「进度往右一些；其他的补」）
await page.setViewportSize({ width: 1920, height: 1000 });
await page.waitForTimeout(300);
const wide = await page.evaluate(() => {
  const pageW = document.querySelector('#orders-view .od-page').getBoundingClientRect().width;
  const ths = [...document.querySelectorAll('#od-table thead th')].map((th) => th.className);
  const tb = document.querySelector('#od-table').getBoundingClientRect();
  const stageLeft = document.querySelector('#od-table th.th-stage').getBoundingClientRect().left - tb.left;
  const timeLeft = document.querySelector('#od-table th.th-time').getBoundingClientRect().left - tb.left;
  return { pageW, ths, stageLeft, timeLeft };
});
ok('1920 下内容区封顶 1280', wide.pageW === 1280, `${wide.pageW}`);
ok('1920 下时间列在进度列之前，进度列收尾', wide.ths.indexOf('th-time') === 3 && wide.ths.indexOf('th-stage') === 4 && wide.timeLeft < wide.stageLeft, wide.ths.join(','));

// 手机宽度
await page.setViewportSize({ width: 390, height: 800 });
ok('390px 下表格可横向滚动', await page.evaluate(() => { const w = document.querySelector('#orders-view .cdk-table-wrap'); return w.scrollWidth > w.clientWidth; }));
await page.setViewportSize({ width: 1280, height: 860 });
ok('全程无 JS 错误', errors.length === 0, errors.join(' | '));
await page.click('[data-status="all"]');
await page.waitForTimeout(500);
await page.screenshot({ path: process.env.SHOT || '/tmp/orders-impl.png' });
await browser.close();
console.log(JSON.stringify(out, null, 1));
