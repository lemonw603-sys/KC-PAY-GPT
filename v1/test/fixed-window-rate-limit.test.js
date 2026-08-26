import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixedWindowRateLimit } from '../src/app/fixed-window-rate-limit.js';

function request(limiter, ip) {
  const headers = {};
  let status = 200;
  let body = null;
  let continued = false;
  limiter({ ip }, {
    setHeader(name, value) { headers[name] = value; },
    status(value) { status = value; return this; },
    json(value) { body = value; return this; }
  }, () => { continued = true; });
  return { body, continued, headers, status };
}

test('rate limiter bounds retained client state under rotating IP traffic', () => {
  const limiter = createFixedWindowRateLimit({ limit: 1, maxClients: 2 });
  assert.equal(request(limiter, '192.0.2.1').continued, true);
  assert.equal(request(limiter, '192.0.2.1').status, 429);
  assert.equal(request(limiter, '192.0.2.2').continued, true);
  assert.equal(request(limiter, '192.0.2.3').continued, true);
  assert.equal(request(limiter, '192.0.2.1').continued, true);
});

test('rate limiter rejects an invalid client-state bound', () => {
  assert.throws(() => createFixedWindowRateLimit({ maxClients: 0 }), /positive safe integer/);
});
