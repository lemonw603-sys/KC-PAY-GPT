import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardFundingAdminService } from '../src/services/card-funding-admin-service.js';

test('lists card funding attempts without exposing credentials', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/COUNT\(\*\)/.test(sql)) return [[{ total: 1 }]];
      return [[{
        id: 'attempt-1', card_id: 'card-1', order_id: 'order-1', amount: '16.000000', currency: 'USD',
        status: 'MANUAL_REVIEW', funds_risk_state: 'UNKNOWN', external_reference: null,
        submit_intent_at: new Date('2026-08-22T00:00:00Z'), submitted_at: null,
        last_reconciled_at: null, finished_at: null, created_at: new Date('2026-08-22T00:00:00Z'),
        updated_at: new Date('2026-08-22T00:00:00Z'), provider_card_id: '612', last4: '1666',
        public_no: 'PJ-ABCDE-FGHIJ-KLMNO-PQRST', provider: 'hnskj',
        provider_call_outcome: 'UNCERTAIN', provider_http_status: 504,
        provider_business_code: null, provider_finished_at: null,
        result_summary_json: JSON.stringify({ kind: 'timeout', secret: 'must-not-be-present' })
      }]];
    }
  };
  const result = await createCardFundingAdminService({ pool }).list({ status: 'MANUAL_REVIEW' });
  assert.equal(result.total, 1);
  assert.equal(result.attempts[0].status, 'MANUAL_REVIEW');
  assert.equal(result.attempts[0].last4, '1666');
  assert.equal(result.attempts[0].resultSummary.secret, '[REDACTED]');
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /provider_calls/);
});

test('rejects invalid card funding list filters', async () => {
  const service = createCardFundingAdminService({ pool: { query: async () => { throw new Error('must not query'); } } });
  await assert.rejects(() => service.list({ status: 'SETTLED_OR_UNKNOWN' }), { code: 'INVALID_ADMIN_QUERY' });
});

test('filters UNKNOWN by funds risk state rather than attempt status', async () => {
  const queries = [];
  const service = createCardFundingAdminService({ pool: {
    async query(sql, params) {
      queries.push({ sql, params });
      return /COUNT\(\*\)/.test(sql) ? [[{ total: 0 }]] : [[]];
    }
  } });
  await service.list({ status: 'UNKNOWN' });
  assert.match(queries[0].sql, /funds_risk_state = 'UNKNOWN'/);
  assert.deepEqual(queries[0].params, []);
});
