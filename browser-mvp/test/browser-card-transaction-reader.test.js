import assert from 'node:assert/strict';
import test from 'node:test';

import { BillingAddressEnrichedCardMaterialSource, BrowserCardTransactionReader, createCardLedgerSource } from '../src/browser-card-transaction-reader.js';

test('HNSKJ reconciliation requires exactly one recent successful plausible Plus purchase', async () => {
  const provider = { async transactions(_cardId, { page }) {
    return { data: { page, pageSize: 50, total: 2, transactions: [
      { id: 'txn-1', type: 'PURCHASE', status: 'success', amount: '16.50', currency: 'USD',
        tradeTime: '2026-09-06T10:01:00Z', merchantName: 'OPENAI', rawHash: 'a'.repeat(64) },
      { id: 'txn-old', type: 'PURCHASE', status: 'success', amount: '16.50', currency: 'USD',
        tradeTime: '2026-09-05T10:01:00Z', merchantName: 'OPENAI', rawHash: 'b'.repeat(64) },
    ] } };
  } };
  const reader = new BrowserCardTransactionReader({
    sourceKind: 'HNSKJ', provider, providerCardId: 'card-1', runId: 'run-1',
    submitIntentAt: '2026-09-06T10:00:00Z',
  });
  const result = await reader.reconcile({ transactions: await reader.read() });
  assert.equal(result.matched, true);
  assert.equal(result.evidenceKind, 'HNSKJ_TRANSACTION');
  assert.equal(result.candidateCount, 1);
  assert.match(result.transactionHash, /^[a-f0-9]{64}$/);
  assert.notEqual(result.transactionHash, 'a'.repeat(64), 'the shared reader must hash the normalized raw transaction itself');
});

test('HNSKJ reconciliation rejects unrelated, ambiguous or implausible transactions', async () => {
  const base = { type: 'PURCHASE', status: 'success', amount: '16.50', currency: 'USD',
    tradeTime: '2026-09-06T10:01:00Z', merchantName: 'OPENAI' };
  const reader = new BrowserCardTransactionReader({
    sourceKind: 'HNSKJ', provider: { transactions() {} }, providerCardId: 'card-1', runId: 'run-1',
    submitIntentAt: '2026-09-06T10:00:00Z',
  });
  assert.equal((await reader.reconcile({ transactions: [{ ...base, amount: '2.00' }] })).matched, false);
  assert.equal((await reader.reconcile({ transactions: [base, { ...base, id: 'second' }] })).matched, false);
  assert.equal((await reader.reconcile({ transactions: [{ ...base, merchantName: 'Other merchant' }] })).matched, false);
  assert.equal((await reader.reconcile({ transactions: [{ ...base, tradeTime: '2026-09-06T12:01:00Z' }] })).matched, false);
});

test('manual card evidence can no longer be a self-made marker: a ledger source, cardId and intent time are required (D-268 ①)', () => {
  assert.throws(() => new BrowserCardTransactionReader({ sourceKind: 'MANUAL_IMPORT', runId: 'run-1' }), /ledgerSource/);
  assert.throws(() => new BrowserCardTransactionReader({ sourceKind: 'MANUAL_IMPORT', runId: 'run-1', cardId: 'c', ledgerSource: { async listPurchases() {} } }), /submitIntentAt/);
});

test('createCardLedgerSource reads card_transactions by card and intent window, keeping rows whose occurred_at is unknown', async () => {
  const queries = [];
  const source = createCardLedgerSource({ pool: { async query(sql, params) { queries.push({ sql: sql.replace(/\s+/g, ' '), params }); return [[{ provider_transaction_id: 'x' }]]; } } });
  const rows = await source.listPurchases({ cardId: 'card-uuid', since: '2026-09-06T09:55:00Z', until: '2026-09-06T11:05:00Z' });
  assert.equal(rows.length, 1);
  assert.match(queries[0].sql, /FROM card_transactions WHERE card_id = \? AND \(occurred_at >= \? OR occurred_at IS NULL\) AND \(occurred_at <= \? OR occurred_at IS NULL\)/);
  assert.equal(queries[0].params[0], 'card-uuid');
  assert.equal('refresh' in source, false);
  assert.equal(typeof createCardLedgerSource({ pool: { async query() {} }, refresh: async () => ({}) }).refresh, 'function');
});

test('billing address enrichment keeps imported addresses and fills only cards without one', async () => {
  let addressReads = 0;
  const address = { name: 'A', country: 'US', state: 'DE', line1: '1 St', city: 'Wilmington', postalCode: '19801' };
  const source = new BillingAddressEnrichedCardMaterialSource({
    cardSource: { async load(ref) { return ref === 'imported' ? { pan: '1', billingAddress: address } : { pan: '2' }; } },
    billingAddressSource: { async load() { addressReads += 1; return address; } },
  });
  assert.equal((await source.load('imported')).billingAddress, address);
  assert.equal(addressReads, 0);
  assert.equal((await source.load('hnskj')).billingAddress, address);
  assert.equal(addressReads, 1);
});

// 第④步（D-248）：MANUAL_IMPORT 卡注入 ledgerSource 后走真证据（v1 card_transactions 的真实行形状，
// 2026-09-18 生产实查：PURCHASE / COMPLETE / 15.75 USD / 982.14 PHP / OPENAI / APPROVE，occurred_at 为 ISO UTC）。
const highvccRow = { provider_transaction_id: 'HGA1', transaction_type: 'PURCHASE', status: 'COMPLETE', amount: '15.750000', currency: 'USD',
  original_amount: '982.140000', original_currency: 'PHP', merchant_name: 'OPENAI', settlement_status: 'APPROVE',
  occurred_at: '2026-09-06T10:02:00.000Z', raw_hash: 'c'.repeat(64) };
const pendingRow = { ...highvccRow, provider_transaction_id: 'HGA2', status: 'PENDING', amount: '0.000000', original_amount: '0.000000', original_currency: 'USD',
  merchant_name: 'OPENAI                 SAN FRANCISCOCAUS', raw_hash: 'd'.repeat(64) };

test('manual card with a ledger source matches exactly one settled OpenAI Plus purchase inside the intent window', async () => {
  const windows = [];
  const reader = new BrowserCardTransactionReader({
    sourceKind: 'MANUAL_IMPORT', runId: 'run-1', cardId: 'card-uuid', submitIntentAt: '2026-09-06T10:00:00Z',
    ledgerSource: { async listPurchases(w) { windows.push(w); return [pendingRow, highvccRow]; } },
  });
  const transactions = await reader.read();
  assert.equal(windows[0].cardId, 'card-uuid');
  assert.equal(windows[0].since.toISOString(), '2026-09-06T09:55:00.000Z');
  const result = await reader.reconcile({ transactions });
  assert.equal(result.matched, true);
  assert.equal(result.evidenceKind, 'CARD_LEDGER_TRANSACTION');
  assert.equal(result.candidateCount, 1, 'the PENDING $0 authorization row is not a charge');
  assert.equal(result.transactionHash, 'c'.repeat(64));
  assert.equal(result.evidence.candidates[0].originalCurrency, 'PHP');
});

test('manual card: no candidate → one refresh (token-bound, the out-of-window exception); expired token is reported, never faked as a match', async () => {
  let refreshes = 0;
  const reader = new BrowserCardTransactionReader({
    sourceKind: 'MANUAL_IMPORT', runId: 'run-1', cardId: 'card-uuid', submitIntentAt: '2026-09-06T10:00:00Z',
    ledgerSource: {
      async listPurchases() { return []; },
      async refresh() { refreshes += 1; throw Object.assign(new Error('登录已失效'), { code: 'HIGHVCC_TOKEN_EXPIRED' }); },
    },
  });
  const result = await reader.reconcile({ transactions: await reader.read() });
  assert.equal(refreshes, 1);
  assert.equal(result.matched, false);
  assert.equal(result.candidateCount, 0);
  assert.equal(result.evidence.tokenExpired, true);
  assert.equal(result.evidence.refreshed.code, 'HIGHVCC_TOKEN_EXPIRED');
});

test('manual card: a successful refresh re-reads the ledger and can then match', async () => {
  let rows = [];
  const reader = new BrowserCardTransactionReader({
    sourceKind: 'MANUAL_IMPORT', runId: 'run-1', cardId: 'card-uuid', submitIntentAt: '2026-09-06T10:00:00Z',
    ledgerSource: { async listPurchases() { return rows; }, async refresh() { rows = [highvccRow]; return { written: 1 }; } },
  });
  const result = await reader.reconcile({ transactions: await reader.read() });
  assert.equal(result.matched, true);
  assert.equal(result.evidence.refreshed.ok, true);
  assert.throws(() => new BrowserCardTransactionReader({ sourceKind: 'MANUAL_IMPORT', runId: 'r', submitIntentAt: '2026-09-06T10:00:00Z', ledgerSource: { async listPurchases() {} } }), /cardId/);
});
