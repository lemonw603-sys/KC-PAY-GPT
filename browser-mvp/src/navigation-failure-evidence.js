// 导航失败证据包（D-379 / D-380）。
//
// 2026-09-25 块 6 演练三次导航失败，只有一行报错；「付款表单加载失败」查不到原因。这里在「开始导航」时
// 打开 Playwright 录制，导航失败就把录制和失败那一刻的现场存成一个本机目录，导航成功就停掉并丢弃录制。
//
// 存什么：D-380 Lemon 定「不限制」——trace 里有请求头、Cookie、token、返回内容、截图、完整 HTML。
// 只留一条线：卡号 / CVV 不进证据。靠结构保证：录制只覆盖导航这一段，成功即丢弃，填卡永远在录制之外。
// 存哪：只在本机（默认 ~/Library/Application Support/pojia-browser-live/evidence/），700/600，14 天自动删。
// 取证本身出任何错都不能改变订单结局：调用方照原样安全停下，只多记一个 evidenceRef（可能为 null）。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_EVIDENCE_ROOT = path.join(os.homedir(), 'Library', 'Application Support', 'pojia-browser-live', 'evidence');
export const EVIDENCE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const EVIDENCE_MAX_BUNDLE_BYTES = 100 * 1024 * 1024;
const CAPTURE_BUDGET_MS = 15_000;
const STEP_TIMEOUT_MS = 5_000;
const ERROR_BODY_BYTES = 8 * 1024;
const TRACE_OPTIONS = Object.freeze({ screenshots: true, snapshots: true, sources: false });

/**
 * 生产与演练默认开（D-380）；`BROWSER_NAVIGATION_EVIDENCE=off` 可关。跑测试（node --test 会设
 * NODE_TEST_CONTEXT）时默认关，免得测试往真实证据目录里写；测这个模块的测试显式传 root 打开。
 */
export function defaultNavigationEvidenceOptions(env = process.env) {
  const off = String(env.BROWSER_NAVIGATION_EVIDENCE ?? '').trim().toLowerCase() === 'off';
  return { enabled: !off && !env.NODE_TEST_CONTEXT, root: env.BROWSER_EVIDENCE_DIR || DEFAULT_EVIDENCE_ROOT };
}

const firstLine = (value) => String(value?.message ?? value ?? '').split('\n')[0].slice(0, 500);

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function bundleName(startedAt, runRef) {
  const stamp = new Date(startedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const short = String(runRef || 'run').replace(/^[a-z]+:/i, '').replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'run';
  return `${stamp}-${short}`;
}

const NOOP = Object.freeze({
  async discard() {},
  async capture() { return { evidenceRef: null, evidenceError: 'disabled' }; },
});

/**
 * 在「开始导航」时调用。返回 { discard, capture }：导航成功调 discard（停录、不留文件），
 * 失败调 capture（停录存盘 + 现场）。两者只有第一次调用生效。
 */
export async function startNavigationEvidence({
  page, runRef = 'run', root = DEFAULT_EVIDENCE_ROOT, enabled = true, clock = () => Date.now(),
  maxBundleBytes = EVIDENCE_MAX_BUNDLE_BYTES,
} = {}) {
  if (!enabled || !page) return NOOP;
  const startedAt = clock();
  const notes = [];
  let context = null;
  try { context = page.context(); } catch (error) { notes.push(`context: ${firstLine(error)}`); }
  let tracing = false;
  if (context?.tracing) {
    try {
      await withTimeout(context.tracing.start({ ...TRACE_OPTIONS, title: `navigation ${runRef}` }), STEP_TIMEOUT_MS, 'trace start');
      tracing = true;
    } catch (error) {
      // 上一单没收尾留下的录制会占着这个窗口：先停掉旧的再开，别让这一单没有证据。
      try {
        await withTimeout(context.tracing.stop(), STEP_TIMEOUT_MS, 'stale trace stop');
        await withTimeout(context.tracing.start({ ...TRACE_OPTIONS, title: `navigation ${runRef}` }), STEP_TIMEOUT_MS, 'trace restart');
        tracing = true;
        notes.push(`trace-restarted: ${firstLine(error)}`);
      } catch (retryError) {
        notes.push(`trace-start: ${firstLine(retryError)}`);
      }
    }
  }
  let finished = false;
  return {
    async discard() {
      if (finished) return;
      finished = true;
      if (tracing) await withTimeout(context.tracing.stop(), STEP_TIMEOUT_MS, 'trace discard').catch(() => undefined);
    },
    async capture({ reason = null, error = null, actions = null } = {}) {
      if (finished) return { evidenceRef: null, evidenceError: 'already-finished' };
      finished = true;
      const name = bundleName(startedAt, runRef);
      try {
        return await withTimeout(
          writeBundle({ page, context, tracing, root, name, startedAt, clock, notes, reason, error, actions, maxBundleBytes }),
          CAPTURE_BUDGET_MS,
          'evidence capture',
        );
      } catch (captureError) {
        if (tracing) await context.tracing.stop().catch(() => undefined);
        return { evidenceRef: null, evidenceError: firstLine(captureError) };
      }
    },
  };
}

async function pruneOldBundles(root, now) {
  let entries = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    try {
      const stat = await fs.stat(full);
      if (now - stat.mtimeMs > EVIDENCE_RETENTION_MS) await fs.rm(full, { recursive: true, force: true });
    } catch { /* 删不掉下次再删 */ }
  }
}

async function requestSummary(request) {
  const row = { method: request.method(), url: request.url(), resourceType: request.resourceType() };
  const failure = request.failure();
  if (failure) row.failure = failure.errorText;
  // 真页面上总有没结束的请求（长连接、Stripe 轮询），request.response() 会一直等下去——2026-09-25 第一次真用时
  // 整张清单因此超时没存下来。每个请求最多等 300 毫秒，等不到就标 pending。
  const response = await withTimeout(request.response(), 300, 'response').catch(() => null);
  if (!response && !failure) row.pending = true;
  if (response) {
    row.status = response.status();
    if (row.status >= 400) {
      const body = await withTimeout(response.text(), 1_000, 'response body').catch(() => null);
      if (body != null) row.body = body.slice(0, ERROR_BODY_BYTES);
    }
  }
  return row;
}

async function writeBundle({ page, context, tracing, root, name, startedAt, clock, notes, reason, error, actions, maxBundleBytes }) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => undefined);
  await pruneOldBundles(root, clock());
  const dir = path.join(root, name);
  await fs.mkdir(dir, { mode: 0o700 });
  const files = {};
  const step = async (label, run) => {
    try { await withTimeout(Promise.resolve().then(run), STEP_TIMEOUT_MS, label); } catch (stepError) { notes.push(`${label}: ${firstLine(stepError)}`); }
  };
  const writeJson = async (file, value) => { await fs.writeFile(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); };

  // 先停录制：trace 要包含失败之前的全部动作。
  if (tracing) await step('trace', () => context.tracing.stop({ path: path.join(dir, 'trace.zip') }));
  await step('console', async () => writeJson('console.json', (await page.consoleMessages()).map((m) => ({
    type: m.type(), text: m.text(), location: m.location(),
  }))));
  await step('page-errors', async () => writeJson('page-errors.json', (await page.pageErrors()).map((e) => ({
    name: e.name, message: e.message, stack: e.stack,
  }))));
  await step('network', async () => writeJson('network.json', await Promise.all((await page.requests()).map(requestSummary))));
  await step('aria', async () => fs.writeFile(path.join(dir, 'page.aria.txt'), await page.locator('body').ariaSnapshot({ timeout: STEP_TIMEOUT_MS }), { mode: 0o600 }));
  await step('html', async () => fs.writeFile(path.join(dir, 'page.html'), await page.content(), { mode: 0o600 }));
  await step('screenshot', () => page.screenshot({ path: path.join(dir, 'screenshot.png'), timeout: STEP_TIMEOUT_MS }));

  for (const file of await fs.readdir(dir)) {
    const full = path.join(dir, file);
    await fs.chmod(full, 0o600).catch(() => undefined);
    files[file] = (await fs.stat(full)).size;
  }
  // 100 MB 上限：先丢截图与 HTML，再丢 trace。
  const total = () => Object.values(files).reduce((sum, size) => sum + size, 0);
  for (const drop of ['screenshot.png', 'page.html', 'trace.zip']) {
    if (total() <= maxBundleBytes) break;
    if (files[drop] == null) continue;
    await fs.rm(path.join(dir, drop), { force: true });
    notes.push(`dropped ${drop} (${files[drop]} bytes) to stay under ${maxBundleBytes}`);
    delete files[drop];
  }
  let url = null;
  try { url = page.url(); } catch { /* page gone */ }
  await writeJson('summary.json', {
    reason, error: error ? firstLine(error) : null, actions: Array.isArray(actions) ? actions : null,
    startedAt: new Date(startedAt).toISOString(), capturedAt: new Date(clock()).toISOString(),
    url, files, notes,
  });
  return { evidenceRef: name };
}
