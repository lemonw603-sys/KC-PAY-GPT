import assert from 'node:assert/strict';
import test from 'node:test';

import { BillingAddressEnrichedCardMaterialSource, BrowserCardTransactionReader } from '../src/browser-card-transaction-reader.js';

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

test('manual card reconciliation explicitly binds Browser confirmation to one run', async () => {
  const reader = new BrowserCardTransactionReader({ sourceKind: 'MANUAL_IMPORT', runId: 'run-1' });
  const transactions = await reader.read();
  assert.deepEqual(await reader.reconcile({ transactions }), { matched: true, evidenceKind: 'BROWSER_PLUS_AND_LEDGER' });
  assert.equal((await reader.reconcile({ transactions: [{ ...transactions[0], runId: 'another-run' }] })).matched, false);
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

 test('deferred reader passes the flat run identity and loads only after payment intent exists', async () => {
  const { createDeferredTransactionReader } = await import('../src/browser-card-transaction-reader.js');
  let calls=0; let intentAt=null;
  const lazy=createDeferredTransactionReader(async (input)=>{
    calls++;
    assert.deepEqual(input,{runId:'run-fixture',orderId:'order-fixture',attemptId:'attempt-fixture'});
    return new BrowserCardTransactionReader({sourceKind:'HNSKJ',runId:input.runId,
      provider:{transactions:async()=>({data:{transactions:[],total:0,page:1,pageSize:50}})},
      providerCardId:'card-fixture',submitIntentAt:intentAt});
  },{runId:'run-fixture',orderId:'order-fixture',attemptId:'attempt-fixture'});
  assert.equal(calls,0);
  intentAt='2026-09-06T10:00:00Z';
  assert.deepEqual(await lazy.read(),[]);
  await lazy.reconcile({transactions:[]});
  assert.equal(calls,1);
 });
 test('failed deferred evidence lookup can recover without creating another payment', async()=>{
  const { createDeferredTransactionReader } = await import('../src/browser-card-transaction-reader.js');
  let calls=0;
  const lazy=createDeferredTransactionReader(async()=>{
    if(++calls===1)throw Error('temporary database error');
    return {read:async()=>[],reconcile:async()=>({matched:false})};
  },{runId:'run-fixture'});
  await assert.rejects(lazy.read(),/temporary database/);
  assert.deepEqual(await lazy.read(),[]);assert.equal(calls,2);
 });
