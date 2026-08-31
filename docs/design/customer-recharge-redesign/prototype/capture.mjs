/* =========================================================================
   capture.mjs — 可选的截图工具（不属于原型运行时）。
   用 Playwright 加载原型，切到各状态，生成桌面/移动端 PNG 到 ../screenshots/。
   依赖仓库根 node_modules 里的 playwright。

   用法（先在 prototype 目录起静态服务器）：
     python3 -m http.server 8848 --bind 127.0.0.1 &
     node docs/design/customer-recharge-redesign/prototype/capture.mjs
   ========================================================================= */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'screenshots');
const URL = process.env.PROTO_URL || 'http://127.0.0.1:8848/index.html';

const STATES = [
  { seq: '01', name: 'input',           setup: async (p) => p.evaluate(() => window.__proto.view('input', { step: 1 })) },
  { seq: '02', name: 'confirm',         setup: async (p) => { await p.evaluate(() => window.__proto.confirm()); await p.waitForTimeout(500); } },
  { seq: '03', name: 'processing',      setup: async (p) => p.evaluate(() => window.__proto.status('PROCESSING')) },
  { seq: '04', name: 'success',         setup: async (p) => { await p.evaluate(() => window.__proto.status('SUCCESS')); await p.waitForTimeout(700); } },
  { seq: '05', name: 'action-required', setup: async (p) => p.evaluate(() => window.__proto.status('ACTION_REQUIRED')) },
  { seq: '06', name: 'failed',          setup: async (p) => p.evaluate(() => window.__proto.status('FAILED')) },
  { seq: '07', name: 'query',           setup: async (p) => p.evaluate(() => window.__proto.view('query')) },
  { seq: '08', name: 'guide',           fullPage: false, setup: async (p) => { await p.evaluate(() => { window.__proto.view('input', { step: 1 }); window.__proto.guide(); }); await p.waitForTimeout(420); } }
];

const DEVICES = [
  { id: 'desktop', viewport: { width: 900, height: 1000 }, dsf: 2, isMobile: false },
  { id: 'mobile',  viewport: { width: 390, height: 844 },  dsf: 3, isMobile: true }
];

async function shoot(browser, device, theme) {
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.dsf,
    isMobile: device.isMobile,
    hasTouch: device.isMobile,
    colorScheme: theme === 'dark' ? 'dark' : 'light'
  });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate((t) => window.__proto.theme(t), theme);
  await page.evaluate(() => window.__proto.closeDemo());

  const suffix = theme === 'dark' ? '-dark' : '';
  for (const s of STATES) {
    await page.evaluate(() => { window.__proto.closeGuide(); window.__proto.view('input', { step: 1 }); }); // reset
    await s.setup(page);
    await page.waitForTimeout(260);
    const file = join(OUT, `${device.id}-${s.seq}-${s.name}${suffix}.png`);
    await page.screenshot({ path: file, fullPage: s.fullPage !== false });
    console.log('✓', file.replace(OUT + '/', ''));
  }
  await context.close();
}

const browser = await chromium.launch();
for (const d of DEVICES) await shoot(browser, d, 'light');
// 深色补充：桌面成功 + 移动成功，展示主题适配
for (const d of DEVICES) {
  const context = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.dsf, isMobile: d.isMobile, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__proto.theme('dark'); window.__proto.closeDemo(); });
  await page.evaluate(() => window.__proto.status('SUCCESS'));
  await page.waitForTimeout(700);
  const file = join(OUT, `${d.id}-04-success-dark.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('✓', file.replace(OUT + '/', ''));
  await context.close();
}
await browser.close();
console.log('\nAll screenshots written to', OUT);
