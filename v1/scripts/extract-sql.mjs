/**
 * 把源码里的 SQL 字面量提取成一串 PREPARE 语句。
 *
 * PREPARE 会让 MySQL 解析并校验一条 SQL 的语法、表名、列名，但**不执行它**——
 * 对写语句同样安全。用它把「写了但生产从没跑过」的路径也验一遍。
 *
 * 2026-09-12 的由来：findStageEvidence 里写了 browser_operations.created_at，
 * 那张表没有这一列，生产上必然抛错，而 726 项单元测试全绿——因为测试里的
 * 数据库是假的，SQL 字符串从来没被执行过。
 *
 * 含 ${} 插值的 SQL 跳过（静态拼不出完整语句），它们会被单独列出来。
 */
import fs from 'node:fs';
import path from 'node:path';

const roots = ['src/db/repositories', 'src/services', 'src/workers'];
const files = roots.flatMap((dir) => fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f))
  : []);

// 必须以这些关键字**开头**才是可独立执行的语句。只是「包含」不行——
// 源码里大量的 `EXISTS (SELECT 1 FROM ...)`、`o.status = ? AND ...` 是拼进
// 大查询的条件片段，单独拿去 PREPARE 必然报语法错，全是假警报。
// 2026-09-12 第四次修这个提取器：嵌套模板、驱动批量插入语法、注释里的 SQL、
// 条件片段，每一次都是边界没想清楚就先跑起来。
const SQL_HEAD = /^\s*\(?\s*(SELECT|INSERT\s+(?:INTO|IGNORE)|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i;
const out = [];
const skipped = [];

for (const file of files) {
  // 先剥注释再提取：注释里常常抄着 SQL（比如修复时留下的「原来那句」），
  // 那些不是会执行的语句，验证它们只会制造假警报。2026-09-12 亲测：
  // 修了一条 SQL 并把旧写法写进注释，下一轮扫描就把注释里那句报成了错误。
  const src = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
  const lines = src.split('\n');
  for (const m of src.matchAll(/`([^`]*)`/gs)) {
    const body = m.group ? m.group(1) : m[1];
    if (!SQL_HEAD.test(body)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    if (body.includes('${')) { skipped.push(`${file}:${line}`); continue; }
    // 嵌套模板：外层含 ${fn(`...`)} 时，正则会切到内层，留下 ')}' 这类残片。
    // 残片不是真 SQL，验证它只会产生假警报。
    if (/[{}]/.test(body)) { skipped.push(`${file}:${line} (模板残片)`); continue; }
    // `VALUES ?` 是 mysql2 驱动的批量插入语法，驱动会展开成多组 VALUES，
    // 标准解析器不认。不是代码问题，跳过。
    if (/VALUES\s*\?\s*$/i.test(body.replace(/\s+/g, ' ').trim())) {
      skipped.push(`${file}:${line} (驱动批量插入)`); continue;
    }
    // 去掉 SQL 注释，压平空白；MySQL 的 PREPARE 接受单行语句
    const flat = body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!flat || !SQL_HEAD.test(flat)) continue;
    out.push({ file, line, sql: flat });
  }
}

const escaped = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "''");
const stmts = out.map((o, i) =>
  `SELECT '#${i} ${o.file}:${o.line}' AS probe;\nPREPARE p${i} FROM '${escaped(o.sql)}';\nDEALLOCATE PREPARE p${i};`
).join('\n');

fs.writeFileSync(process.argv[2] || '/tmp/sql-probe.sql', stmts + '\n');
fs.writeFileSync((process.argv[2] || '/tmp/sql-probe.sql') + '.index',
  out.map((o, i) => `#${i}\t${o.file}:${o.line}`).join('\n') + '\n');
console.error(`可验证 ${out.length} 条；跳过含插值的 ${skipped.length} 条`);
