// 形状快照的读写与整理（refresh / seed / verify 共用）。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS, parseMysqlJsonCell } from './shape-queries.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SHAPE_PATH = path.join(here, 'shape.json');
export const REPO_ROOT = path.resolve(here, '..', '..', '..');
export const SHAPE_VERSION = 1;

/** 数组按内容排序，快照文件与比对都不受 JSON_ARRAYAGG 的顺序影响。 */
function stableSort(rows) {
  return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/** 把各节的原始查询结果整理成快照形状：心跳换成「距抓取多少秒」，数组排序。 */
export function normalizeSections(raw) {
  const out = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name === 'settings') {
      const dbNow = Date.parse(value?.dbNow || '');
      const heartbeatAges = {};
      for (const [key, at] of Object.entries(value?.heartbeats || {})) {
        const ts = Date.parse(String(at || ''));
        heartbeatAges[key] = Number.isFinite(ts) && Number.isFinite(dbNow) ? Math.max(0, Math.round((dbNow - ts) / 1000)) : null;
      }
      out.settings = {
        values: value?.values || {},
        heartbeatAges,
        highvccToken: value?.highvccToken || { configured: false, ageSeconds: null },
        dailyReport: value?.dailyReport || null
      };
    } else if (name === 'cards' && Array.isArray(value)) {
      // 流水签名里各段的先后取决于库的排序规则（生产按二进制、本机不分大小写），统一成不分大小写排序再比
      out.cards = stableSort(value.map((row) => ({
        ...row,
        txSignature: row.txSignature == null ? null
          : String(row.txSignature).split(',').sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join(',')
      })));
    } else if (Array.isArray(value)) {
      out[name] = stableSort(value);
    } else if (value && typeof value === 'object' && name === 'config') {
      out.config = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, Array.isArray(v) ? stableSort(v) : v]));
    } else {
      out[name] = value;
    }
  }
  return out;
}

/**
 * 各节拼成**一条** SELECT 执行（runner(sql) → mysql 单元格文本或已解析值）。
 * 一条语句＝一个一致性读视图：生产在抓取途中来了新单、分了卡，各节之间也不会互相对不上
 * （分节各跑一次时就撞上过：卡那一节已看到占用，「剩几张」那一节还没看到）。
 */
export async function buildSnapshotSql() {
  const parts = [];
  for (const [name, build] of Object.entries(SECTIONS)) parts.push(`'${name}', (${await build()})`);
  return `SELECT JSON_OBJECT(${parts.join(',\n')})`;
}

export async function collectSections(runner) {
  const cell = await runner(await buildSnapshotSql(), 'snapshot');
  const raw = typeof cell === 'string' ? parseMysqlJsonCell(cell) : cell;
  if (!raw || typeof raw !== 'object') throw new Error('快照查询没有返回结果');
  return normalizeSections(raw);
}

/** 生产只读：每节一次 prod-query.sh（它经 13306 隧道、凭证不落盘；只读，不写）。 */
export function prodRunner() {
  const script = path.join(REPO_ROOT, 'browser-mvp', 'scripts', 'prod-query.sh');
  return (sql, name) => {
    try {
      return execFileSync(script, [sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      const detail = String(error.stderr || error.message || '').split('\n').filter(Boolean).slice(-2).join(' / ');
      throw new Error(`生产只读查询「${name}」失败：${detail}`);
    }
  };
}

/** 本机：用传入的 mysql2 连接池执行；取第一行第一列。 */
export function poolRunner(pool) {
  return async (sql) => {
    const [rows] = await pool.query({ sql, rowsAsArray: true });
    const cell = rows?.[0]?.[0];
    if (cell == null) return null;
    return typeof cell === 'string' ? JSON.parse(cell) : cell;
  };
}

export function readShape(file = SHAPE_PATH) {
  const shape = JSON.parse(readFileSync(file, 'utf8'));
  if (shape.version !== SHAPE_VERSION) throw new Error(`shape.json version ${shape.version} != ${SHAPE_VERSION}`);
  return shape;
}

export function writeShape(sections, { file = SHAPE_PATH, capturedAt = new Date() } = {}) {
  const shape = {
    version: SHAPE_VERSION,
    capturedAt: capturedAt.toISOString(),
    source: 'production aggregates via browser-mvp/scripts/prod-query.sh (read-only; GROUP BY + COUNT/SUM/buckets only)',
    note: '只有聚合数与非敏感枚举；本机造数据按它生成，每一行都是假的。重新抓取：scripts/local-admin.sh refresh-shape',
    ...sections
  };
  writeFileSync(file, `${JSON.stringify(shape, null, 2)}\n`);
  return shape;
}
