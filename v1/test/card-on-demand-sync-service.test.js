import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createOnDemandCardSync, syncHnskjCardReadOnly } from '../src/services/card-on-demand-sync-service.js';

// hnskj 真实响应形状（test/fixtures/hnskj-read-responses.json 的 transactions 是真实抓取；
// 详情按生产 provider_calls 里 summarize 读到的字段：data.status / data.cardBalance / data.currency）。
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/hnskj-read-responses.json', import.meta.url)));
const detail = { success: true, message: '成功', data: {
  id: '5622', cardTypeId: 23, status: 'active', cardBalance: '50.000000', currency: 'USD',
  cardNumber: '4242424242426754', cvv: '123', expiryMonth: 12, expiryYear: 2032
} };

function recordingPool() {
  const queries = [];
  return {
    queries,
    async query(sql, params) { return this._q(sql, params); },
    _q(sql, params) {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: flat, params });
      return /^SELECT/i.test(flat) ? [[]] : [{ affectedRows: 1 }];
    },
    async getConnection() {
      const self = this;
      return { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
        query: async (sql, params) => self._q(sql, params) };
    }
  };
}

test('syncHnskjCardReadOnly = detail 1 request + transactions pages, then ledger write and inventory register', async () => {
  const pool = recordingPool();
  const calls = [];
  const provider = {
    async card(id) { calls.push(['card', id]); return detail; },
    async transactions(id, { page, pageSize }) { calls.push(['transactions', id, page, pageSize]); return fixtures.transactions; }
  };
  const registered = [];
  const stock = { async register(card) { registered.push(card); return { providerCardId: card.providerCardId }; } };
  const recorded = [];
  const result = await syncHnskjCardReadOnly({
    pool, provider, stock, card: { id: 'card-uuid', providerCardId: '5622', cardTypeId: 23, fundedAmount: '50' },
    orderId: 'order-1', requestKeyPrefix: 'order-demand-sync:order-1:card-uuid:k', attemptNo: 2,
    recordCall: async (input) => { recorded.push(input); return input.action(); }
  });
  assert.equal(result.requestCount, 2);
  assert.equal(result.transactionCount, fixtures.transactions.data.transactions.length);
  assert.deepEqual(calls.map((c) => c[0]), ['card', 'transactions']);
  assert.deepEqual(recorded.map((r) => [r.operation, r.requestKey, r.attemptNo]), [
    ['card_reconciliation_detail', 'order-demand-sync:order-1:card-uuid:k:detail', 2],
    ['card_reconciliation_transactions', 'order-demand-sync:order-1:card-uuid:k:transactions:1', 2]
  ]);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].providerCardId, '5622');
  assert.equal(registered[0].currentBalance, '50');
  assert.equal(pool.queries.some((q) => /UPDATE cards SET current_balance/.test(q.sql)), true, 'ledger write refreshes balance + last_transaction_synced_at');
  assert.equal(JSON.stringify([recorded[0].summarize(detail), recorded[1].summarize(fixtures.transactions)]).includes('4242424242426754'), false, 'summaries never carry the PAN');
});

test('on-demand sync resets the failure counter on success and increments it on failure; never opens a card', async () => {
  const pool = recordingPool();
  let fail = false;
  const provider = {
    async card() { if (fail) throw Object.assign(new Error('Hnskj maintenance'), { kind: 'maintenance', code: 'PROVIDER_MAINTENANCE' }); return detail; },
    async transactions() { return fixtures.transactions; }
  };
  const registered = [];
  const sync = createOnDemandCardSync({ pool, provider, sessionEncryptionKey: Buffer.alloc(32, 1),
    recordCall: async (input) => input.action(), idFactory: () => 'fixed',
    stockFactory: (accountId) => ({ async register(card) { registered.push([accountId, card.providerCardId]); } }) });
  const candidate = { id: 'card-uuid', providerCardId: '5622', providerAccountId: '00000000-0000-4000-8000-000000000101', cardTypeId: 23 };
  const ok = await sync(candidate, { orderId: 'order-1', attemptNo: 1 });
  assert.equal(ok.cardId, 'card-uuid');
  assert.deepEqual(registered, [['00000000-0000-4000-8000-000000000101', '5622']], 'register goes to the card\'s own provider account');
  assert.equal(pool.queries.some((q) => /sync_consecutive_failures = 0/.test(q.sql)), true);
  fail = true;
  await assert.rejects(() => sync(candidate, { orderId: 'order-1', attemptNo: 2 }), (error) => error.code === 'PROVIDER_MAINTENANCE');
  assert.equal(pool.queries.some((q) => /sync_consecutive_failures = sync_consecutive_failures \+ 1/.test(q.sql)), true);
  assert.equal(pool.queries.some((q) => /card_stock_jobs|purchaseCard|INSERT INTO cards/.test(q.sql)), false, 'sync failure must not queue an opening');
});

test('on-demand sync without hnskj read credentials fails closed with CARD_SYNC_UNAVAILABLE', async () => {
  const sync = createOnDemandCardSync({ pool: recordingPool(), provider: null, sessionEncryptionKey: Buffer.alloc(32, 1) });
  await assert.rejects(() => sync({ id: 'c', providerCardId: '1', providerAccountId: 'a' }), (error) => error.code === 'CARD_SYNC_UNAVAILABLE');
});
