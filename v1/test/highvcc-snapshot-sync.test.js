import test from 'node:test';
import assert from 'node:assert/strict';
import { centsToMoney, buildSnapshotRow, buildSnapshotWorkbook, createHighvccSnapshotSyncService } from '../src/services/highvcc-snapshot-sync-service.js';
import { parseManualCardWorkbook, REQUIRED_HEADERS } from '../src/services/manual-card-import-service.js';
import { createHighvccCardProvider } from '../src/providers/highvcc-card.js';
import { createHighvccAccessTokenReader, TOKEN_SETTING_KEY } from '../src/services/highvcc-card-service.js';
import { encryptSecret } from '../src/security/secret-box.js';

// Shapes copied from real highvcc responses (list → /api/card/page rows; detail → { card, adress }).
// /api/card/page rows are wrapped exactly like detail: { card, adress, tags } (verified against the live platform 2026-09-11).
const listCard = { cardId: 'HG0f89904121fe4bfab8df7e02255392a1', cardSeqNo: 'HG0f89904121fe4bfab8df7e02255392a1', lastFour: '7402', balance: 108, statusText: '已激活', openDate: 1788876577000 };
const listRow = { card: listCard, adress: { street: '5130 Ne 86Th Ave', city: 'Portland', state: 'OR', zipCode: '97220' }, tags: [] };
const detail = {
  card: { cardId: listCard.cardId, cardSeqNo: listCard.cardSeqNo, number: '4288200000007402', cvc: '123', expMonth: 2, expYear: 2028,
    balance: 108, consume: 0, deposit: 17400, statusText: '已激活', firstName: 'Wren', lastName: 'Lee', openDate: 1788876577000 },
  adress: { street: '5130 Ne 86Th Ave', city: 'Portland', state: 'OR', zipCode: '97220' },
};
const fakePool = { getConnection() { throw new Error('not used'); }, query() { throw new Error('not used'); } };
const keys = { encryptionKey: Buffer.alloc(32, 1), panHmacKey: Buffer.alloc(32, 2) };

test('centsToMoney: platform integer cents become the dollar strings the import parser reads', () => {
  assert.equal(centsToMoney(108), '1.08');
  assert.equal(centsToMoney(5000), '50.00');
  assert.equal(centsToMoney(0), '0.00');
  assert.equal(centsToMoney(null), null);
  assert.equal(centsToMoney('abc'), null);
});

test('buildSnapshotRow: 17 columns in REQUIRED_HEADERS order; balance from cents, MM/YY expiry, address from detail.adress', () => {
  const row = buildSnapshotRow({ listRow, detail });
  assert.equal(row.length, REQUIRED_HEADERS.length);
  const by = Object.fromEntries(REQUIRED_HEADERS.map((h, i) => [h, row[i]]));
  assert.equal(by['卡序列号'], listCard.cardSeqNo);
  assert.equal(by['余额'], '1.08');
  assert.equal(by['累计充值'], '174.00');
  assert.equal(by['累计消费'], '0.00');
  assert.equal(by['卡号'], '4288200000007402');
  assert.equal(by.CVC, '123');
  assert.equal(by['有效期'], '02/28');
  assert.equal(by['开卡状态'], '已激活');
  assert.equal(by['开卡时间'], '2026-09-08 14:09:37');
  assert.equal(by.FirstName, 'Wren'); assert.equal(by.LastName, 'Lee');
  assert.equal(by['州'], 'OR'); assert.equal(by['城市'], 'Portland'); assert.equal(by['街道'], '5130 Ne 86Th Ave'); assert.equal(by['邮编'], '97220');
});

test('buildSnapshotWorkbook round-trips through parseManualCardWorkbook: no structural errors, right balance, mismatch only a warning', () => {
  const bytes = buildSnapshotWorkbook([buildSnapshotRow({ listRow, detail })]);
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString('hex'), '504b0304', 'must be a zip/OOXML container');
  const rows = parseManualCardWorkbook(bytes);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.deepEqual(r.structuralErrors, []);
  assert.deepEqual(r.availabilityReasons, []);
  assert.equal(r.balance, 1.08);
  assert.equal(r.pan, '4288200000007402');
  assert.equal(r.expMonth, 2); assert.equal(r.expYear, 2028);
  // 174.00 - 0.00 != 1.08: the platform's running totals do not reconcile; reported, never blocking.
  assert.ok(r.warnings.includes('BALANCE_MISMATCH'));
});

test('buildSnapshotWorkbook: a row missing PAN/CVC is a structural rejection at parse time, not a silent import', () => {
  const rows = parseManualCardWorkbook(buildSnapshotWorkbook([buildSnapshotRow({ listRow, detail: { card: { ...detail.card, number: '', cvc: '' }, adress: detail.adress } })]));
  assert.ok(rows[0].structuralErrors.includes('INVALID_CARD_NUMBER'));
  assert.ok(rows[0].structuralErrors.includes('INVALID_CVC'));
});

test('provider.listAll walks /api/card/page until total is reached and stops on an empty page', async () => {
  const pages = { 1: { total: 2, data: [{ cardId: 'a' }, { cardId: 'b' }] } };
  const urls = [];
  const provider = createHighvccCardProvider({
    getAccessToken: async () => 'tok',
    fetchImpl: async (url) => {
      urls.push(url);
      const pageNo = Number(new URL(url).searchParams.get('pageNo'));
      return { status: 200, ok: true, async json() { return { code: 200, data: pages[pageNo] || { total: 3, data: [] } }; } };
    },
  });
  const all = await provider.listAll({ pageSize: 2 }); // clamped to the platform minimum of 6
  assert.deepEqual(all.map((c) => c.cardId), ['a', 'b']);
  assert.equal(urls.length, 1, 'page 1 already reports total=2, so no second request');
  assert.match(urls[0], /\/api\/card\/page\?pageNo=1&pageSize=6$/, 'pageSize below 6 is clamped to the platform minimum');
});

test('createHighvccAccessTokenReader: decrypts the stored setting, returns null when unset or undecryptable', async () => {
  const stored = encryptSecret('secret-token', keys.encryptionKey).toString('base64');
  const mk = (value) => ({ async query(sql, params) { assert.match(sql, /app_settings/); assert.equal(params[0], TOKEN_SETTING_KEY); return [value === undefined ? [] : [{ setting_value: value }]]; } });
  assert.equal(await createHighvccAccessTokenReader({ pool: mk(stored), encryptionKey: keys.encryptionKey })(), 'secret-token');
  assert.equal(await createHighvccAccessTokenReader({ pool: mk(undefined), encryptionKey: keys.encryptionKey })(), null);
  assert.equal(await createHighvccAccessTokenReader({ pool: mk('bm90IGEgY2lwaGVydGV4dA=='), encryptionKey: keys.encryptionKey })(), null);
});

test('preview: list + detail per card, workbook handed to the import service, result carries a PAN-free platform summary and no file', async () => {
  const calls = [];
  const second = { card: { ...listCard, cardId: 'HG61ab', cardSeqNo: 'HG61ab', lastFour: '9354', balance: 500 }, adress: listRow.adress, tags: [] };
  const provider = {
    async listAll() { calls.push('listAll'); return [listRow, second]; },
    async detail(id) {
      calls.push(`detail:${id}`);
      if (id === listCard.cardId) return detail;
      return { card: { ...detail.card, cardId: id, cardSeqNo: id, number: '5139890000009354', cvc: '456', balance: 500, deposit: 500 }, adress: detail.adress };
    },
  };
  let received = null;
  const importService = {
    async preview(input) {
      received = input;
      const rows = parseManualCardWorkbook(input.fileBase64);
      return { sourceName: 'A', rowCount: rows.length, insertCount: 1, updateCount: 1, missingCount: 0, conflictCount: 0, rejectedCount: 0, commitAllowed: true, rows: [], confirmation: `确认提交 ${rows.length} 张卡的完整快照` };
    },
    async commit() { throw new Error('not in this test'); },
  };
  const service = createHighvccSnapshotSyncService({ pool: fakePool, ...keys, provider, importService, now: () => new Date('2026-09-11T01:00:00Z') });
  const result = await service.preview();
  assert.deepEqual(calls, ['listAll', `detail:${listCard.cardId}`, 'detail:HG61ab']);
  assert.equal(received.providerAccountId, '00000000-0000-4000-8000-000000000103');
  assert.equal(received.filename, 'highvcc-snapshot-2026-09-11T01-00-00-000Z.xlsx');
  assert.equal(result.rowCount, 2);
  assert.equal(result.commitAllowed, true);
  assert.equal(result.fileBase64, undefined, 'the workbook (PAN/CVC) must never be in a printable result');
  assert.deepEqual(result.platformCards.map((c) => c.last4), ['7402', '9354']);
  assert.deepEqual(result.platformCards.map((c) => c.balance), ['1.08', '5.00']);
});

test('commit: refuses a non-committable preview without calling commit; otherwise passes the preview confirmation word through', async () => {
  const provider = { async listAll() { return [listRow]; }, async detail() { return detail; } };
  let committed = null;
  const importService = (commitAllowed) => ({
    async preview(i) { return { filename: i.filename, rowCount: 1, commitAllowed, rejectedCount: commitAllowed ? 0 : 1, conflictCount: 0, rows: [], confirmation: '确认提交 1 张卡的完整快照' }; },
    async commit(i) { committed = i; return { batchId: 'b1', insertedCount: 0, updatedCount: 1 }; },
  });
  const base = { pool: fakePool, ...keys, provider };
  await assert.rejects(createHighvccSnapshotSyncService({ ...base, importService: importService(false) }).commit(), /not committable/);
  assert.equal(committed, null);
  const r = await createHighvccSnapshotSyncService({ ...base, importService: importService(true) }).commit({ requestedBy: 'test' });
  assert.equal(committed.confirmation, '确认提交 1 张卡的完整快照');
  assert.equal(committed.requestedBy, 'test');
  assert.equal(committed.providerAccountId, '00000000-0000-4000-8000-000000000103');
  assert.ok(committed.fileBase64.length > 100);
  assert.equal(r.committed.batchId, 'b1');
});

test('buildSnapshotRow: expiry accepts two-digit and four-digit years and pads single-digit months', () => {
  const exp = (expMonth, expYear) => buildSnapshotRow({ listRow, detail: { card: { ...detail.card, expMonth, expYear }, adress: detail.adress } })[6];
  assert.equal(exp(2, '28'), '02/28');
  assert.equal(exp('2', 28), '02/28');
  assert.equal(exp(12, 2030), '12/30');
  assert.equal(exp(0, 28), '', 'month 0 is invalid → empty → parser rejects INVALID_EXPIRY rather than guessing');
});

test('buildSnapshotRow also accepts a bare card object (no { card } wrapper) and falls back to the list address', () => {
  const row = buildSnapshotRow({ listRow: { ...listCard, deposit: 108 }, detail: { card: { ...detail.card, deposit: undefined }, adress: undefined } });
  const by = Object.fromEntries(REQUIRED_HEADERS.map((h, i) => [h, row[i]]));
  assert.equal(by['卡序列号'], listCard.cardSeqNo);
  assert.equal(by['余额'], '1.08');
  assert.equal(by['累计充值'], '1.08', 'deposit falls back to the list row');
  assert.equal(by['州'], '', 'no address anywhere → empty, parser will flag MISSING_州');
});
