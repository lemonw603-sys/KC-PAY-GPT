import assert from 'node:assert/strict';
import test from 'node:test';
import { BarkDeliveryError, createBarkClient } from '../src/notifications/bark-client.js';

test('sends a redacted Bark JSON payload without placing the device key in the URL', async () => {
  let captured;
  const client = createBarkClient({
    serverUrl: 'https://api.day.app/',
    deviceKey: 'device-secret',
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 200, json: async () => ({ code: 200 }) };
    }
  });
  const result = await client.send({
    title: '订单异常',
    message: 'authorization: Bearer secret-token card=4242424242424242',
    severity: 'critical'
  });
  assert.deepEqual(result, { delivered: true, status: 200 });
  assert.equal(captured.url, 'https://api.day.app/push');
  assert.equal(captured.body.device_key, 'device-secret');
  assert.equal(captured.body.level, 'critical');
  assert.doesNotMatch(captured.body.body, /secret-token|4242424242424242/);
  assert.match(captured.body.body, /\*\*\*\*4242/);
});

test('classifies permanent and retryable Bark failures', async () => {
  const permanent = createBarkClient({
    serverUrl: 'https://api.day.app', deviceKey: 'key',
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ code: 401 }) })
  });
  await assert.rejects(permanent.send({ title: 'x', message: 'y' }), (error) => {
    assert.equal(error instanceof BarkDeliveryError, true);
    assert.equal(error.retryable, false);
    return true;
  });

  const retryable = createBarkClient({
    serverUrl: 'https://api.day.app', deviceKey: 'key',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ code: 503 }) })
  });
  await assert.rejects(retryable.send({ title: 'x', message: 'y' }), (error) => {
    assert.equal(error.retryable, true);
    return true;
  });
});
