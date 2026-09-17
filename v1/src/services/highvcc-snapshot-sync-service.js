// Balance sync for 备用卡台 A (highvcc.com): pull every card through the platform's own API,
// render the exact "导入备用卡" workbook the manual import parser accepts, and hand it to the
// existing manual-card-import service (preview / commit). Nothing here writes to `cards`
// directly — the import service owns the full-snapshot semantics (insert new cards, refresh
// balances, mark cards missing from the platform as source_present=0) and the audit batch row.
//
// Why this exists: cards recorded from highvcc carry sync_tier=MANUAL_IMPORT, so allocation
// trusts the static current_balance forever (card-inventory-eligibility.js). 7402 sat at
// $49.00 in the database for two days while the platform showed $1.08 and an order was
// assigned to it. Running this (by hand, or on a timer) is what keeps those two in step.
import { zipSync, strToU8 } from 'fflate';
import { createHighvccCardProvider } from '../providers/highvcc-card.js';
import { createHighvccAccessTokenReader, BACKUP_A_PROVIDER_ACCOUNT_ID } from './highvcc-card-service.js';
import { createManualCardImportService, REQUIRED_HEADERS } from './manual-card-import-service.js';
import { commitCardTransactionsForCard } from '../db/repositories/card-transaction-repository.js';
import { recordProviderBalanceSnapshot, sha256Payload } from './provider-balance-snapshot-service.js';
import { classifyCardTransaction } from '../domain/card-transaction-classification.js';

/** Platform integers are USD cents; the import parser reads dollar strings ("1.08"). */
export function centsToMoney(cents) {
  if (cents === null || cents === undefined || cents === '') return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return (n / 100).toFixed(2);
}

/** MM/YY for the import parser. The platform sends expYear as either "28" or 2028; both are accepted. */
function expiry(card) {
  const m = Number(card?.expMonth); const y = Number(card?.expYear);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 0) return '';
  const yy = y >= 100 ? y % 100 : y;
  return `${String(m).padStart(2, '0')}/${String(yy).padStart(2, '0')}`;
}

function openedAt(obj) {
  const ms = Number(obj?.openDate ?? obj?.createTime);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * One workbook row (17 strings in REQUIRED_HEADERS order) from a list row plus its detail
 * payload. 累计充值/累计消费 come from the platform's deposit/consume fields, whose business
 * meaning is unconfirmed; the import parser only uses 余额 for allocation and reports a
 * mismatch as a warning, never a rejection.
 */
export function buildSnapshotRow({ listRow = {}, detail = {} } = {}) {
  // Both /api/card/page rows and /api/card/detail come back wrapped as { card, adress, tags };
  // accept a bare card object too so callers and tests can pass either shape.
  const listCard = listRow.card || listRow; const listAddress = listRow.adress || listRow.address || {};
  const card = detail.card || (detail.number ? detail : {}); const address = detail.adress || detail.address || listAddress;
  const balanceCents = card.balance ?? listCard.balance;
  const depositCents = card.deposit ?? listCard.deposit ?? balanceCents;
  const consumeCents = card.consume ?? listCard.consume ?? 0;
  return [
    String(card.cardSeqNo ?? listCard.cardSeqNo ?? card.cardId ?? listCard.cardId ?? ''),
    centsToMoney(depositCents) ?? '',
    centsToMoney(consumeCents) ?? '',
    centsToMoney(balanceCents) ?? '',
    String(card.number ?? ''),
    String(card.cvc ?? ''),
    expiry(card),
    String(card.statusText ?? listCard.statusText ?? listCard.status ?? ''),
    openedAt(card) || openedAt(listRow),
    String(card.firstName ?? listCard.firstName ?? ''),
    String(card.lastName ?? listCard.lastName ?? ''),
    String(address.state ?? ''), String(address.city ?? ''), String(address.street ?? ''), String(address.zipCode ?? ''),
    '', '',
  ];
}

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function colRef(n) { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/**
 * xlsx bytes in the shape parseManualCardWorkbook expects: row 1 title, row 2 headers, data
 * from row 3, every cell a shared string. Pure JS via fflate — no /usr/bin/zip, so it runs
 * the same on the server and in tests.
 */
export function buildSnapshotWorkbook(rows) {
  const strings = []; const index = new Map();
  const sid = (v) => { const k = String(v ?? ''); if (!index.has(k)) { index.set(k, strings.length); strings.push(k); } return index.get(k); };
  const sheetRows = [['卡片列表'], REQUIRED_HEADERS, ...rows];
  const rowsXml = sheetRows.map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => `<c r="${colRef(c)}${r + 1}" t="s"><v>${sid(v)}</v></c>`).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`,
  };
  // Fixed mtime so identical card data yields byte-identical files: the import service keys its
  // replay check on sha256(bytes), so an unchanged platform state commits nothing (no batch row,
  // no UPDATEs) — which is what lets a timer run this every few minutes without piling up audit rows.
  const mtime = new Date('2026-01-01T00:00:00Z');
  const entries = Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, [strToU8(xml), { mtime }]]));
  return Buffer.from(zipSync(entries, { level: 6, mtime }));
}

// ---------------------------------------------------------------------------
// 授权流水与钱包入库（D-249 面四②「数据源三件」T1）
//
// 在这之前 highvcc 的交易一条都没进过 `card_transactions`（生产实查 2026-09-17：
// 账户 103 共 0 行），所以「付款结果不明时卡上钱动没动」这条客观证据在 Browser
// 路线上根本取不到，对账看板也算不出这条路线花了多少钱。
//
// 字段形状对 2026-09-17 15:0x UTC 的一次真实响应核实过（22 笔，不是照夹具写的）：
//   { cardAuthId, amount(整数分), cardId, desc, cardSeqNo, lastFour, tradeTime(UTC epoch ms),
//     approveTime, unit:'USD', status, reason:'APPROVE', tags, merchantAmount(整数分),
//     merchantCurrency:'PHP'|'USD', merchantCountry:'US'|null }
//   status 实际见到两种：COMPLETE(19) / PENDING(3)。provider 注释原先只记了 COMPLETE。
//   merchantCountry 可以是 null；tags 实际是 null 而不是数组。
// ---------------------------------------------------------------------------

/**
 * 整数分 → DECIMAL 定点字符串，全程整数与字符串运算。
 * 不复用本文件的 centsToMoney()：那个用 `n / 100` 走 JS 浮点，给 xlsx 显示够用，
 * 但这里的值要直接落进 card_transactions.amount 参与对账（CLAUDE.md：金额不用浮点结算）。
 */
export function centsToFixedString(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  const digits = String(Math.abs(n)).padStart(3, '0');
  return `${n < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/**
 * 一条 highvcc 授权流水 → persistCardTransactions 认的行形状。
 *
 * type 固定 'PURCHASE'：这个接口（/api/cardTrade/authTrans/page）返回的就是刷卡授权，
 * 每条都是一次消费授权，不是充值/退款/风控记录——不是从某个字段推断出来的分类。
 * status 原样存卡台的值（COMPLETE/PENDING），不翻译成系统内的 success：hnskj 那边
 * 库里同样是原样存（success/SUCCESS/SETTLED 并存），保持「观察是观察」。
 * 代价是 card-consumption-audit 现有的 LOWER(status)='success' 判据认不出 COMPLETE，
 * 见本块收尾「发现」段，判据要不要放宽由 Lemon 定，本次不动那个脚本。
 */
export function toCardTransactionRow(row = {}) {
  const id = row.cardAuthId == null ? null : String(row.cardAuthId).trim();
  if (!id) return null;
  const amount = centsToFixedString(row.amount);
  if (amount === null) return null;
  const currency = String(row.unit || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const merchantCurrency = String(row.merchantCurrency || '').trim().toUpperCase();
  const transaction = {
    id,
    type: 'PURCHASE',
    status: row.status == null ? '' : String(row.status),
    amount,
    currency,
    // 这个接口不返回任何手续费字段（对真实响应核实过）：留 null 表示「卡台没给」，
    // 不是 0（0 会被读成「确认没有手续费」）。
    fee: null,
    // 卡台给的是 UTC epoch 毫秒，provider 已归一成 *EpochMs 且明令不做时区平移。
    // 这里落成 ISO UTC 字符串：可读、可排序，且不会再被人「顺手修时区」。
    // 注意与 hnskj 不同——hnskj 那边落的是卡台给的 UTC+8 本地串（生产实见
    // "2026-09-17 09:34:34" 对应 01:34 UTC）。两边格式不统一是卡台本来就不同，
    // 统一口径属于对账面的活，不在本块范围。
    tradeTime: row.tradeTimeEpochMs ? new Date(row.tradeTimeEpochMs).toISOString() : null,
    relatedTxnId: null,
    // 卡台的授权结论（实见 'APPROVE'），原样存，不翻译。
    settlementStatus: row.reason == null ? null : String(row.reason),
    // 商户侧原币金额：菲律宾账号结账是 PHP（实见 98214 = 982.14 PHP）。
    originalAmount: centsToFixedString(row.merchantAmount),
    originalCurrency: /^[A-Z]{3}$/.test(merchantCurrency) ? merchantCurrency : null,
    merchantName: row.desc == null ? null : String(row.desc).trim().slice(0, 255) || null,
    merchantCountry: row.merchantCountry == null ? null : String(row.merchantCountry),
    merchantMcc: null,
    rawHash: sha256Payload(row),
  };
  // persistRefundCandidate 只对 classification==='REFUND_CANDIDATE' 动作（会插 refund_cases
  // 和 operator_alerts）。PURCHASE 算出来是 UNKNOWN，不会触发——显式算一次而不是留空，
  // 免得将来有人改了分类规则这里却悄悄不跟着变。
  transaction.classification = classifyCardTransaction(transaction);
  return transaction;
}

export function createHighvccSnapshotSyncService({
  pool, encryptionKey, panHmacKey, fetchImpl = fetch,
  providerAccountId = BACKUP_A_PROVIDER_ACCOUNT_ID,
  provider = null, importService = null, now = () => new Date(),
  // 与上面的 provider/importService 同一风格的注入点：测试要断言「写了什么」，
  // 而 ESM 导出不可重定义、mock 不掉这两个函数。
  writeCardTransactions = commitCardTransactionsForCard,
  writeBalanceSnapshot = recordProviderBalanceSnapshot,
} = {}) {
  if (!pool?.getConnection) throw new TypeError('pool is required');
  const cardProvider = provider
    || createHighvccCardProvider({ getAccessToken: createHighvccAccessTokenReader({ pool, encryptionKey }), fetchImpl });
  const imports = importService || createManualCardImportService({ pool, encryptionKey, panHmacKey });

  /** list + detail for every card. `rows` carries PAN/CVC and must not be logged; `summary` is safe. */
  async function collect(preFetchedListRows = null) {
    const listRows = preFetchedListRows || await cardProvider.listAll();
    const rows = []; const summary = [];
    for (const listRow of listRows) {
      const listCard = listRow.card || listRow;
      const cardId = listCard.cardId ?? listCard.id;
      if (!cardId) throw new Error('platform card list row has no cardId');
      const detail = await cardProvider.detail(cardId);
      const row = buildSnapshotRow({ listRow, detail });
      rows.push(row);
      summary.push({ cardId, last4: String(row[4]).slice(-4), balance: row[3], status: row[7], expires: row[6] });
    }
    return { rows, summary };
  }

  /**
   * One cheap list call decides whether the expensive part is needed at all.
   *
   * A full snapshot costs 1 list request plus one detail request PER CARD, and it
   * ran every 10 minutes — roughly 860 requests a day at 5 cards, almost all of
   * them to learn that nothing had changed. The card platform has no idea why we
   * poll it. The list alone already carries every field that can move between
   * runs (which cards exist, their balance, their status); PAN/CVC/address cannot
   * change for a card that is still there. So when the list matches what the
   * database already holds, there is nothing a snapshot could correct, and we stop.
   */
  async function unchangedAgainstDatabase(listRows) {
    const fromPlatform = new Map();
    for (const listRow of listRows) {
      const card = listRow.card || listRow;
      // The platform's list row calls it `lastFour`; `number` is the full PAN and is
      // never used here. Reading a field that does not exist silently disabled the
      // whole short circuit once already — verified against the live shape 2026-09-11.
      const last4 = String(card.lastFour ?? card.number ?? '').slice(-4);
      if (!last4) return null; // cannot compare safely — fall through to a full snapshot
      fromPlatform.set(last4, Number(card.balance));
    }
    const [stored] = await pool.query(
      `SELECT last4, current_balance, source_present FROM cards
        WHERE provider_account_id = ? AND sync_tier = 'MANUAL_IMPORT'`, [providerAccountId]
    );
    const present = stored.filter((row) => Number(row.source_present) === 1);
    if (present.length !== fromPlatform.size) return null;
    for (const row of present) {
      const platformCents = fromPlatform.get(String(row.last4));
      if (platformCents === undefined || !Number.isFinite(platformCents)) return null;
      // Stored balance is dollars, the platform reports cents.
      if (Math.round(Number(row.current_balance) * 100) !== Math.round(platformCents)) return null;
    }
    return { cardCount: present.length };
  }

  const filename = () => `highvcc-snapshot-${now().toISOString().replace(/[:.]/g, '-')}.xlsx`;

  // Shared by preview() and commit(). Keeps fileBase64 (contains PAN/CVC) out of anything a caller might print.
  async function prepare({ force = false } = {}) {
    // The list is fetched once and reused: probing with a second list call would
    // have added a request instead of removing any.
    let listRows = null;
    if (!force) {
      listRows = await cardProvider.listAll();
      const unchanged = await unchangedAgainstDatabase(listRows).catch(() => null);
      if (unchanged) {
        return { fileBase64: null, result: { skipped: true, reason: 'NO_CHANGE', ...unchanged, platformCards: [] } };
      }
    }
    const { rows, summary } = await collect(listRows);
    const fileBase64 = buildSnapshotWorkbook(rows).toString('base64');
    const name = filename();
    const result = await imports.preview({ providerAccountId, filename: name, fileBase64 });
    return { fileBase64, result: { ...result, filename: name, platformCards: summary } };
  }

  async function preview({ force = false } = {}) {
    const { result } = await prepare({ force });
    return result;
  }

  async function commit({ requestedBy = 'highvcc-snapshot-sync', force = false } = {}) {
    const { fileBase64, result } = await prepare({ force });
    if (result.skipped) return { preview: result, committed: null };
    if (!result.commitAllowed) {
      const error = new Error(`snapshot not committable: ${result.rejectedCount} rejected, ${result.conflictCount} conflicts`);
      error.code = 'HIGHVCC_SNAPSHOT_NOT_COMMITTABLE'; error.preview = result;
      throw error;
    }
    const committed = await imports.commit({ providerAccountId, filename: result.filename, fileBase64, confirmation: result.confirmation, requestedBy });
    return { preview: result, committed };
  }

  /**
   * 把卡台的授权流水归到库内卡上写进 card_transactions。
   *
   * 归卡靠 highvcc 的 cardId 对 `cards.external_card_id`（生产实查一致：两边都是
   * HG+32 位十六进制）。归不到的行不猜、不按 lastFour 兜底——lastFour 会重复，
   * 猜错就是把一张卡的扣款记到另一张卡头上。归不到只报数，交人看。
   *
   * 只读卡台、只写 card_transactions（cardSnapshot 传 null，不碰 cards.current_balance，
   * 那是 manual-card-import 的活）。写入仍会刷该卡的 last_transaction_synced_at，
   * 但 MANUAL_IMPORT 卡的分配资格走 card-inventory-eligibility.js 的 sync_tier 分支，
   * 不看这个时间戳，所以不改变谁可分配（2026-09-17 对生产资格 SQL 实测过）。
   */
  async function syncTransactions() {
    const rows = await cardProvider.allTransactions({ pageSize: 50 });
    const [cards] = await pool.query(
      `SELECT id, external_card_id FROM cards WHERE provider_account_id = ?`, [providerAccountId]
    );
    const byExternalId = new Map(cards.map((row) => [String(row.external_card_id), row.id]));
    const grouped = new Map();
    const unmatched = [];
    let skipped = 0;
    for (const row of rows) {
      const cardId = byExternalId.get(String(row.cardId ?? ''));
      if (!cardId) { unmatched.push(String(row.cardAuthId ?? '')); continue; }
      const transaction = toCardTransactionRow(row);
      if (!transaction) { skipped += 1; continue; }
      if (!grouped.has(cardId)) grouped.set(cardId, []);
      grouped.get(cardId).push(transaction);
    }
    for (const [cardId, transactions] of grouped) {
      await writeCardTransactions(pool, { cardId, transactions, cardSnapshot: null });
    }
    return {
      fetched: rows.length,
      cardCount: grouped.size,
      written: [...grouped.values()].reduce((total, list) => total + list.length, 0),
      unmatchedCount: unmatched.length,
      unmatchedAuthIds: unmatched,
      skippedCount: skipped,
    };
  }

  /**
   * 钱包余额入 provider_balance_snapshots。
   *
   * 只入 usdBalance（可用余额）。usdDeposit 的业务含义卡台没说清（按卡冻结？历史累计？
   * provider 注释也标了未确认），把它填进 pendingBalance 等于替卡台下结论——留给面二⑤
   * 钱包预检那块先把含义问清。完整响应进 payloadHash，原值不落盘。
   */
  async function syncWallet({ observedAt = now() } = {}) {
    const wallet = await cardProvider.wallet();
    const availableBalance = centsToFixedString(wallet.usdBalanceCents);
    if (availableBalance === null) {
      const error = new Error('highvcc wallet returned no usable usdBalance');
      error.code = 'HIGHVCC_WALLET_UNUSABLE';
      throw error;
    }
    const snapshot = await writeBalanceSnapshot(pool, {
      providerAccountId, currency: 'USD', availableBalance, pendingBalance: null,
      observedAt, rawPayload: wallet,
    });
    return { availableBalance, inserted: snapshot.inserted, observedAt: snapshot.observedAt };
  }

  return Object.freeze({ collect, preview, commit, syncTransactions, syncWallet });
}
