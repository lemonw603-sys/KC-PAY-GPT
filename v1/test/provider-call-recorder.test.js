import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderError } from '../src/providers/http-client.js';
import { recordProviderCall } from '../src/providers/provider-call-recorder.js';
import { redactSensitiveFields, redactSensitiveText } from '../src/security/redaction.js';

function fakePool(calls) {
  return {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes('INSERT INTO provider_calls')) return [{ insertId: 41 }];
      return [{ affectedRows: 1 }];
    }
  };
}

test('redaction removes API keys, tokens, PAN and CVV recursively', () => {
  const safe = redactSensitiveFields({
    apiKey: 'nhs_real-looking-key',
    nested: {
      accessToken: 'eyJ.secret.value',
      cardNumber: '4242424242424242',
      cvv: '123',
      message: 'Bearer abcdef 5555555555554444'
    }
  });

  assert.deepEqual(safe, {
    apiKey: '[REDACTED]',
    nested: {
      accessToken: '[REDACTED]',
      cardNumber: '[REDACTED]',
      cvv: '[REDACTED]',
      message: 'Bearer [REDACTED] ****4444'
    }
  });
});

test('redaction removes labelled secrets from untrusted error text', () => {
  const unsafe = [
    'accessToken=eyJheader.payload.signature',
    'sessionToken: eyJone.two.three.four.five',
    'cardNumber="4242424242424242"',
    'cvv: 123',
    'api_key=stable-provider-secret',
    'Authorization: Bearer bearer-secret'
  ].join(' ');
  const safe = redactSensitiveText(unsafe);

  assert.equal(safe.includes('eyJheader.payload.signature'), false);
  assert.equal(safe.includes('eyJone.two.three.four.five'), false);
  assert.equal(safe.includes('4242424242424242'), false);
  assert.equal(safe.includes('stable-provider-secret'), false);
  assert.equal(safe.includes('bearer-secret'), false);
  assert.match(safe, /accessToken=\[REDACTED\]/);
});

test('records a successful provider call with a sanitized summary', async () => {
  const calls = [];
  const result = await recordProviderCall({
    pool: fakePool(calls),
    orderId: 'order-1',
    provider: 'hnskj',
    operation: 'account_balance',
    action: async () => ({ balance: '1.00', apiKey: 'nhs_should-not-persist' }),
    summarize: (value) => value
  });

  assert.equal(result.balance, '1.00');
  assert.equal(calls.length, 2);
  const storedSummary = calls[1].parameters[3];
  assert.equal(storedSummary.includes('nhs_should-not-persist'), false);
  assert.equal(storedSummary.includes('[REDACTED]'), true);
  assert.equal(calls[1].parameters[0], 'SUCCESS');
});

test('records an uncertain provider failure without swallowing it', async () => {
  const calls = [];
  const error = new ProviderError('request failed for nhs_secret-value', {
    provider: 'zzshu',
    kind: 'timeout',
    uncertain: true,
    retryable: false
  });

  await assert.rejects(
    recordProviderCall({
      pool: fakePool(calls),
      orderId: 'order-1',
      provider: 'zzshu',
      operation: 'create_direct',
      action: async () => { throw error; }
    }),
    (received) => received === error
  );

  assert.equal(calls[1].parameters[0], 'UNCERTAIN');
  assert.equal(calls[1].parameters[3].includes('nhs_secret-value'), false);
});

test('treats lost audit persistence after a side effect as uncertain', async () => {
  let queryCount = 0;
  const pool = {
    query: async () => {
      queryCount += 1;
      if (queryCount === 1) return [{ insertId: 99 }];
      throw new Error('database unavailable');
    }
  };

  await assert.rejects(
    recordProviderCall({
      pool,
      orderId: 'order-1',
      provider: 'zzshu',
      operation: 'create_direct',
      sideEffecting: true,
      action: async () => ({ orderNo: '12', cardKey: 'DIRECT-fixture' })
    }),
    (error) => error instanceof ProviderError
      && error.kind === 'audit'
      && error.uncertain === true
      && error.retryable === false
  );
});
