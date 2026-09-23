// 订单页 Demo v3 浏览器验收（真实 Chromium，无网络依赖，数据来自 data/orders-demo.jsonl）
import { chromium } from 'playwright';
const BASE = process.env.PROTO_BASE || 'http://127.0.0.1:8899';
const out = { checks: [] };
const ok = (name, cond, detail = '') => { out.checks.push({ name, ok: Boolean(cond), detail }); if (!cond) process.exitCode = 1; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
// 原型服务器把 /assets/ 反代到本地后台 8803；后台没起时冻结样式里的字体 502，与 Demo 无关，单独记不当错误。
const assetFails = []; page.on('response', (r) => { if (r.status() >= 400 && /\/assets\//.test(r.url())) assetFails.push(r.url()); });
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.goto(`${BASE}/step6-orders-v3.html`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelectorAll('#od-rows tr').length > 0);
ok('无 JS 错误', errors.length === 0, errors.join(' | '));
ok('视口宽度 1280（测量前断言）', await page.evaluate(() => window.innerWidth) === 1280);
// 默认近 7 天
const mainRows7 = await page.locator('#od-rows tr.od-mainrow').count();
const count7 = await page.locator('#od-count').textContent();
ok('默认「近 7 天」只显示该窗口内的主行', mainRows7 > 0 && mainRows7 < 20, `${mainRows7} 行 · ${count7}`);
// 全部
await page.click('[data-range="all"]');
const mainAll = await page.locator('#od-rows tr.od-mainrow').count();
const countAll = await page.locator('#od-count').textContent();
ok('「全部」按 CDK 归并：主行数 = 码数（55+2 演示码）', mainAll === 57, `${mainAll} 行 · ${countAll}`);
// 状态角标
const nAll = Number(await page.locator('[data-n="all"]').textContent());
const nAction = Number(await page.locator('[data-n="action"]').textContent());
ok('状态角标：全部 = 主行数', nAll === mainAll, `${nAll}`);
ok('「需要我处理」角标 ≥ 3（等 Session 1 + 演示付款不明 1 + 演示续费待确认 1）', nAction >= 3, `${nAction}`);
// 12 次尝试的码：主行带「此前 11 次未成功」，展开后出现 11 条历史行
const tries = page.locator('.od-tries', { hasText: '此前 11 次' });
ok('12 次尝试的码显示「此前 11 次未成功」', await tries.count() === 1);
await tries.first().click();
ok('展开后出现 11 条历史行', await page.locator('#od-rows tr.od-hist').count() === 11);
await tries.first().click();
ok('再点收起', await page.locator('#od-rows tr.od-hist').count() === 0);
// 行点击边界：点产品格不开抽屉；点邮箱开
const firstRow = page.locator('#od-rows tr.od-mainrow').first();
await firstRow.locator('td').nth(1).click();
ok('点产品格不打开抽屉', !(await page.locator('#od-drawer').evaluate((d) => d.open)));
await firstRow.locator('.od-email').click();
ok('点邮箱格打开右侧抽屉', await page.locator('#od-drawer').evaluate((d) => d.open));
const drawerText = await page.locator('#detail-content').textContent();
ok('抽屉含「卡与钱」三问', /这单用的卡/.test(drawerText) && /扣了没/.test(drawerText) && /还能再充/.test(drawerText));
ok('抽屉含提交时间与充值成功时间', /提交时间/.test(drawerText) && /充值成功时间/.test(drawerText));
ok('抽屉正文无内部编号（D-xxx / F-xx）', !/\b[DF]-\d{2,3}\b/.test(drawerText));
await page.click('#od-close');
// 需要我处理：行内动作按钮 + 确认框
await page.click('[data-status="action"]');
const actRows = await page.locator('#od-rows tr.od-mainrow').count();
ok('「需要我处理」筛选后每行都有动作按钮', actRows > 0 && (await page.locator('#od-rows tr.od-mainrow .od-act').count()) === actRows, `${actRows} 行`);
const verifyBtn = page.locator('#od-rows [data-action="verify"]').first();
ok('付款待核实行的按钮是「去核实」', (await verifyBtn.count()) === 1);
await verifyBtn.click();
ok('点动作先弹确认框，不直接执行', await page.locator('#od-confirm').evaluate((d) => d.open));
const confirmText = await page.locator('#od-confirm-text').textContent();
ok('确认框写清会发生什么', /已扣款|未扣款/.test(confirmText));
await page.click('#od-confirm-no');
// 等 Session 那单：动作是取消并放卡，抽屉说明卡已放回
await page.click('[data-status="all"]');
await page.fill('#od-q', 'PJV1-_xH487');
const wRow = page.locator('#od-rows tr.od-mainrow');
ok('搜索单号能定位到等 Session 那单', (await wRow.count()) === 1);
ok('等 Session 行的动作是「取消并放卡」', (await wRow.locator('[data-action="cancel"]').count()) === 1);
await wRow.locator('.od-email').click();
ok('等 Session 抽屉写明「卡已放回池子」', /卡已放回池子/.test(await page.locator('#detail-content').textContent()));
await page.click('#od-close');
// 筛选：产品 / 路线
await page.fill('#od-q', '');
await page.selectOption('#od-route', 'API');
const apiRows = await page.locator('#od-rows tr.od-mainrow').count();
ok('路线筛选 API 有结果且少于全部', apiRows > 0 && apiRows < mainAll, `${apiRows}`);
await page.selectOption('#od-route', '');
await page.selectOption('#od-plan', 'pro_20x');
ok('产品筛选 20X 有结果', (await page.locator('#od-rows tr.od-mainrow').count()) > 0);
// 手机宽度：表可横滚、无 JS 错误
await page.setViewportSize({ width: 390, height: 800 });
ok('390px 下表格 min-width 生效、可横向滚动', await page.evaluate(() => document.querySelector('.cdk-table-wrap').scrollWidth > document.querySelector('.cdk-table-wrap').clientWidth));
ok('全程无 JS 错误', errors.length === 0, errors.join(' | '));
await page.setViewportSize({ width: 1280, height: 860 });
await page.selectOption('#od-plan', '');
await page.screenshot({ path: process.env.SHOT || '/tmp/orders-v3.png', fullPage: false });
await browser.close();
out.assetFails = assetFails; console.log(JSON.stringify(out, null, 1));
