import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchOneBarkNotification } from '../src/notifications/bark-dispatcher.js';

function delivery(attemptCount = 1) {
  return {
    id: 9, alertId: 'alert-1', attemptCount, incidentVersion: 2,
    title: '库存异常', message: '剩余 1 张', severity: 'warning'
  };
}

test('dispatches and marks one Bark notification sent', async () => {
  const calls = [];
  const repository = {
    enqueueOpenAlerts: async () => calls.push('enqueue'),
    claimNext: async () => delivery(),
    markSent: async (id, version) => calls.push(['sent', id, version])
  };
  const client = { send: async (payload) => calls.push(['send', payload]) };
  const result = await dispatchOneBarkNotification({ repository, client });
  assert.equal(result.delivered, true);
  assert.deepEqual(calls[0], 'enqueue');
  assert.equal(calls[1][0], 'send');
  assert.deepEqual(calls[2], ['sent', 9, { incidentVersion: 2 }]);
});

test('records retry metadata and does not throw delivery failures out of the runner', async () => {
  let failure;
  const repository = {
    enqueueOpenAlerts: async () => {},
    claimNext: async () => delivery(2),
    markFailed: async (_id, input) => {
      failure = input;
      return { exhausted: false, delaySeconds: 30 };
    }
  };
  const error = Object.assign(new Error('temporary'), { retryable: true });
  const result = await dispatchOneBarkNotification({
    repository, client: { send: async () => { throw error; } }, maxAttempts: 8
  });
  assert.equal(result.delivered, false);
  assert.equal(failure.attemptCount, 2);
  assert.equal(failure.retryable, true);
  assert.equal(failure.maxAttempts, 8);
  assert.equal(failure.incidentVersion, 2);
});

test('returns idle when no open alert is dispatchable', async () => {
  const result = await dispatchOneBarkNotification({
    repository: { enqueueOpenAlerts: async () => {}, claimNext: async () => null },
    client: { send: async () => assert.fail('must not send') }
  });
  assert.deepEqual(result, { handled: false });
});

// D-414 补记十三第 4 条：token 失效推送一路带着登录页链接发到 Bark（展示层 → 客户端 → 请求体），点开就是 highvcc。
test('highvcc token-expired push reaches Bark with the login page link', async () => {
  const { createBarkClient } = await import('../src/notifications/bark-client.js');
  let body;
  const client = createBarkClient({
    serverUrl: 'https://api.day.app', deviceKey: 'device-secret',
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ code: 200 }) };
    }
  });
  const repository = {
    enqueueOpenAlerts: async () => {},
    claimNext: async () => ({ ...delivery(), type: 'PROVIDER_TOKEN_EXPIRED', severity: 'critical',
      title: 'highvcc 登录失效', message: '16:22 起失效，新卡开不出。' }),
    markSent: async () => {}
  };
  const result = await dispatchOneBarkNotification({ repository, client });
  assert.equal(result.delivered, true);
  assert.equal(body.url, 'https://www.highvcc.com');
  assert.equal(body.title, 'highvcc 登录失效');
});
