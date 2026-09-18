import assert from 'node:assert/strict';
import test from 'node:test';
import { assessCardSideCharge, parseHnskjTradeTime } from '../src/services/unknown-submission-evidence.js';

// 行形状来自 2026-09-18 生产 card_transactions 实查（hnskj 卡 4458 / 2833 / 493）。
const settled = { provider_transaction_id: 'a', transaction_type: 'PURCHASE', status: 'SETTLED', amount: '15.710000',
  currency: 'USD', original_amount: '982.140000', original_currency: 'PHP', merchant_name: 'OPENAI',
  settlement_status: null, trade_time_raw: '2026-09-17 09:34:34', occurred_at: null };
const failed = { ...settled, provider_transaction_id: 'b', transaction_type: 'purchase', status: 'failed',
  amount: '-78.240000', merchant_name: 'OPENAI *CHATGPT SUBSCR', settlement_status: 'not_settle' };
const chargeback = { ...settled, provider_transaction_id: 'c', transaction_type: 'chargeback', status: '平台监控已登记拒付', amount: '76.000000' };

test('hnskj trade_time_raw is a UTC+8 local string (contract: "2026-09-17 09:34:34" == 01:34 UTC)', () => {
  assert.equal(parseHnskjTradeTime('2026-09-17 09:34:34').toISOString(), '2026-09-17T01:34:34.000Z');
  assert.equal(parseHnskjTradeTime('nonsense'), null);
});

test('only settled OpenAI purchases after the submission count as a charge; failed / chargeback rows do not', () => {
  const result = assessCardSideCharge({ purchases: [failed, chargeback, settled], submittedAt: '2026-09-17T01:30:00Z' });
  assert.equal(result.charged, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].providerTransactionId, 'a');
  assert.match(result.summary, /1 笔 OpenAI 成功扣款/);
});

test('a settled purchase from before the submission (beyond clock skew) is not this order\'s charge', () => {
  const result = assessCardSideCharge({ purchases: [settled], submittedAt: '2026-09-17T03:00:00Z' });
  assert.equal(result.charged, false);
  assert.match(result.summary, /没有 OpenAI 成功扣款/);
});
