import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { BrowserExecutionService } from '../src/executor.js';
import { LocalPlaywrightRuntimeAdapter } from '../src/runtime-adapter.js';
import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { createSyntheticJob } from '../src/fixtures.js';
import { classifySafeAbort } from '../src/shared-runtime-integration.js';

for (const [status, reason, target] of [
  [403, 'CHATGPT_ACCESS_BLOCKED', 'RECHARGE_FAILED'],
  [429, 'CHATGPT_ACCESS_BLOCKED', 'RECHARGE_FAILED'],
  [401, 'SESSION_INVALID', 'WAITING_FOR_SESSION'],
  [503, 'ACCOUNT_STATUS_UNKNOWN', 'RECHARGE_FAILED'],
]) {
  test(`probe HTTP ${status} persists safe facts with bounded retries and unchanged classification`, async () => {
    let requests = 0, paymentCalls = 0;
    const server = createServer((req, res) => {
      if (req.url === '/api/auth/session') {
        requests++;
        res.writeHead(status, { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'private-ray-value' });
        return res.end('private-response-token buyer@example.test');
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Fixture</title><main>ready</main>');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const sink = new MemoryEvidenceSink();
    try {
      const executor = new BrowserExecutionService({
        runtimeAdapter: new LocalPlaywrightRuntimeAdapter({ browserType: chromium }),
        evidenceSink: sink, timeoutMs: 3000,
      });
      const job = createSyntheticJob({ state: 'RUNNING', metadata: {
        source: 'fixture',
        pageContract: { urlPrefix: `http://127.0.0.1:${server.address().port}/`, title: 'Fixture', requiredSelector: 'main', markerText: '' },
        accountProbeContract: { path: '/api/auth/session' },
        sessionIdentity: { email: 'buyer@example.test' },
      } });
      await assert.rejects(() => executor.execute(job, {
        assertLease: async () => true,
        paymentHandler: async () => { paymentCalls++; throw new Error('must not reach payment'); },
      }), e => {
        assert.equal(e.reason, reason, e.stack);
        assert.equal(classifySafeAbort(e).targetOrderStatus, target);
        return true;
      });
      assert.equal(requests, status === 401 ? 1 : 3);
      assert.equal(paymentCalls, 0);
      const freeze = sink.events.find(e => e.summary.action === 'fail-closed');
      assert.equal(freeze.summary.probeAttempts, requests);
      assert.ok(freeze.summary.probeElapsedMs >= 0);
      const {probeAttempts, probeElapsedMs, ...summary} = freeze.summary;
      assert.deepEqual(summary, {
        action: 'fail-closed', reason, probeStage: 'session-endpoint', httpStatus: status, hasCfRay: true,
      });
      assert.equal(sink.events.filter(e => e.type === 'freeze').length, 1);
      for (const secret of ['private-response-token', 'buyer@example.test', 'private-ray-value']) {
        assert.equal(JSON.stringify(sink.events).includes(secret), false);
      }
    } finally {
      server.close(); await once(server, 'close');
    }
  });
}
