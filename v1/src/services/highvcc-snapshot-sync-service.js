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

export function createHighvccSnapshotSyncService({
  pool, encryptionKey, panHmacKey, fetchImpl = fetch,
  providerAccountId = BACKUP_A_PROVIDER_ACCOUNT_ID,
  provider = null, importService = null, now = () => new Date(),
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
      const last4 = String(card.cardNo ?? card.last4 ?? '').slice(-4);
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

  return Object.freeze({ collect, preview, commit });
}
