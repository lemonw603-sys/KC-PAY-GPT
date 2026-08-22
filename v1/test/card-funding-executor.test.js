import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCardFundingAttempt } from '../src/services/card-funding-executor.js';

function repositoryFor(error = null) {
  const calls = [];
  return {
    calls,
    async begin(input) { calls.push({ type: 'begin', input }); return {
      attemptId: input.attemptId, providerCallId: 7, cardId: 'card-1', amount: '12', currency: 'USD'
    }; },
    async finish(input) { calls.push({ type: 'finish', input }); if (error) throw error; }
  };
}

test('card funding executor settles a definite provider success', async () => {
  const repository = repositoryFor();
  const result = await executeCardFundingAttempt({ repository, attemptId: 'attempt-1',
    providerAccountId: 'account-1', requestKey: 'funding-request-1',
    provider: { rechargeCard: async () => ({ success: true, data: { status: 'success', id: 'r-1' } }) }
  });
  assert.deepEqual(result, { attemptId: 'attempt-1', state: 'SETTLED', externalReference: 'r-1' });
  assert.equal(repository.calls[1].input.fundsRiskState, 'SETTLED');
  assert.equal(repository.calls[1].input.outcome, 'SUCCESS');
});

test('card funding executor keeps pending funding active', async () => {
  const repository = repositoryFor();
  const result = await executeCardFundingAttempt({ repository, attemptId: 'attempt-2',
    providerAccountId: 'account-1', requestKey: 'funding-request-2',
    provider: { rechargeCard: async () => ({ success: true, data: { status: 'pending', id: 'r-2' } }) }
  });
  assert.deepEqual(result, { attemptId: 'attempt-2', state: 'PENDING', externalReference: 'r-2' });
  assert.equal(repository.calls[1].input.fundsRiskState, 'ACTIVE');
  assert.equal(repository.calls[1].input.status, 'PENDING');
  assert.equal(repository.calls[1].input.outcome, 'SUCCESS');
});

test('card funding executor locks uncertain provider errors', async () => {
  const repository = repositoryFor();
  const result = await executeCardFundingAttempt({ repository, attemptId: 'attempt-3',
    providerAccountId: 'account-1', requestKey: 'funding-request-3',
    provider: { rechargeCard: async () => { const error = new Error('timeout'); error.uncertain = true; error.kind = 'timeout'; throw error; } }
  });
  assert.deepEqual(result, { attemptId: 'attempt-3', state: 'UNKNOWN', code: null });
  assert.equal(repository.calls[1].input.fundsRiskState, 'UNKNOWN');
  assert.equal(repository.calls[1].input.status, 'MANUAL_REVIEW');
  assert.equal(repository.calls[1].input.outcome, 'UNCERTAIN');
});
