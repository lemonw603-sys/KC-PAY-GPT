import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiFailureLockedSql, apiFailureReleasableSql, apiFailureReleaseConfirmation, apiFailureReleaseEligibility,
  apiFailureReleaseInputsSql, createApiFailureReleaseService
} from '../src/services/api-failure-release-service.js';
import { successfulPurchaseSql } from '../src/domain/card-purchase-evidence.js';

// 欠账 23（2026-09-27）：API 单对方确认失败、卡锁在对账 → 核实没扣款后「放卡退卡密」。
const base = {
  orderStatus: 'RECHARGE_FAILED', executorKind: 'API', reconciliationLedgers: 1,
  clearedFailedAttempts: 1, openFundAttempts: 0, chargedSinceReservation: 0
};

test('eligible only for a provider-confirmed API failure whose card is still locked and shows no charge', () => {
  assert.deepEqual(apiFailureReleaseEligibility(base), { eligible: true, code: null, reason: null, status: null });
  const code = (patch) => apiFailureReleaseEligibility({ ...base, ...patch }).code;
  assert.equal(code({ executorKind: 'BROWSER' }), 'API_FAILURE_RELEASE_WRONG_EXECUTOR');
  assert.equal(code({ executorKind: null }), 'API_FAILURE_RELEASE_WRONG_EXECUTOR');
  assert.equal(code({ orderStatus: 'SUBMIT_UNKNOWN' }), 'API_FAILURE_RELEASE_NOT_FAILED');
  assert.equal(code({ reconciliationLedgers: 0 }), 'API_FAILURE_RELEASE_NOTHING_LOCKED', 'already released by the card sync');
  assert.equal(code({ clearedFailedAttempts: 0 }), 'API_FAILURE_RELEASE_FUNDS_NOT_CLEARED');
  assert.equal(code({ openFundAttempts: 1 }), 'API_FAILURE_RELEASE_FUNDS_NOT_CLEARED', 'an UNKNOWN/SETTLED attempt goes the verify path');
  assert.equal(code({ chargedSinceReservation: 1 }), 'API_FAILURE_RELEASE_CHARGE_OBSERVED');
  // mysql2 gives COUNT(*) back as numbers or strings depending on driver settings — both must behave the same
  assert.equal(apiFailureReleaseEligibility({ ...base, reconciliationLedgers: '1', clearedFailedAttempts: '1', openFundAttempts: '0', chargedSinceReservation: '0' }).eligible, true);
  assert.equal(code({ chargedSinceReservation: '2' }), 'API_FAILURE_RELEASE_CHARGE_OBSERVED');
});

test('the list / needs-person SQL is built from the same inputs the service reads, and uses the shared charge rule', () => {
  const inputs = apiFailureReleaseInputsSql('o');
  const locked = apiFailureLockedSql('o');
  const releasable = apiFailureReleasableSql('o');
  for (const key of ['executor_kind', 'reconciliation_ledgers']) assert.ok(locked.includes(inputs[key]), key);
  for (const key of ['open_fund_attempts', 'cleared_failed_attempts', 'charged_since_reservation']) assert.ok(releasable.includes(inputs[key]), key);
  assert.ok(releasable.includes(locked), 'releasable is locked plus the money conditions');
  assert.ok(inputs.charged_since_reservation.includes(successfulPurchaseSql('afr_t')));
  assert.throws(() => apiFailureReleaseInputsSql('o; DROP TABLE x'), /invalid SQL alias/);
});

test('a wrong or missing confirmation is refused before any database work', async () => {
  let connections = 0;
  const release = createApiFailureReleaseService({ pool: { getConnection: async () => { connections += 1; throw new Error('no'); } } });
  await assert.rejects(release('PJV1-AAAAAAAAAAAAAAAAAAAA', {}), { code: 'API_FAILURE_RELEASE_CONFIRMATION_REQUIRED' });
  await assert.rejects(release('PJV1-AAAAAAAAAAAAAAAAAAAA', { confirmation: apiFailureReleaseConfirmation('PJV1-BBBBBBBBBBBBBBBBBBBB') }),
    { code: 'API_FAILURE_RELEASE_CONFIRMATION_REQUIRED' });
  await assert.rejects(release('short', { confirmation: apiFailureReleaseConfirmation('short') }), { code: 'ADMIN_ORDER_NOT_FOUND' });
  assert.equal(connections, 0);
  assert.equal(apiFailureReleaseConfirmation('PJV1-X'), '确认没扣款 PJV1-X');
});
