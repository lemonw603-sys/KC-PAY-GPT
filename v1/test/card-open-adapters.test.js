import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCardOpenAdapters, createHighvccOpenAdapter, createHnskjOpenAdapter } from '../src/services/card-open-adapters.js';
import { CARD_ADAPTER_HIGHVCC, CARD_ADAPTER_HNSKJ } from '../src/services/provider-route-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// hnskj 真实响应形状（test/fixtures/hnskj-read-responses.json，对生产只读接口录的）。
const hnskjFixtures = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/hnskj-read-responses.json'), 'utf8'));
const config = { sessionEncryptionKey: Buffer.alloc(32, 1), cardIntakePanHmacKey: Buffer.alloc(32, 2) };
const HNSKJ = { id: '00000000-0000-4000-8000-000000000101', displayName: 'HNSKJ', openAdapter: CARD_ADAPTER_HNSKJ };
const BACKUP = { id: '00000000-0000-4000-8000-000000000103', displayName: '备用卡台 A', openAdapter: CARD_ADAPTER_HIGHVCC };

function fakePool() {
  const queries = [];
  let lastSnapshot = [];
  async function query(sql, params = []) {
    const text = String(sql);
    queries.push({ sql: text.replace(/\s+/g, ' ').trim(), params });
    if (text.includes('SELECT id\n       FROM provider_accounts') || text.includes('FROM provider_accounts')) return [[{ id: params[0] }]];
    if (text.includes('INSERT IGNORE INTO provider_balance_snapshots')) { lastSnapshot = params; return [{ affectedRows: 1 }]; }
    if (text.includes('FROM provider_balance_snapshots') && text.includes('observed_at = ?')) {
      return [[{ id: 1, provider_account_id: lastSnapshot[0], currency: lastSnapshot[1], available_balance: lastSnapshot[2], pending_balance: lastSnapshot[3], source_call_id: lastSnapshot[4], payload_hash: lastSnapshot[5], observed_at: lastSnapshot[6] }]];
    }
    if (text.includes('FROM provider_balance_snapshots')) return [[]];
    if (text.includes('INSERT INTO card_provider_snapshots')) return [{ affectedRows: 1 }];
    return [[]];
  }
  const connection = { query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
  return { queries, query, async getConnection() { return connection; } };
}

function hnskjFetch() {
  return async (url) => {
    const p = new URL(url).pathname;
    const body = p.endsWith('/card-types') ? hnskjFixtures.cardTypes
      : p.endsWith('/account/balance') ? { ...hnskjFixtures.balance, data: { ...hnskjFixtures.balance.data, balance: '89.480000' } }
        : null;
    if (!body) throw new Error(`unexpected hnskj call ${p}`);
    return { ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) };
  };
}

test('registry hands out one adapter per adapter code and nothing for an unknown code', () => {
  const adapters = createCardOpenAdapters({ pool: fakePool(), config, env: { HNSKJ_API_KEY: 'k' } });
  assert.deepEqual(adapters.codes, [CARD_ADAPTER_HNSKJ, CARD_ADAPTER_HIGHVCC]);
  assert.equal(adapters.has('backup_card_export_v1'), false);
  assert.equal(adapters.for('nope'), null);
  assert.equal(adapters.for(CARD_ADAPTER_HNSKJ).code, CARD_ADAPTER_HNSKJ);
});

test('highvcc adapter: no token means "cannot open now" (the scheduler turns to the other account, no human call)', async () => {
  const service = { async tokenStatus() { return { configured: false }; } };
  const adapter = createHighvccOpenAdapter({ pool: fakePool(), config, service });
  assert.deepEqual(await adapter.canOpen(BACKUP), { ok: false, reason: 'HIGHVCC_TOKEN_MISSING' });
});

test('highvcc adapter: readWallet writes the observation to provider_balance_snapshots and returns fixed-point dollars', async () => {
  const pool = fakePool();
  const service = {
    async tokenStatus() { return { configured: true }; },
    async walletBalance() { return { availableBalance: '23.68', currency: 'USD', raw: { usdBalance: 2368, usdDeposit: 2000, usdConsume: 0 } }; }
  };
  const adapter = createHighvccOpenAdapter({ pool, config, service });
  const wallet = await adapter.readWallet(BACKUP);
  assert.equal(wallet.availableBalance, '23.68');
  assert.equal(wallet.purchaseEnabled, true);
  assert.ok(pool.queries.some((q) => q.sql.includes('INSERT IGNORE INTO provider_balance_snapshots')));
});

test('highvcc adapter: openOne goes through openCardForSupply with the policy segment and amount', async () => {
  const calls = [];
  const service = { async openCardForSupply(input) { calls.push(input); return { cardId: 'HGnew1', last4: '1111' }; } };
  const adapter = createHighvccOpenAdapter({ pool: fakePool(), config, service });
  const result = await adapter.openOne(BACKUP, { segment: '708', amount: '50.000000', jobId: 'job-9' });
  assert.deepEqual(result, { providerCardId: 'HGnew1', last4: '1111' });
  assert.deepEqual(calls, [{ vid: '708', amount: 50, requestedBy: 'card-supply:job-9' }]);
});

test('hnskj adapter: readWallet refreshes the provider snapshot from real-shaped responses and preflight evaluates the segment', async () => {
  const pool = fakePool();
  const adapter = createHnskjOpenAdapter({ pool, config, env: { HNSKJ_API_KEY: 'fixture-key' } });
  adapter.provider.fetchImpl = hnskjFetch();
  const wallet = await adapter.readWallet(HNSKJ);
  assert.equal(wallet.availableBalance, '89.480000');
  assert.equal(wallet.purchaseEnabled, true);
  assert.ok(pool.queries.some((q) => q.sql.includes('INSERT INTO card_provider_snapshots')));
  const evaluation = adapter.preflight(HNSKJ, { segment: '1', amount: '50', wallet });
  assert.equal(evaluation.cardType.name, 'fixture-card');
  assert.throws(() => adapter.preflight(HNSKJ, { segment: '999', amount: '50', wallet }), (e) => e.code === 'CARD_STOCK_CARD_TYPE_UNAVAILABLE');
});
