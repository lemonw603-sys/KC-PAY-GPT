import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app/create-app.js';

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('exposes liveness and readiness without legacy automation', async () => {
  const app = createApp({ readiness: async () => ({ ready: true }) });
  await withServer(app, async (baseUrl) => {
    const live = await fetch(`${baseUrl}/health/live`);
    const ready = await fetch(`${baseUrl}/health/ready`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' });
    assert.equal(live.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(live.headers.has('x-powered-by'), false);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready' });
  });
});

test('readiness fails closed and errors do not expose details', async () => {
  const app = createApp({ readiness: async () => { throw new Error('database password leaked'); } });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'not_ready' });
  });
});
