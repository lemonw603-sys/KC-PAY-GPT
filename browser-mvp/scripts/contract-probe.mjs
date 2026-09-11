// 外部接口字段契约探针（D-172 第 3 条）。只读：打一次卡台真实接口，断言代码依赖的
// 字段名确实存在。防的是这种错误：代码和测试夹具里用同一个错字段名（`cardNo`，真实是
// `lastFour`），测试全绿而功能恒不生效，直到线上才发现。
//   node browser-mvp/scripts/contract-probe.mjs
// 需要本机 highvcc token（过期时会直接说 token 的事，不会伪装成字段缺失）。
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { createHighvccCardProvider } = await import('../../v1/src/providers/highvcc-card.js');

const tokenFile = join(homedir(), 'Library/Application Support/AI充值业务/highvcc.env');
let token = '';
try { token = (readFileSync(tokenFile, 'utf8').match(/HIGHVCC_ACCESS_TOKEN=(.*)/) || [])[1]?.trim() || ''; } catch {}
if (!token) { console.error('[跳过] 本机没有 highvcc token，无法验真响应'); process.exit(2); }

const provider = createHighvccCardProvider({ getAccessToken: async () => token });
const required = {
  'card.lastFour': (c) => typeof c.lastFour === 'string' && c.lastFour.length === 4,
  'card.balance': (c) => Number.isFinite(Number(c.balance)),
  'card.cardId': (c) => typeof c.cardId === 'string' && c.cardId.length > 0,
  'card.status': (c) => c.status !== undefined,
  'card.expMonth': (c) => c.expMonth !== undefined,
  'card.expYear': (c) => c.expYear !== undefined,
};

let rows;
try { rows = await provider.listAll(); } catch (error) {
  console.error(`[失败] 卡台列表调不通：${String(error?.message || error).slice(0, 120)}`);
  process.exit(1);
}
if (!rows.length) { console.error('[跳过] 卡台一张卡都没有，验不了字段'); process.exit(2); }

const row = rows[0]; const card = row.card || row;
let bad = 0;
for (const [name, check] of Object.entries(required)) {
  const okay = (() => { try { return check(card); } catch { return false; } })();
  console.log(`${okay ? '[通过]' : '[失败]'} ${name}`);
  if (!okay) bad += 1;
}
console.log(`\n列表行顶层字段：${Object.keys(row).join(',')}`);
console.log(`卡对象字段：${Object.keys(card).join(',')}`);
console.log(bad === 0 ? '\n==> 卡台字段契约与代码一致 ✓' : `\n==> ${bad} 个字段对不上，代码里依赖它们的地方会静默失效 ✗`);
process.exit(bad === 0 ? 0 : 1);
