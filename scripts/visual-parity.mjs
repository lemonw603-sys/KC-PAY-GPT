#!/usr/bin/env node
// 视觉一致性比对：把「已确认原型」和「实现页面」放进同一个视口，逐项比几何量与关键样式，
// 差异超过阈值即失败。
//
// 起因（2026-09-20，Lemon）：「你实际做出来的和设计有差距，你却不知道」。
// 当天连续踩到的四个坑说明「肉眼看截图」这条路本身就不成立：
//   1. 视口 emulation 会被悄悄清掉（回合结束、窗格宽度变化），于是一直在 280px 窄屏下
//      看堆叠版，而用户看的是 1440px 并排版；
//   2. 用 CSS zoom 放大看细节会改变布局宽度，三等分段被压成两行，是放大手法造出来的假象
//      （要放大得用 transform: scale，它不参与布局）；
//   3. 截图被缩到 800×500 交付，只有真实分辨率的 55%，细节根本分辨不出来；
//   4. 就算看清了，「差 5px」这种量肉眼也判不了。
// 所以这里一个像素都不靠眼睛：两边跑在同一视口，取同一组量，让数字说话。
//
// 零依赖：用系统已装的 Chrome + Node 内置 WebSocket 走 CDP，不引入 puppeteer。
//
// 用法：
//   node scripts/visual-parity.mjs                     # 跑 docs/design/parity/ 下全部契约
//   node scripts/visual-parity.mjs <契约.json> ...      # 跑指定契约
//   VP_KEEP=1 node scripts/visual-parity.mjs           # 失败时保留 Chrome 便于排查
//
// 退出码：0=全部一致；1=存在差异；2=跑不起来（缺 Chrome、页面打不开、选择器落空…）
// 「跑不起来」和「一致」必须分开 —— 否则环境坏掉会伪装成通过。

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARITY_DIR = path.join(ROOT, 'docs/design/parity');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  process.env.CHROME_PATH
].filter(Boolean);

/** 长度类样式（可按容差比），其余按字符串精确比。 */
const LENGTH_METRICS = new Set([
  'height', 'width', 'contentTop', 'contentBottom', 'left', 'right', 'fontSize',
  'letterSpacing', 'marginBottom', 'marginTop', 'gap', 'rowGap', 'columnGap', 'borderRadius'
]);

/**
 * session cookie 的本机缓存。只为避开登录限流，存的是本机开发/验收环境的会话，
 * 文件权限 600、放临时目录，且从不打印内容。别拿它存生产会话。
 */
const sessionCachePath = (url) =>
  path.join(tmpdir(), `visual-parity-session-${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`);

async function loadSession(url) {
  try {
    const raw = JSON.parse(await readFile(sessionCachePath(url), 'utf8'));
    if (!Array.isArray(raw?.cookies) || Date.now() - raw.at > 12 * 3600_000) return null;
    return raw.cookies;
  } catch { return null; }
}

async function saveSession(url, cookies) {
  try {
    await writeFile(sessionCachePath(url), JSON.stringify({ at: Date.now(), cookies }), { mode: 0o600 });
  } catch { /* 缓存不上就每次登录，不影响结论 */ }
}

class Cdp {
  #ws; #id = 0; #pending = new Map(); #listeners = new Map();

  static async connect(url) {
    const cdp = new Cdp();
    cdp.#ws = new WebSocket(url);
    await new Promise((res, rej) => {
      cdp.#ws.addEventListener('open', res, { once: true });
      cdp.#ws.addEventListener('error', () => rej(new Error(`WebSocket 连不上: ${url}`)), { once: true });
    });
    cdp.#ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.#pending.has(msg.id)) {
        const { resolve, reject } = cdp.#pending.get(msg.id);
        cdp.#pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code ?? ''})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of cdp.#listeners.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
      }
    });
    return cdp;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`CDP 超时: ${method}`));
      }, 30_000);
    });
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(fn);
  }

  once(method, predicate = () => true) {
    return new Promise((resolve) => {
      const fn = (params, sessionId) => {
        if (predicate(params, sessionId)) resolve(params);
      };
      this.on(method, fn);
    });
  }

  close() { try { this.#ws.close(); } catch { /* 已关就算了 */ } }
}

async function launchChrome() {
  const bin = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!bin) {
    throw Object.assign(new Error(
      '找不到 Chrome。装了但不在默认位置就设 CHROME_PATH=<可执行文件路径>。'
    ), { setup: true });
  }
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'visual-parity-'));
  const proc = spawn(bin, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--hide-scrollbars',            // 滚动条会占宽度，两边都不要，否则差 15px
    '--force-device-scale-factor=1',
    '--allow-file-access-from-files',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome 启动超时（30s 内没报出调试端口）')), 30_000);
    proc.stderr.on('data', (chunk) => {
      buf += chunk;
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    });
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome 退出了，code=${code}\n${buf}`)); });
  });

  return {
    wsUrl,
    async kill() {
      proc.kill('SIGTERM');
      await new Promise((r) => proc.once('exit', r)).catch(() => {});
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/** 在页面里跑的采集函数，序列化后注入。只读，不改页面。 */
const COLLECTOR = String(function collect(rootSel, probes) {
  const r1 = (n) => Math.round(n * 10) / 10;
  const root = document.querySelector(rootSel);
  if (!root) return { error: '根选择器没匹配到元素: ' + rootSel };

  const rb = root.getBoundingClientRect();
  const read = (el) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const kids = [...el.children];
    const first = kids[0] && kids[0].getBoundingClientRect();
    const last = kids.length && kids[kids.length - 1].getBoundingClientRect();
    const px = (v) => (v === 'normal' || v === 'auto' || v == null ? '0px' : v);
    return {
      height: r1(b.height),
      width: r1(b.width),
      // 相对根的左右边 —— 「各组是不是均匀铺开」只有靠这两个数才守得住，
      // 光比每组自己的宽高，挤在一边和均匀分布量出来是一样的。
      left: r1(b.left - rb.left),
      right: r1(b.right - rb.left),
      // 首/末子元素到容器上下边的距离 —— 顶对齐、居中、底对齐的区别全在这两个数上
      contentTop: first ? r1(first.top - b.top) : null,
      contentBottom: last ? r1(b.bottom - last.bottom) : null,
      padding: cs.padding,
      gap: px(cs.gap),
      rowGap: px(cs.rowGap),
      columnGap: px(cs.columnGap),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      letterSpacing: px(cs.letterSpacing),
      marginTop: cs.marginTop,
      marginBottom: cs.marginBottom,
      borderRadius: cs.borderRadius,
      display: cs.display,
      flexDirection: cs.flexDirection,
      alignItems: cs.alignItems,
      justifyContent: cs.justifyContent,
      flexWrap: cs.flexWrap,
      textAlign: cs.textAlign
    };
  };

  const out = { rootWidth: r1(rb.width), probes: {} };
  for (const probe of probes) {
    const nodes = [...root.querySelectorAll(probe.sel)];
    if (!nodes.length) { out.probes[probe.name] = { error: '没匹配到: ' + probe.sel }; continue; }
    const picked = probe.all ? nodes : [nodes[0]];
    const entry = { count: nodes.length, items: picked.map(read) };
    if (probe.all && picked.length > 1) {
      // 相邻间隙。「各组是不是均匀铺开」得看间隙 —— 每项自己的宽高都对、却全挤在
      // 一边，量出来是一样的。间隙又不受内容宽度影响（下拉里的文字两边本就不同），
      // 所以它比绝对位置更适合拿来守。
      const boxes = picked.map((el) => el.getBoundingClientRect()).sort((a, b) => a.left - b.left);
      entry.gaps = boxes.slice(1).map((b, i) => r1(b.left - boxes[i].right));
    }
    out.probes[probe.name] = entry;
  }
  return out;
});

async function openPage(cdp, url, { width, height, login }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  // 先定死视口再导航。反过来做，导航会把 emulation 冲掉 —— 这正是 2026-09-20 那次
  // 「一直在 280px 下看 1440px 的设计」的成因。
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);

  const navigate = async (target) => {
    const loaded = cdp.once('Page.loadEventFired', (_p, sid) => sid === sessionId);
    const res = await cdp.send('Page.navigate', { url: target }, sessionId);
    if (res.errorText) throw new Error(`打不开 ${target}: ${res.errorText}`);
    await Promise.race([loaded, new Promise((r) => setTimeout(r, 15_000))]);
  };

  await navigate(url);

  if (login) {
    const { password, endpoint = '/api/v1/admin/session' } = login;
    if (!password) throw Object.assign(new Error('契约要求登录但没给密码（用环境变量注入）'), { setup: true });
    await cdp.send('Network.enable', {}, sessionId);

    const probe = async () => {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: `fetch(${JSON.stringify(endpoint)},{credentials:'same-origin'}).then(r=>r.status).catch(()=>0)`,
        awaitPromise: true, returnByValue: true
      }, sessionId);
      return result.value;
    };

    // 先拿缓存的 session 试。后台登录接口有限流，每跑一次脚本就重登一次，
    // 连跑几次就 429 —— 那时脚本会报「跑不起来」，看着像代码坏了，其实是自己撞的。
    const cached = await loadSession(url);
    if (cached) {
      await cdp.send('Network.setCookies', { cookies: cached }, sessionId).catch(() => {});
    }

    if (await probe() !== 200) {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: `fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'content-type':'application/json'},`
          + `body:JSON.stringify({password:${JSON.stringify(password)}})}).then(r=>r.status)`,
        awaitPromise: true, returnByValue: true
      }, sessionId);
      if (result.value === 429) {
        throw Object.assign(new Error(
          '后台登录被限流（429）。等限流窗口过去再跑；正常情况下脚本会复用上次的 session，'
          + '不该反复登录 —— 连续撞 429 说明 session 缓存没生效，先查这个。'
        ), { setup: true });
      }
      if (![200, 204].includes(result.value)) {
        throw Object.assign(new Error(`后台登录失败，HTTP ${result.value}`), { setup: true });
      }
      const { cookies } = await cdp.send('Network.getCookies', { urls: [url] }, sessionId);
      await saveSession(url, cookies);
    }
    await navigate(url);
  }

  // 渲染稳定后再量：等两帧 + 字体就绪，避免量到字体回退时的尺寸
  await cdp.send('Runtime.evaluate', {
    expression: 'new Promise(r=>{const go=()=>requestAnimationFrame(()=>requestAnimationFrame(r));'
      + 'document.fonts&&document.fonts.ready?document.fonts.ready.then(go):go()})',
    awaitPromise: true
  }, sessionId);

  // 量之前先确认视口真的是我们要的那个 —— 不确认就等于没设
  const { result: vw } = await cdp.send('Runtime.evaluate',
    { expression: 'innerWidth', returnByValue: true }, sessionId);
  if (vw.value !== width) {
    throw Object.assign(new Error(`视口没生效：期望 ${width}，实际 ${vw.value}`), { setup: true });
  }

  return sessionId;
}

/**
 * 等目标元素真的出现再量。后台大半内容是拿到接口数据后才渲染的（营业条的路线段就是），
 * load 事件只说明文档到齐，不代表这些节点已经在。不等就会时灵时不灵。
 */
async function waitForSelectors(cdp, sessionId, rootSel, selectors, timeoutMs = 15_000) {
  const expression = `new Promise((resolve) => {
    const root = () => document.querySelector(${JSON.stringify(rootSel)});
    const sels = ${JSON.stringify(selectors)};
    const missing = () => { const r = root(); return r ? sels.filter(s => !r.querySelector(s)) : ['(根) ' + ${JSON.stringify(rootSel)}]; };
    const deadline = Date.now() + ${timeoutMs};
    const tick = () => {
      const m = missing();
      if (!m.length) return resolve(null);
      if (Date.now() > deadline) return resolve(m);
      setTimeout(tick, 100);
    };
    tick();
  })`;
  const { result } = await cdp.send('Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.value) {
    throw Object.assign(new Error(
      `等了 ${timeoutMs / 1000}s 这些元素还没出现：${result.value.join('、')}\n`
      + '（可能是接口没返回、页面报错，或选择器写错了 —— 都不等于「与原型一致」）'
    ), { setup: true });
  }
  // 出现之后再稳一帧，避免量到插入瞬间的中间态
  await cdp.send('Runtime.evaluate', {
    expression: 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
    awaitPromise: true
  }, sessionId);
}

async function collect(cdp, sessionId, rootSel, probes) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: `(${COLLECTOR})(${JSON.stringify(rootSel)}, ${JSON.stringify(probes)})`,
    returnByValue: true
  }, sessionId);
  if (exceptionDetails) throw new Error(`采集脚本出错: ${exceptionDetails.text}`);
  if (result.value?.error) throw Object.assign(new Error(result.value.error), { setup: true });
  return result.value;
}

const toPx = (v) => (typeof v === 'number' ? v : (/^-?[\d.]+px$/.test(String(v)) ? parseFloat(v) : null));

/** 自洽断言：一组元素的相邻间隙应当彼此相等（契约里 equalGaps: true）。 */
function diffEqualGaps(probeName, side, gaps, tol) {
  if (!Array.isArray(gaps) || gaps.length < 2) return [];
  const min = Math.min(...gaps), max = Math.max(...gaps);
  if (max - min <= tol) return [];
  return [{ probe: `${probeName}（${side}）`, metric: '间隙应相等',
    proto: '各间隙一致', impl: gaps.map((g) => `${g}`).join(' / '), delta: `极差 ${r1(max - min)}` }];
}
const r1 = (n) => Math.round(n * 10) / 10;

function diffItems(probeName, metrics, protoItems, implItems, tol) {
  const diffs = [];
  if (protoItems.length !== implItems.length) {
    diffs.push({ probe: probeName, metric: '元素个数', proto: protoItems.length, impl: implItems.length });
    return diffs;
  }
  protoItems.forEach((p, i) => {
    const im = implItems[i];
    const tag = protoItems.length > 1 ? `${probeName}[${i + 1}]` : probeName;
    for (const m of metrics) {
      const pv = p[m], iv = im[m];
      if (pv === undefined) { diffs.push({ probe: tag, metric: m, proto: '(未采集)', impl: iv }); continue; }
      if (LENGTH_METRICS.has(m)) {
        const a = toPx(pv), b = toPx(iv);
        if (a === null || b === null) { if (String(pv) !== String(iv)) diffs.push({ probe: tag, metric: m, proto: pv, impl: iv }); continue; }
        if (Math.abs(a - b) > tol) diffs.push({ probe: tag, metric: m, proto: `${a}px`, impl: `${b}px`, delta: `${(b - a) > 0 ? '+' : ''}${Math.round((b - a) * 10) / 10}` });
      } else if (String(pv) !== String(iv)) {
        diffs.push({ probe: tag, metric: m, proto: pv, impl: iv });
      }
    }
  });
  return diffs;
}

/** 契约里的 ${VAR} 用环境变量展开 —— 演示/隔离/生产的地址不写死在契约里。 */
function expandEnv(str) {
  return String(str).replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    const v = process.env[name];
    if (!v) {
      throw Object.assign(new Error(
        `契约用到 \${${name}}，但环境变量没设。示例：${name}=http://localhost:8803 node scripts/visual-parity.mjs`
      ), { setup: true });
    }
    return v.replace(/\/+$/, '');
  });
}

function resolveUrl(spec) {
  if (spec.url) return expandEnv(spec.url);
  if (spec.file) return pathToFileURL(path.resolve(ROOT, spec.file)).href;
  throw Object.assign(new Error('契约的一侧既没有 url 也没有 file'), { setup: true });
}

function resolveLogin(spec) {
  if (!spec.login) return null;
  const envKey = spec.login.passwordEnv;
  const password = envKey ? process.env[envKey] : spec.login.password;
  if (!password) {
    throw Object.assign(new Error(
      `契约要求登录，但环境变量 ${envKey} 没设。示例：${envKey}=... node scripts/visual-parity.mjs`
    ), { setup: true });
  }
  return { ...spec.login, password };
}

async function runContract(cdp, contract, file) {
  const [width, height] = contract.viewport ?? [1440, 900];
  const tol = contract.tolerancePx ?? 1;
  const probes = contract.probes.map((p) => ({ name: p.name, all: !!p.all }));

  const protoProbes = contract.probes.map((p, i) => ({ ...probes[i], sel: p.proto }));
  const implProbes = contract.probes.map((p, i) => ({ ...probes[i], sel: p.impl }));

  const protoSession = await openPage(cdp, resolveUrl(contract.prototype), { width, height, login: null });
  await waitForSelectors(cdp, protoSession, contract.prototype.root, protoProbes.map((p) => p.sel));
  const protoData = await collect(cdp, protoSession, contract.prototype.root, protoProbes);

  const implSession = await openPage(cdp, resolveUrl(contract.impl),
    { width, height, login: resolveLogin(contract.impl) });
  await waitForSelectors(cdp, implSession, contract.impl.root, implProbes.map((p) => p.sel));
  const implData = await collect(cdp, implSession, contract.impl.root, implProbes);

  const diffs = [];
  contract.probes.forEach((p, i) => {
    const pd = protoData.probes[probes[i].name];
    const id = implData.probes[probes[i].name];
    if (pd?.error) throw Object.assign(new Error(`原型侧 ${p.name}: ${pd.error}`), { setup: true });
    if (id?.error) throw Object.assign(new Error(`实现侧 ${p.name}: ${id.error}`), { setup: true });
    diffs.push(...diffItems(probes[i].name, p.metrics, pd.items, id.items, tol));
    if (p.equalGaps) {
      diffs.push(...diffEqualGaps(probes[i].name, '原型', pd.gaps, tol));
      diffs.push(...diffEqualGaps(probes[i].name, '实现', id.gaps, tol));
    }
  });

  return { name: contract.name ?? path.basename(file), diffs, width, protoData, implData };
}

async function main() {
  const args = process.argv.slice(2);
  let files = args.filter((a) => !a.startsWith('-'));
  if (!files.length) {
    if (!existsSync(PARITY_DIR)) {
      console.log('没有比对契约目录 docs/design/parity/，跳过。');
      return 0;
    }
    files = (await readdir(PARITY_DIR)).filter((f) => f.endsWith('.json'))
      .map((f) => path.join(PARITY_DIR, f));
  }
  if (!files.length) { console.log('docs/design/parity/ 下没有契约文件，跳过。'); return 0; }

  const chrome = await launchChrome();
  const cdp = await Cdp.connect(chrome.wsUrl);
  let failed = 0;

  try {
    for (const file of files) {
      const contract = JSON.parse(await readFile(file, 'utf8'));
      const res = await runContract(cdp, contract, file);
      if (res.diffs.length) {
        failed++;
        console.log(`\n✗ ${res.name}  @${res.width}px  —— ${res.diffs.length} 处与原型不符`);
        const w = (s, n) => String(s).padEnd(n - [...String(s)].filter((c) => /[一-鿿]/.test(c)).length);
        console.log(`  ${w('位置', 22)}${w('项', 16)}${w('原型', 14)}${w('实现', 14)}差`);
        for (const d of res.diffs) {
          console.log(`  ${w(d.probe, 22)}${w(d.metric, 16)}${w(d.proto, 14)}${w(d.impl, 14)}${d.delta ?? ''}`);
        }
      } else {
        console.log(`✓ ${res.name}  @${res.width}px  与原型一致`);
      }
    }
  } finally {
    cdp.close();
    if (!(failed && process.env.VP_KEEP)) await chrome.kill();
    else console.log('\nVP_KEEP=1：Chrome 留着没关，自己 kill。');
  }

  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => {
  console.error(`\n跑不起来（不等于「一致」）：${err.message}`);
  if (!err.setup) console.error(err.stack);
  process.exit(2);
});
