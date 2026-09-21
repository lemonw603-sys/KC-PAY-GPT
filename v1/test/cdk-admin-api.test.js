import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app/create-app.js';
import { CdkBatchError } from '../src/services/cdk-service.js';

test('CDK search/bulk/metadata routes enforce login and origin and pass errors without false success', async () => {
  let seen;
  const app = createApp({
    adminAuth: { authenticateRequest: async (req) => req.get('authorization') === 'test-session' },
    listAdminCdkCodes: async (input) => { seen = input; return { total: 1, codes: [] }; },
    updateAdminCdkCodes: async (input) => {
      seen = input;
      if (!input.ids.length) throw new CdkBatchError('empty selection', 'INVALID_CDK_IDS');
      return { selected: 1, changed: 1, unchanged: 0 };
    },
    updateAdminCdkBatchMetadata: async (batch, input) => { seen = { batch, ...input }; return { batchNo: batch }; }
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    for (const path of ['/api/v1/admin/cdks/search', '/api/v1/admin/cdks/bulk', '/api/v1/admin/cdks/B-test/metadata']) {
      assert.equal((await request(path, {})).status, 401);
      assert.equal((await request(path, {}, { authorization: 'test-session', origin: 'https://other.test' })).status, 403);
    }
    const headers = { authorization: 'test-session', origin: base };
    assert.equal((await request('/api/v1/admin/cdks/search', { q: 'full-code', offset: 0 }, headers)).status, 200);
    assert.equal(seen.q, 'full-code');
    const bad = await request('/api/v1/admin/cdks/bulk', { action: 'revoke', ids: [] }, headers);
    assert.equal(bad.status, 400); assert.equal((await bad.json()).error, 'invalid_cdk_ids');
    assert.equal((await request('/api/v1/admin/cdks/bulk', { action: 'issue', ids: ['id-1'] }, headers)).status, 200);
    assert.equal((await request('/api/v1/admin/cdks/B-test/metadata', { note: 'channel' }, headers)).status, 200);
    assert.deepEqual(seen, { batch: 'B-test', note: 'channel' });
  } finally { await new Promise((r) => server.close(r)); }
});
