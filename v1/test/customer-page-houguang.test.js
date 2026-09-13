import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * 候光定稿的硬规则与踩过的坑（docs/design/README.md）。
 * 每一条都违反过一次，所以写成断言而不是注释。
 */
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'assets', 'customer.css'), 'utf8');
const js = fs.readFileSync(path.join(publicDir, 'assets', 'customer.js'), 'utf8');
const all = `${html}\n${css}\n${js}`;

/** 面向客户的文案：剥掉注释，注释里写具体数值是给维护者看的，不是承诺。 */
const prose = [html, css, js]
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

test('不承诺具体秒数：只说「通常几分钟之内完成」', () => {
  assert.match(js, /通常几分钟之内完成/);
  // 「一两分钟」「约 3 分钟」「30 秒」这类具体时长都违反规则；真实一单
  // 约 5 分钟且依赖本机执行器在跑，写死时间就是在给客户一个会破的承诺。
  const promises = prose.match(/[一二两三四五六七八九十\d]+\s*[-~到]?\s*[一二两三四五六七八九十\d]*\s*(秒钟|秒|分钟)(之内|以内|内|左右|完成)?/g) || [];
  const offending = promises.filter((text) => !/几分钟/.test(text));
  assert.deepEqual(offending, [], `页面出现了具体时长承诺：${offending.join(' / ')}`);
});

test('末步叫「订阅成功」，不叫充值成功', () => {
  assert.match(js, /SUBSCRIPTION_ACTIVE/);
  assert.doesNotMatch(all, /充值成功/);
  assert.doesNotMatch(all, /充值完成/);
});

test('不向客户展示「自动续费已关闭」', () => {
  assert.doesNotMatch(all, /自动续费/);
  assert.doesNotMatch(all, /续费已关闭/);
});

test('不用「会话数据」「登录数据」这类说法，按来源叫 Session 和 Token 页面', () => {
  assert.doesNotMatch(all, /会话数据/);
  assert.doesNotMatch(all, /登录数据/);
  assert.match(html, /Session/);
  assert.match(html, /Token 页面/);
});

test('风控提醒是固定文案，不自行补写后果', () => {
  assert.match(html, /订阅已生效,不用再做任何操作。/);
  assert.match(html, /请不要在 ChatGPT 设置里的「升级套餐」中点击升级,这类操作容易触发官方风控。/);
});

test('出问题时对客户说实话，不说「已转人工」也不给原因', () => {
  assert.match(js, /遇到点问题,我们已经收到通知在处理/);
  assert.doesNotMatch(all, /已转入人工核对/);
  assert.doesNotMatch(all, /已由人工接手核对/);
});

test('百分比段内匀速、不冲线，只有订阅成功才置 100', () => {
  // 与后端 stagePercent 同一条曲线：段内线性，按后端给的 typicalMs 走完本段区间
  // （2026-09-13 D-193 从指数改线性，Lemon：「一段快一段慢，我希望尽可能是匀速」）。
  assert.match(js, /const budget = Number\(stage\.typicalMs\) \|\| SEGMENT_MS;/);
  assert.match(js, /if \(t <= 1\) return floor \+ reach \* 0\.94 \* t;/);
  assert.doesNotMatch(js, /Math\.exp\(-2\.6/);
  // 超时后仍要动：停住的环和卡死的环长得一样。
  assert.match(js, /0\.94 \+ 0\.06 \* \(1 - Math\.exp\(-1\.5 \* \(t - 1\)\)\)/);
  // 前端不存第二份阶段表——typicalMs 只能从后端给的 stage 上读。
  assert.doesNotMatch(js, /ORDER_RECEIVED:\s*\{[^}]*ceiling/);
  assert.match(js, /const cap = ceiling - 1;/);
  assert.match(js, /if \(stage\.index >= stage\.total\) \{ paintRing\(100\); return; \}/);
});

test('踩过的坑：环里的对勾用子选择器旋转，不能连带转 90 度', () => {
  assert.match(css, /\.ring>svg\{[^}]*rotate\(-90deg\)/);
  // .ring svg 是后代选择器，会把对勾那个 svg 一起转。
  assert.doesNotMatch(css, /\.ring\s+svg\s*\{[^}]*rotate/);
});

test('踩过的坑：媒体查询不能跟选择器并列写在同一条规则里', () => {
  // `选择器, @media(...){...}` 是无效 CSS，会让其后的样式全部失效。
  assert.doesNotMatch(css, /,\s*@media/);
});

test('踩过的坑：弱化用字号和颜色，字重不得低于 400', () => {
  const weights = [...css.matchAll(/font-weight:\s*(\d{3})/g)].map((match) => Number(match[1]));
  assert.ok(weights.length > 0, 'stylesheet should set some weights');
  // 中文系统字体只有离散字重，440 会被渲染成 400，等于没写。
  for (const weight of weights) {
    assert.ok(weight >= 400, `font-weight:${weight} 低于 400`);
    assert.equal(weight % 100, 0, `font-weight:${weight} 不是中文字体支持的档位`);
  }
});

test('踩过的坑：卡片不用顶部彩色横条，改上沿内高光加分层投影', () => {
  assert.match(css, /--shadow-card:inset 0 1px 0/);
  assert.doesNotMatch(css, /border-top:\s*\d+px solid var\(--a\)/);
});

test('九阶段的文案齐全，且与后端阶段码一一对应', async () => {
  const { CUSTOMER_STAGES } = await import('../src/domain/customer-stage.js');
  for (const stage of CUSTOMER_STAGES) {
    assert.match(js, new RegExp(`${stage.code}:`), `前端缺少 ${stage.code} 的文案`);
  }
  assert.match(js, /const SEGMENT_MS = 90000/);
});

test('双主题：浅色令牌在裸 :root 上定义，深色只覆盖令牌', () => {
  const rootBlock = css.slice(css.indexOf(':root{'), css.indexOf('@media (prefers-color-scheme:dark)'));
  for (const token of ['--bg', '--a', '--t', '--s', '--bd', '--warn', '--gold', '--glow']) {
    assert.match(rootBlock, new RegExp(`${token}:`), `${token} 必须先在裸 :root 上定义`);
  }
  // 系统「跟随」状态不带 data-theme，只有 prefers-color-scheme 能区分；
  // 显式选浅色时又必须压过深色系统设置。
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{/);
  assert.match(css, /:root\[data-theme="dark"\]\{/);
  // 宿主在自己的主题里绘制底色，body 不上背景就会借到对面主题的底。
  assert.match(css, /body\{[^}]*background:var\(--bg\)/);
});

test('减少动态效果时关掉全部动画', () => {
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)'));
  for (const name of ['.glow::after', '.screen', '.stage-name', '.ring__tick', '.arrow']) {
    assert.ok(block.includes(name), `${name} 没有在减少动态效果里关掉`);
  }
  assert.match(js, /prefers-reduced-motion: reduce/);
});

test('字体与设计稿同款，但自托管、不走 Google 域名', () => {
  // 国内连不上 fonts.googleapis.com：直接引用会静默回落成系统字体，
  // 页面就会像 2026-09-12 那版一样「小了一号、没那么高级」。
  assert.doesNotMatch(all, /fonts\.googleapis\.com/);
  assert.doesNotMatch(all, /fonts\.gstatic\.com/);
  assert.match(css, /--fd:"Familjen Grotesk"/);
  assert.match(css, /--fm:"IBM Plex Mono"/);
  const faces = [...css.matchAll(/url\((\/assets\/fonts\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(faces.length >= 4, '两款字体的 @font-face 都要在');
  for (const href of faces) {
    assert.ok(fs.existsSync(path.join(publicDir, href.slice(1))), `${href} 指向的文件不存在`);
  }
  // 字体没到之前先用系统字体渲染，不把首屏吊住。逐块检查，别去数全文
  // 出现次数——注释里也会写到这个词。
  const blocks = css.split('@font-face').slice(1);
  assert.equal(blocks.length, faces.length);
  for (const block of blocks) assert.match(block.slice(0, 240), /font-display:swap/);
});

test('内容宽度与设计稿一致：原型卡片 916px，窄了就会显得局促', () => {
  assert.match(css, /\.shell\{max-width:916px/);
});

test('Session 全文不回显，建单成功后立刻清空', () => {
  assert.match(js, /el\.session\.value = '';/);
  assert.match(js, /pending\.session = null;/);
  // 页面只回显邮箱与昵称这两个供客户核对的字段。
  assert.doesNotMatch(js, /accessToken\s*[:=]\s*[^'"\s]/);
});

test('客户页不露订单号：只用卡密，方案显示短名', () => {
  // 2026-09-13 Lemon 定：「客户的充值页面里边有很多查询码，我们不要查询码，
  // 我们只保留 CDK 就好」。设计稿原来在 done/stuck 屏给查询码（= 订单号），
  // 现在整条去掉——客户手上本来就有卡密，回来查用卡密即可，不必再记一串码。
  // 客服侧不受影响：后台搜索与 find-order-by-cdk.mjs 都能按 CDK 查到单。
  assert.doesNotMatch(js, /rows\.push\(\['查询码'/);
  assert.doesNotMatch(js, /rows\.push\(\['订单', order\.publicNo\]\)/);
  assert.doesNotMatch(all, /复制查询码/);
  // 订阅方案给短名：后端 label 是 'ChatGPT Plus'，客户页只要 'Plus'（同日 Lemon 定）。
  assert.match(js, /rows\.push\(\['订阅方案', label, true\]\)/);
  assert.match(js, /const label = productShortName\(order\);/);
  assert.match(js, /REVIEWING:\s*\{[^}]*ticket: true/);
  assert.match(js, /SUCCESS:\s*\{[^}]*ticket: true/);
  assert.match(js, /QUEUED:\s*\{(?![^}]*ticket)[^}]*\}/);
  // 「兑换另一张卡密」没有业务依据（卡密一张一张卖，出问题时码会自动退回），
  // 而且摆在等待屏会把客户带离进度页。
  assert.doesNotMatch(all, /兑换另一张卡密/);
});

test('付款结果确认中是正常态，不是故障态（2026-09-13 修）', () => {
  // 客户在钱已经付掉、Plus 已经开通的那几秒，不能看到橙色的「遇到点问题」。
  // SUBMIT_UNKNOWN → VERIFYING（见 src/services/order-status-service.js），本页把它
  // 按正常态渲染；轮询也不能比这一段本身还慢，否则成功要等下一轮才显示。
  assert.match(js, /VERIFYING:\s*\{\s*tone: 'ok'/);
  assert.match(js, /VERIFYING:[\s\S]{0,80}poll: 3000/);
  assert.match(js, /CONFIRMING:\s*\{\s*tone: 'ok',\s*poll: 3000/);
  // 但真卡住不动仍要照实说：按阶段停留时长降级，而不是靠状态本身表达故障。
  assert.match(js, /VERIFYING_PATIENCE_MS/);
  assert.match(js, /function resolveView/);
});

test('进度环不跳：换段与跑完都是过渡，不是瞬移', () => {
  // 阶段会跳级，且各阶段实际停留时长差很多（2026-09-13 实测一单里阶段 4 只有 18 秒、
  // 阶段 7 只有 8.8 秒，而阶段 8 三个操作同事务提交、完全没有停留时间），
  // 直接画目标值就是一连串闪跳。换段按差距逐帧追，跑完那一下滑过去。
  assert.match(js, /const gap = want - shownPct;/);
  assert.match(js, /function glideTo/);
  assert.match(js, /if \(shownPct > 0 && shownPct < 100\) glideTo\(100\);/);
});

test('出问题时标题保留当前阶段名，客户要知道卡在哪一步', () => {
  // 设计稿 stuck 屏的标题仍是「正在提交支付」，换掉的只是下面那行说明。
  assert.match(js, /const name = stage \? stage\.label : '处理中';/);
  assert.doesNotMatch(js, /name: '遇到点问题'/);
  assert.match(js, /REVIEWING:[\s\S]{0,160}hint: '遇到点问题/);
});

test('查询屏就地给答案，不把客户推进完整进度页', () => {
  assert.match(html, /id="query-result"/);
  assert.match(html, /id="query-risk"/);
  // 查询屏也带风控提醒，与设计稿一致
  const queryScreen = html.slice(html.indexOf('id="view-query"'), html.indexOf('</section>', html.indexOf('id="view-query"')));
  assert.match(queryScreen, /升级套餐/);
  assert.match(js, /已开通/);
});

test('核对账号那一屏用服务端同一套规则做本地预检，两边不漂移', async () => {
  const { REQUIRED_SESSION_FIELDS, MINIMUM_ACCESS_TOKEN_LIFETIME_SECONDS }
    = await import('../src/domain/session-validation.js');
  const start = js.indexOf('function checkSession');
  const end = js.indexOf('function refreshSessionPreview');
  assert.ok(start > 0 && end > start, '找不到本地预检函数');
  const check = js.slice(start, end);
  for (const field of REQUIRED_SESSION_FIELDS) {
    const leaf = field.split('.').pop();
    assert.match(check, new RegExp(`\\b${leaf}\\b`), `本地预检没有覆盖 ${field}`);
  }
  // 与服务端同一个门槛，两边必须是同一个数。
  assert.match(check, new RegExp(`payload\\.exp - nowSeconds < ${MINIMUM_ACCESS_TOKEN_LIFETIME_SECONDS}`));
  // 不变量 1：填写页只在本地解析，绝不发请求。
  assert.doesNotMatch(check, /fetch\(|api\./);
});

test('不对客户断言我们没有检查过的事', () => {
  // 设计稿那句「当前为免费账号,可以开通」要真的查过账号才能说。现在只做
  // 了本地结构预检，所以只说结构完整。等联网检查上线再换回设计稿原话。
  assert.match(js, /账号信息完整,可以继续/);
  assert.doesNotMatch(js, /当前为免费账号/);
});
