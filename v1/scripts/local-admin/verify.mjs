// 造好数后，拿同一组快照查询跑本机库，逐节和 shape.json 比：个数与分布一致才算「形状一样」。
// 金额平均值、时间「距今多少秒」这类随造数取值而变的字段不比（列在 IGNORED 里）；其余逐组逐个数比。
import { collectSections, poolRunner } from './shape.mjs';

/** 每节里不参与比对的字段（取值型、时间型）。 */
const IGNORED = {
  orders: ['avgPayment', 'avgDurationSeconds'],
  ledger: ['amount'],
  cardTransactions: ['amount', 'originalAmount', 'fee'],
  stockJobs: ['amount'],
  syncJobs: ['avgLatencySeconds', 'within24h'],
  cardIntakeStuck: ['firstSeenAgeSeconds'],
  providers: ['supplyFaultAgeSeconds', 'lastFullSnapshotAgeSeconds', 'walletAgeSeconds', 'balanceSnapshots'],
  hnskjSnapshot: ['ageSeconds'],
  cdkBatches: ['requestedCount']
};
/** 只作参考、不计入通过与否的节（造数只保证「有」，不保证逐条同数）。 */
const INFORMATIONAL = new Set(['orderEvents', 'alertNotifications', 'syncJobs']);

const strip = (row, ignored = []) => Object.fromEntries(Object.entries(row).filter(([k]) => !ignored.includes(k)));
const normalizeValue = (value) => {
  if (value === true) return 1;
  if (value === false) return 0;
  if (typeof value === 'number') return Number(value.toFixed(6));
  if (typeof value === 'string' && /^-?\d+\.\d+$/.test(value)) return Number(Number(value).toFixed(6));
  // 库里字符串比较不分大小写（utf8mb4_unicode_ci），GROUP BY 会把 SUCCESS / success 并成一组、取先遇到的写法
  if (typeof value === 'string') return value.toLowerCase();
  return value;
};
const keyOf = (row) => JSON.stringify(Object.keys(row).sort().filter((k) => k !== 'count').map((k) => [k, normalizeValue(row[k])]));

function compareGroups(expected, actual, ignored) {
  const tally = (rows) => {
    const map = new Map();
    for (const row of rows || []) {
      const clean = strip(row, ignored);
      const key = keyOf(clean);
      map.set(key, (map.get(key) || 0) + Number(clean.count ?? 1));
    }
    return map;
  };
  const e = tally(expected);
  const a = tally(actual);
  const diffs = [];
  for (const key of new Set([...e.keys(), ...a.keys()])) {
    if ((e.get(key) || 0) !== (a.get(key) || 0)) diffs.push({ group: Object.fromEntries(JSON.parse(key)), expected: e.get(key) || 0, actual: a.get(key) || 0 });
  }
  return diffs;
}

function compareObject(expected, actual, ignored = []) {
  const e = expected ? strip(expected, ignored) : null;
  const a = actual ? strip(actual, ignored) : null;
  const diffs = [];
  for (const key of new Set([...Object.keys(e || {}), ...Object.keys(a || {})])) {
    if (JSON.stringify(normalizeValue(e?.[key]) ?? null) !== JSON.stringify(normalizeValue(a?.[key]) ?? null)
      && JSON.stringify(e?.[key] ?? null) !== JSON.stringify(a?.[key] ?? null)) {
      diffs.push({ field: key, expected: e?.[key] ?? null, actual: a?.[key] ?? null });
    }
  }
  return diffs;
}

export async function verifyAgainstShape(pool, shape) {
  const actual = await collectSections(poolRunner(pool));
  const results = [];
  for (const name of Object.keys(actual)) {
    const expected = shape[name];
    let diffs;
    if (name === 'settings') {
      diffs = [
        ...compareObject(expected?.values, actual.settings.values).map((d) => ({ ...d, field: `values.${d.field}` })),
        ...compareObject({ configured: expected?.highvccToken?.configured }, { configured: actual.settings.highvccToken?.configured }),
        ...Object.keys(expected?.heartbeatAges || {})
          .filter((k) => (expected.heartbeatAges[k] == null) !== (actual.settings.heartbeatAges?.[k] == null))
          .map((k) => ({ field: `heartbeat.${k}`, expected: expected.heartbeatAges[k], actual: actual.settings.heartbeatAges?.[k] ?? null }))
      ];
    } else if (name === 'config') {
      diffs = Object.keys(expected || {}).flatMap((k) => compareGroups(expected[k], actual.config?.[k], [])
        .map((d) => ({ ...d, part: k })));
    } else if (Array.isArray(expected) || Array.isArray(actual[name])) {
      diffs = compareGroups(expected || [], actual[name] || [], IGNORED[name] || []);
    } else {
      diffs = compareObject(expected, actual[name], IGNORED[name] || []);
    }
    results.push({ name, ok: diffs.length === 0, informational: INFORMATIONAL.has(name), diffs });
  }
  return { ok: results.every((r) => r.ok || r.informational), results, actual };
}

export function formatVerifyReport({ ok, results }) {
  const lines = results.map((r) => {
    const mark = r.ok ? '一致' : r.informational ? '参考（不计）' : '不一致';
    const head = `  [${mark}] ${r.name}${r.ok ? '' : `：${r.diffs.length} 处差异`}`;
    if (r.ok) return head;
    const detail = r.diffs.slice(0, 6).map((d) => `      ${describeDiff(d, r.diffs)}`);
    return [head, ...detail, ...(r.diffs.length > 6 ? [`      … 另 ${r.diffs.length - 6} 处`] : [])].join('\n');
  });
  return [`形状比对：${ok ? '全部一致' : '有不一致'}`, ...lines].join('\n');
}

/** 一组对不上时，找另一侧最像的那组，只列不同的字段（比整行好读）。 */
function describeDiff(diff, all) {
  if (!diff.group) return JSON.stringify(diff);
  const side = diff.expected > diff.actual ? 'actual' : 'expected';
  const others = all.filter((d) => d.group && d !== diff && d[side] > (side === 'actual' ? d.expected : d.actual));
  let best = null; let bestDelta = null;
  for (const other of others) {
    const delta = Object.keys({ ...diff.group, ...other.group })
      .filter((k) => JSON.stringify(diff.group[k]) !== JSON.stringify(other.group[k]))
      .map((k) => `${k}: 快照 ${JSON.stringify(side === 'actual' ? diff.group[k] : other.group[k])} / 本机 ${JSON.stringify(side === 'actual' ? other.group[k] : diff.group[k])}`);
    if (!bestDelta || delta.length < bestDelta.length) { best = other; bestDelta = delta; }
  }
  const head = `快照 ${diff.expected} 组 / 本机 ${diff.actual} 组`;
  return best && bestDelta.length <= 6 ? `${head}；最接近的一组差在 ${bestDelta.join('；')}` : `${head}：${JSON.stringify(diff.group)}`;
}
