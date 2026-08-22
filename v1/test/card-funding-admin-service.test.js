import assert from 'node:assert/strict';
import test from 'node:test';
import { createCardFundingAdminService } from '../src/services/card-funding-admin-service.js';

function poolFor(attempt) {
  const queries = [];
  return {
    queries,
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async query(sql, params) {
          queries.push({ sql, params });
          if (/SELECT id, status, funds_risk_state/.test(sql)) return [[attempt]];
          return [{ affectedRows: 1, insertId: 1 }];
        }
      };
    }
  };
}

test('manual UNKNOWN resolution confirms settlement without creating a provider call', async () => {
  const pool = poolFor({ id: 'attempt-1', status: 'UNKNOWN', funds_risk_state: 'UNKNOWN' });
  const service = createCardFundingAdminService({ pool });
  const result = await service.resolveUnknown({
    attemptId: 'attempt-1',
    action: 'CONFIRM_SETTLED',
    actorId: 'operator-1',
    note: '只读余额和流水均已核对，确认已入账',
    confirmation: '确认卡充值对账 attempt-1'
  });
  assert.equal(result.status, 'SETTLED');
  assert.equal(result.fundsRiskState, 'SETTLED');
  assert.equal(pool.queries.some((item) => /provider_calls/.test(item.sql)), false);
});

test('manual UNKNOWN resolution requires the exact confirmation and an operator note', async () => {
  const service = createCardFundingAdminService({
    pool: poolFor({ id: 'attempt-2', status: 'UNKNOWN', funds_risk_state: 'UNKNOWN' })
  });
  await assert.rejects(
    service.resolveUnknown({ attemptId: 'attempt-2', action: 'CONFIRM_NOT_CHARGED', actorId: 'admin', note: 'short', confirmation: 'wrong' }),
    (error) => error.code === 'INVALID_CARD_FUNDING_MANUAL_RESOLUTION'
  );
});
