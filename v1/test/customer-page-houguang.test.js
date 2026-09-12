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

test('不承诺具体秒数：只说「通常几分钟之内完成」', () => {
  assert.match(js, /通常几分钟之内完成/);
  // 「一两分钟」「约 3 分钟」「30 秒」这类具体时长都违反规则；真实一单
  // 约 5 分钟且依赖本机执行器在跑，写死时间就是在给客户一个会破的承诺。
  const promises = all.match(/[一二两三四五六七八九十\d]+\s*[-~到]?\s*[一二两三四五六七八九十\d]*\s*(秒钟|秒|分钟)(之内|以内|内|左右|完成)?/g) || [];
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

test('百分比逼近上限但不冲线，只有订阅成功才置 100', () => {
  // 与后端 stagePercent 同一条曲线，并同样钳在上限下方一整个百分点。
  assert.match(js, /1 - Math\.exp\(-2\.6 \* t\)/);
  assert.match(js, /Math\.min\(.*, ceiling - 1\);/);
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

test('每一屏的明细与按钮照设计稿：等待中不给查询码，出问题才给', () => {
  // 设计稿 run 屏只有「订单/账号/方案」，done 是「订阅方案/账号/开通时间/
  // 查询码」，stuck 是「订单/账号/查询码」。正常等待几分钟不需要查询码，
  // 给了反而像在说「可以关掉了」。
  assert.match(js, /rows\.push\(\['订阅方案', label, true\]\)/);
  assert.match(js, /if \(ticket\) rows\.push\(\['查询码', order\.publicNo\]\)/);
  assert.match(js, /REVIEWING:\s*\{[^}]*ticket: true/);
  assert.match(js, /SUCCESS:\s*\{[^}]*ticket: true/);
  assert.match(js, /QUEUED:\s*\{(?![^}]*ticket)[^}]*\}/);
  // 「兑换另一张卡密」没有业务依据（卡密一张一张卖，出问题时码会自动退回），
  // 而且摆在等待屏会把客户带离进度页。
  assert.doesNotMatch(all, /兑换另一张卡密/);
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
