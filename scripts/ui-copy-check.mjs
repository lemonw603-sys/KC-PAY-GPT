#!/usr/bin/env node
// 界面文案闸门：运营页面上不许出现内部编号和开发备忘。
//
// Lemon 说过两次「我要的是简洁，设计感，不是让你在这给我做解释」「你搞这么多字干什么」。
// 规矩写在 docs/design/DESIGN_SYSTEM.md 第五节，但规矩不会自己执行 —— 2026-09-20 实查，
// 数字墙上挂着「口径待定（D-284 ③）」「按卡台，聚合待写」，卡片页上写着
// 「能力保留，只是平时不用，收进这里（D-280 ⑧）」。全是写给自己看的话，摆在运营页面上。
//
// 用法：node scripts/ui-copy-check.mjs
// 退出码：0=干净；1=有违规；2=跑不起来。
//
// 只看**会显示给人**的文本：JS 里带中文的字符串字面量、HTML 里的可见文本。
// 代码注释不算 —— 注释就是写给自己看的，本来就该写。

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = [
  'v1/public/admin/assets/admin.js',
  'v1/public/admin/assets/cdks.js',
  'v1/public/admin/assets/diagnostics.js',
  'v1/public/admin/index.html',
  'v1/public/index.html'
];

/** 内部编号：D-244 / F-65 这类决策与发现编号。 */
const INTERNAL_ID = /\b[DF]-\d{1,4}\b/;
/** 开发备忘用语：这些词出现在界面上，说明那句话是写给自己看的。 */
const DEV_MEMO = /(待写|待定|口径未定|聚合待写|TODO|FIXME|暂未实现|见代码|参见文档)/;

/**
 * JS 侧按**行**扫：先整体剥掉块注释，再逐行剥掉行尾注释，剩下的当「可能显示给人的文本」。
 *
 * 为什么不做词法分析：第一版逐字符配对引号，结果模板串里的 `${escapeHtml('x')}` 有嵌套引号，
 * 配对当场错位，35 处报出来全是注释里的编号——假阳性比报错危险，人会学会略过它。
 * 按行扫会把多行模板串拆散，但「这一行有中文又有 D-xxx」这个判断照样成立，
 * 而且不会因为一处配对错就全篇跑偏。
 */
function scanJsLines(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length));
  return noBlock.split('\n').map((raw, i) => {
    // 行尾注释：第一个前面不是冒号的 //（避开 https:// 这种）
    const m = raw.match(/(^|[^:])\/\//);
    const text = m ? raw.slice(0, m.index + m[1].length) : raw;
    return { text: text.trim(), line: i + 1 };
  });
}

/** HTML 的可见文本：剥注释、script、style，剩下标签之间的内容。 */
function scanHtmlText(src) {
  const cleaned = src
    .replace(/<!--[\s\S]*?-->/g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/<script[\s\S]*?<\/script>/gi, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/<style[\s\S]*?<\/style>/gi, (m) => '\n'.repeat((m.match(/\n/g) || []).length));
  const out = [];
  cleaned.split('\n').forEach((raw, idx) => {
    const text = raw.replace(/<[^>]*>/g, ' ').trim();
    if (text) out.push({ text, line: idx + 1 });
  });
  return out;
}

let violations = 0;
for (const rel of TARGETS) {
  let src;
  try {
    src = await readFile(path.join(ROOT, rel), 'utf8');
  } catch {
    continue;   // 文件不存在就跳过，不是这支脚本该管的事
  }
  const items = rel.endsWith('.js') ? scanJsLines(src) : scanHtmlText(src);
  const hits = [];
  for (const { text, line } of items) {
    if (!/[一-鿿]/.test(text)) continue;        // 只看给人看的中文
    const id = INTERNAL_ID.test(text);
    const memo = DEV_MEMO.test(text);
    if (!id && !memo) continue;
    // 「待接入」是给运营看的正当状态词，不是开发备忘
    if (memo && !id && /^待接入$/.test(text.trim())) continue;
    hits.push({ line, why: [id && '内部编号', memo && '开发备忘'].filter(Boolean).join(' + '),
      text: text.replace(/\s+/g, ' ').slice(0, 90) });
  }
  if (hits.length) {
    violations += hits.length;
    console.log(`\n✗ ${rel}`);
    for (const h of hits) console.log(`  ${String(h.line).padStart(5)}  [${h.why}]  ${h.text}`);
  }
}

if (violations) {
  console.log(`\n共 ${violations} 处写给自己看的话出现在界面上。`);
  console.log('规矩见 docs/design/DESIGN_SYSTEM.md 第五节：界面不写解释旁白，内部编号一个都不许。');
  process.exit(1);
}
console.log('✓ 界面文案干净（没有内部编号，没有开发备忘）');
process.exit(0);
