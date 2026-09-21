#!/usr/bin/env node
// CSS 棘轮：硬编码只能减少，不能增加。
//
// 立于 2026-09-20，Lemon 定「三套 CSS 收敛成一套规范，并且持续更新优化」。
// 规范写在 docs/design/DESIGN_SYSTEM.md，但**规范不会自己执行**——没有闸门的话，
// 三周后又会多出一批字面色和第七种控件高度。所以这里立一个棘轮：
// 记下今天的数字当基线，以后只许降、不许升。降下来之后用 --update 把基线钉到新低点。
//
// 它只管「不倒退」，不管「好不好看」。后者归 scripts/visual-parity.mjs。
//
// 用法：
//   node scripts/css-drift-check.mjs            # 对照基线检查
//   node scripts/css-drift-check.mjs --update   # 把基线钉到当前（只在真的降下来之后用）
//
// 退出码：0=没有倒退；1=有倒退；2=跑不起来。

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = path.join(ROOT, 'v1/public/admin/assets');
const BASELINE = path.join(ROOT, 'docs/design/css-baseline.json');
const FILES = ['admin.css', 'workbench.css', 'cards.css', 'cdks.css', 'diagnostics.css'];

/** 规范里认可的控件高度（DESIGN_SYSTEM.md 第三节）。嵌套控件的 24 / 开关的 17 也在册。 */
const ALLOWED_HEIGHTS = new Set([17, 24, 28, 34, 44]);

/**
 * 剥掉 @media / @supports 整块（含嵌套），只留顶层规则。
 * 响应式里当然会重复写同一个选择器来覆盖 —— 那是正常做法，不是债。
 * 第一版没剥，把 `.wb-grp` 的响应式覆盖报成「重复定义」，是假阳性；
 * 判断工具的假阳性比报错危险，人会学会略过它。
 */
function stripAtBlocks(code) {
  let out = '', i = 0;
  while (i < code.length) {
    const at = code.indexOf('@', i);
    if (at === -1) { out += code.slice(i); break; }
    const head = code.slice(at, at + 10);
    if (!/^@(media|supports|container)\b/.test(head)) { out += code.slice(i, at + 1); i = at + 1; continue; }
    out += code.slice(i, at);
    const open = code.indexOf('{', at);
    if (open === -1) { i = code.length; break; }
    let depth = 1, j = open + 1;
    while (j < code.length && depth > 0) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') depth--;
      j++;
    }
    i = j;
  }
  return out;
}

function analyze(css) {
  // 注释里的内容不算 —— 说明文字里出现色值不是债
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // 字面颜色。:root 的 token 定义本身当然是字面值，那是唯一该出现的地方，排除掉。
  const rootBlocks = [...code.matchAll(/:root\s*\{[\s\S]*?\}/g)].map((m) => m[0]).join('\n');
  const outsideRoot = code.split(/:root\s*\{[\s\S]*?\}/).join('\n');
  const colorRe = /(#[0-9a-fA-F]{3,8}\b|\bhsla?\([^)]*\)|\brgba?\([^)]*\))/g;
  const literalColors = (outsideRoot.match(colorRe) || []).length;

  // 规范外的控件高度
  const heights = [...outsideRoot.matchAll(/height:\s*(\d+)px/g)].map((m) => Number(m[1]));
  const offScale = heights.filter((h) => h >= 16 && !ALLOWED_HEIGHTS.has(h));

  // 同一个选择器在同一份文件里被定义多次 —— .wb-cdk 就是这么互相打架的
  const selectors = [...stripAtBlocks(code).matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)]
    .map((m) => m[2].trim().replace(/\s+/g, ' '))
    .filter((s) => s && !s.startsWith('@') && !/^\d/.test(s));
  const seen = new Map();
  for (const sel of selectors) seen.set(sel, (seen.get(sel) || 0) + 1);
  const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([s, n]) => `${s} ×${n}`);

  return {
    literalColors,
    offScaleHeights: offScale.length,
    offScaleValues: [...new Set(offScale)].sort((a, b) => a - b),
    duplicatedSelectors: duplicated.length,
    duplicatedList: duplicated.slice(0, 8),
    rootTokens: (rootBlocks.match(/--[a-z0-9-]+\s*:/g) || []).length
  };
}

const current = {};
for (const f of FILES) {
  try {
    current[f] = analyze(await readFile(path.join(CSS_DIR, f), 'utf8'));
  } catch (err) {
    console.error(`读不到 ${f}：${err.message}`);
    process.exit(2);
  }
}

if (process.argv.includes('--update')) {
  const payload = {
    note: '硬编码棘轮的基线，只许降不许升。规范见 docs/design/DESIGN_SYSTEM.md。'
      + '降下来之后用 node scripts/css-drift-check.mjs --update 钉到新低点。',
    updatedAt: new Date().toISOString().slice(0, 10),
    files: Object.fromEntries(FILES.map((f) => [f, {
      literalColors: current[f].literalColors,
      offScaleHeights: current[f].offScaleHeights,
      duplicatedSelectors: current[f].duplicatedSelectors
    }]))
  };
  await writeFile(BASELINE, JSON.stringify(payload, null, 2) + '\n');
  console.log('基线已钉到当前：');
  for (const f of FILES) {
    const c = current[f];
    console.log(`  ${f.padEnd(15)} 字面色 ${String(c.literalColors).padStart(3)}`
      + ` / 规范外高度 ${String(c.offScaleHeights).padStart(2)}`
      + ` / 重复选择器 ${String(c.duplicatedSelectors).padStart(2)}`);
  }
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(await readFile(BASELINE, 'utf8'));
} catch {
  console.error(`没有基线文件 ${path.relative(ROOT, BASELINE)}。`
    + '第一次用先跑：node scripts/css-drift-check.mjs --update');
  process.exit(2);
}

const METRICS = [
  ['literalColors', '字面颜色（该走 var(--wb-*)）'],
  ['offScaleHeights', '规范外的控件高度'],
  ['duplicatedSelectors', '同文件内重复定义的选择器']
];

const regressions = [];
const improvements = [];
for (const f of FILES) {
  const base = baseline.files?.[f];
  if (!base) { regressions.push(`${f}: 基线里没有这份文件，跑 --update 补上`); continue; }
  for (const [key, label] of METRICS) {
    const was = base[key], now = current[f][key];
    if (now > was) {
      let detail = `${f} 的${label}从 ${was} 涨到 ${now}`;
      if (key === 'offScaleHeights') detail += `（这些值不在阶梯上：${current[f].offScaleValues.join(', ')}）`;
      if (key === 'duplicatedSelectors' && current[f].duplicatedList.length) {
        detail += `\n         重复的：${current[f].duplicatedList.join('、')}`;
      }
      regressions.push(detail);
    } else if (now < was) {
      improvements.push(`${f} 的${label}从 ${was} 降到 ${now}`);
    }
  }
}

for (const i of improvements) console.log(`  ↓ ${i}`);
if (improvements.length) {
  console.log('\n降下来了 —— 跑 node scripts/css-drift-check.mjs --update 把基线钉到新低点，');
  console.log('否则下次又涨回去也不会有人发现。');
}

if (regressions.length) {
  console.log(`\n✗ ${regressions.length} 处倒退：`);
  for (const r of regressions) console.log(`  · ${r}`);
  console.log('\n规范见 docs/design/DESIGN_SYSTEM.md。要用规范外的值，先改规范再改代码。');
  process.exit(1);
}

console.log(`✓ 没有倒退（基线 ${baseline.updatedAt}）`);
process.exit(0);
