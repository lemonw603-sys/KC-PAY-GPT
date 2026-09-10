#!/usr/bin/env node
// 舜捷跨境（highvcc.com）卡台小工具：走它网页自己的 JSON 接口（前端包里读出的合同），
// 不碰登录（登录要密码+图形验证码，由人完成），只用本机文件里的 Bearer token。
//
//   node browser-mvp/scripts/highvcc-card.mjs ranges                      # 卡段：vid、最低充值、费率说明
//   node browser-mvp/scripts/highvcc-card.mjs cost   --amount 50 [--vid V]         # 只读算费
//   node browser-mvp/scripts/highvcc-card.mjs list   [--page 1]                    # 卡列表（只打印非敏感字段）
//   node browser-mvp/scripts/highvcc-card.mjs detail --card-id ID                  # 卡详情（只打印尾号/有效期/地址）
//   node browser-mvp/scripts/highvcc-card.mjs open   --amount 50 --confirm "开卡 708 50" [--vid V] [--first N --last N] [--state OR]
//                                                     # 真开卡：vid 不给时用默认卡段（DEFAULT_VID，当前 708/513989）；
//                                                     # 姓名不给时用卡台自己的 autoCard 生成；先算费再开；无 --confirm 只算费不下单。
//   node browser-mvp/scripts/highvcc-card.mjs export --card-id ID [--out PATH]     # 生成后台「导入备用卡」用的 xlsx
//
// token 文件：~/Library/Application Support/AI充值业务/highvcc.env（0600），HIGHVCC_ACCESS_TOKEN=...
// token 过期/失效时任何命令会直接报「HIGHVCC token expired...」并给出修复命令，不会把过期当成别的错误。
// 刷新 token（登录着 highvcc.com 的 Chrome 里，F12 → Console）：
//   copy(localStorage.getItem('access_token'))
//   然后终端：browser-mvp/scripts/save-highvcc-token.sh access
// 任何输出都不含 token、完整卡号、CVC；导入表只落到本机文件。
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MockAddressBillingAddressSource } from '../src/mockaddress-billing-address-source.js';

const run = promisify(execFile);
const ENV_PATH = join(process.env.HOME, 'Library/Application Support/AI充值业务/highvcc.env');
const BASE = (process.env.HIGHVCC_API_BASE || 'https://www.highvcc.com').replace(/\/$/, '');
// 513989 / MasterCard：这个账户已有多张同卡段卡，2026-09-10 与 Lemon 确认过的默认卡段；
// 换默认不改代码，跑的时候 HIGHVCC_DEFAULT_VID=<vid> 或每次显式传 --vid 都行。
const DEFAULT_VID = process.env.HIGHVCC_DEFAULT_VID || '708';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

async function token() {
  let text;
  try { text = await readFile(ENV_PATH, 'utf8'); } catch { throw new Error(`token file missing: ${ENV_PATH}`); }
  const line = text.split('\n').find((l) => l.startsWith('HIGHVCC_ACCESS_TOKEN='));
  const value = line ? line.slice('HIGHVCC_ACCESS_TOKEN='.length).trim().replace(/^"|"$/g, '') : '';
  if (!value) throw new Error('HIGHVCC_ACCESS_TOKEN is empty');
  return value;
}

async function api(method, path, { query = null, body = null, form = false } = {}) {
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const { requestBody, contentType } = buildRequestInit(body, form);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      Accept: 'application/json',
      ...(contentType ? { 'Content-Type': contentType } : {}),
      'User-Agent': 'Mozilla/5.0',
    },
    body: requestBody,
  });
  let json = null;
  try { json = await response.json(); } catch { json = null; }
  if (isAuthTrouble(response.status, json)) {
    throw new Error([
      `HIGHVCC token expired or invalid (HTTP ${response.status}${json?.msg ? ` ${json.msg}` : ''}).`,
      `Fix: in the logged-in Chrome, on any highvcc.com page, F12 -> Console:`,
      `  copy(localStorage.getItem('access_token'))`,
      `then: browser-mvp/scripts/save-highvcc-token.sh access`,
    ].join('\n'));
  }
  if (!response.ok) throw new Error(`${method} ${path} -> HTTP ${response.status}${json?.msg ? ` ${json.msg}` : ''}`);
  if (json?.code !== 200) throw new Error(`${method} ${path} -> code ${json?.code} ${json?.msg || ''}`);
  return json;
}

// The live front end posts these as application/x-www-form-urlencoded, not JSON (confirmed
// 2026-09-10 by capturing the real openCardCost XHR from the logged-in session); a JSON body
// reaches the server as effectively empty and comes back as an unrelated validation error
// ("支付钱包不能为空") instead of the real one. Kept as a pure function so the encoding choice
// has a direct regression test instead of relying on hitting the live API again.
function buildRequestInit(body, form) {
  if (!body) return { requestBody: undefined, contentType: undefined };
  if (form) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) if (v != null && v !== '') params.set(k, String(v));
    return { requestBody: params.toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' };
  }
  return { requestBody: JSON.stringify(body), contentType: 'application/json' };
}

// HTTP 401/403, or an HTTP-200-wrapped { code: 401 } / a message that reads like a session
// timeout: this platform's own axios interceptor treats all three as "go back to login",
// so we surface one clear fix instead of a generic HTTP/code error the operator has to decode.
function isAuthTrouble(status, json) {
  return status === 401 || status === 403
    || Boolean(json && (json.code === 401 || /登录|过期|token/i.test(String(json.msg || ''))));
}

function cents(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--amount must be a positive number of US dollars, got ${JSON.stringify(dollars)}`);
  return String(Math.round(n * 100));
}
const mask = (pan) => (pan ? `****${String(pan).replace(/\s/g, '').slice(-4)}` : null);

function safeCardRow(row) {
  const c = row?.card || row;
  return {
    cardId: c.cardId ?? c.id ?? null, cardSeqNo: c.cardSeqNo ?? null, last4: c.lastFour ?? mask(c.number),
    status: c.statusText ?? c.cardStatus ?? c.status ?? null, balance: c.balance ?? null,
    rechargeAmount: c.rechargeAmount ?? null, openDate: c.openDate ?? c.createTime ?? c.gmtCreate ?? null,
    segment: c.segment ?? c.cardRange ?? null, unit: c.unit ?? c.payUnit ?? null,
    tags: c.tags ?? c.tagName ?? null, group: c.groupName ?? null,
    keys: Object.keys(c).filter((k) => !/number|cvc|cvv|pin/i.test(k)),
  };
}

async function ranges() {
  const r = await api('GET', '/api/card/rangeList');
  const rows = Array.isArray(r.data) ? r.data : (r.data?.data || []);
  for (const s of rows) {
    console.log(JSON.stringify({ vid: s.vid, name: s.name ?? s.segment ?? s.cardRange ?? null,
      minTopup: s.newCardMinTopupAmount ? { amount: s.newCardMinTopupAmount.amount, unit: s.newCardMinTopupAmount.unit ?? null } : null,
      feeInfo: s.feeInfo ?? null, desc: s.desc ?? null, keys: Object.keys(s) }));
  }
  if (!rows.length) console.log('no card ranges returned');
}

async function cost(vid, amount) {
  const r = await api('POST', '/api/card/openCardCost', { body: { vid, amount: cents(amount), payUnit: 'USD' }, form: true });
  return r.data;
}

async function list(page = 1) {
  const r = await api('GET', '/api/card/page', { query: { pageNo: page, pageSize: 20 } });
  const rows = r.data?.data || r.data?.records || r.data?.list || (Array.isArray(r.data) ? r.data : []);
  console.log(JSON.stringify({ total: r.data?.total ?? rows.length, page }));
  for (const row of rows) console.log(JSON.stringify(safeCardRow(row)));
  return rows;
}

async function detail(cardId) {
  const r = await api('POST', '/api/card/detail', { body: { cardId }, form: true });
  return r.data;
}

function printDetail(d) {
  const c = d.card || {}; const a = d.adress || d.address || {};
  console.log(JSON.stringify({ cardId: c.cardId, cardSeqNo: c.cardSeqNo ?? d.cardSeqNo ?? null, last4: mask(c.number),
    expires: c.expMonth ? `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}` : null,
    holder: `${c.firstName || ''} ${c.lastName || ''}`.trim(), address: { street: a.street, city: a.city, state: a.state, zipCode: a.zipCode },
    balance: c.balance ?? d.balance ?? null, status: c.statusText ?? c.cardStatus ?? c.status ?? null,
    cardKeys: Object.keys(c).filter((k) => !/number|cvc|cvv|pin/i.test(k)), topKeys: Object.keys(d) }));
}

/** Cardholder name: the platform's own generator (GET /api/card/autoCard) when none is given; its address is discarded in favour of our tax-free one. */
async function holderName(first, last) {
  if (first && last) return { first, last, source: 'cli' };
  const r = await api('GET', '/api/card/autoCard');
  const f = String(r.data?.firstName || '').trim(); const l = String(r.data?.lastName || '').trim();
  if (!/^[A-Za-z][A-Za-z' -]{0,30}$/.test(f) || !/^[A-Za-z][A-Za-z' -]{0,30}$/.test(l)) throw new Error('platform autoCard returned no usable holder name; pass --first/--last');
  return { first: f, last: l, source: 'platform-autoCard' };
}

async function open({ vid, amount, first, last, state, confirm }) {
  const holder = await holderName(first, last); first = holder.first; last = holder.last;
  console.log(JSON.stringify({ step: 'holder', name: `${first} ${last}`, source: holder.source }));
  const address = await new MockAddressBillingAddressSource({ state, name: `${first} ${last}` }).load(`highvcc:${vid}:${Date.now()}`);
  const feeInfo = await cost(vid, amount);
  console.log(JSON.stringify({ step: 'cost', vid, amount: Number(amount), unit: 'USD', feeDetail: feeInfo?.feeDetail ?? feeInfo,
    popStatus: feeInfo?.popStatus ?? null, popMsg: feeInfo?.popMsg ?? null,
    address: { state: address.state, city: address.city, zipCode: address.postalCode } }));
  const expected = `开卡 ${vid} ${Number(amount)}`;
  if (confirm !== expected) { console.log(JSON.stringify({ step: 'dry-run', hint: `真开卡请加 --confirm "${expected}"` })); return; }
  const payload = {
    vid, firstName: first, lastName: last, street: address.line1, city: address.city, state: address.state, zipCode: address.postalCode,
    unit: 'USD', rechargeAmount: cents(amount), tags: '', gid: null, couponId: null,
  };
  const r = await api('POST', '/api/card/newCard', { body: payload, form: true });
  console.log(JSON.stringify({ step: 'opened', msg: r.msg ?? null, data: r.data == null ? null : (typeof r.data === 'object' ? Object.keys(r.data) : String(r.data)) }));
}

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HEADERS = ['卡序列号','累计充值','累计消费','余额','卡号','CVC','有效期','开卡状态','开卡时间','FirstName','LastName','州','城市','街道','邮编','标签','分组名称'];
function colRef(n) { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/** Writes an xlsx the backend import parser accepts: row 1 title, row 2 headers, row 3 data, all shared strings. */
async function writeImportWorkbook(rowsOfStrings, outPath) {
  const strings = []; const index = new Map();
  const sid = (v) => { const k = String(v ?? ''); if (!index.has(k)) { index.set(k, strings.length); strings.push(k); } return index.get(k); };
  const sheetRows = [['卡片列表'], HEADERS, ...rowsOfStrings];
  const rowsXml = sheetRows.map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => `<c r="${colRef(c)}${r + 1}" t="s"><v>${sid(v)}</v></c>`).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`,
  };
  const dir = await mkdtemp(join(tmpdir(), 'highvcc-xlsx-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(join(dir, name, '..'), { recursive: true });
      await writeFile(join(dir, name), content, { mode: 0o600 });
    }
    await rm(outPath, { force: true });
    await run('/usr/bin/zip', ['-q', '-X', '-r', outPath, '[Content_Types].xml', '_rels', 'xl'], { cwd: dir });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function exportCard(cardId, outPath) {
  const d = await detail(cardId);
  const c = d.card || {}; const a = d.adress || d.address || {};
  const expires = c.expMonth ? `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}` : '';
  const loaded = arg('loaded', c.rechargeAmount ?? d.rechargeAmount ?? ''); const balance = arg('balance', c.balance ?? d.balance ?? '');
  const row = [
    c.cardSeqNo ?? d.cardSeqNo ?? '', String(loaded), arg('spent', '0'), String(balance), String(c.number || ''), String(c.cvc || ''), expires,
    arg('status', '已激活'), String(c.openDate ?? c.createTime ?? d.openDate ?? ''), c.firstName || '', c.lastName || '',
    a.state || '', a.city || '', a.street || '', a.zipCode || '', '', '',
  ];
  const missing = ['卡序列号', '余额', '卡号', 'CVC', '有效期'].filter((h, i) => !row[[0, 3, 4, 5, 6][i]]);
  if (missing.length) throw new Error(`export incomplete, missing ${missing.join('/')}; pass --loaded/--balance or inspect detail keys`);
  await writeImportWorkbook([row], outPath);
  console.log(JSON.stringify({ step: 'exported', out: outPath, last4: mask(c.number), expires, balance: String(balance), holder: `${c.firstName || ''} ${c.lastName || ''}`.trim() }));
}

export { writeImportWorkbook, HEADERS as IMPORT_HEADERS, cents, buildRequestInit, isAuthTrouble };

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'ranges') await ranges();
    else if (cmd === 'cost') console.log(JSON.stringify(await cost(arg('vid', DEFAULT_VID), arg('amount'))));
    else if (cmd === 'list') await list(Number(arg('page', 1)));
    else if (cmd === 'detail') printDetail(await detail(arg('card-id')));
    else if (cmd === 'open') await open({ vid: arg('vid', DEFAULT_VID), amount: arg('amount'), first: arg('first'), last: arg('last'), state: arg('state', 'OR'), confirm: arg('confirm') });
    else if (cmd === 'export') await exportCard(arg('card-id'), arg('out', join(process.env.HOME, 'Downloads', `highvcc-import-${Date.now()}.xlsx`)));
    else { console.error('usage: ranges | cost | list | detail | open | export'); process.exitCode = 2; }
  } catch (error) {
    console.error('failed:', error.message);
    process.exitCode = 1;
  }
}
