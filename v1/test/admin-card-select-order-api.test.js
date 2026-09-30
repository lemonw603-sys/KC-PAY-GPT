// D-414 选卡顺序的保存接口（D-414 自查 2026-09-30，Lemon 批「加常驻测试」）。
// 服务层（校验、审计、读回）在 card-reuse-top-up-mysql-integration 里对真库测；这里只钉住 HTTP 这一层：
// 要登录、要同源、坏值回 400 且不冒充成功、把值和操作人原样交给服务。
import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app/create-app.js';
import { PublicApiError } from '../src/domain/public-api-error.js';

test('选卡顺序保存接口：要登录、要同源；坏值 400；好值原样交给服务并返回旧值 → 新值', async () => {
  const seen = [];
  const app = createApp({
    adminAuth: { authenticateRequest: async (req) => req.get('authorization') === 'test-session' },
    setAdminCardSelectOrder: async (input) => {
      seen.push(input);
      if (!['balance_first', 'used_first'].includes(input.value)) {
        throw new PublicApiError('选卡顺序只能二选一', { code: 'INVALID_SETTING_VALUE', status: 400 });
      }
      return { oldValue: 'balance_first', newValue: input.value };
    }
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${base}/api/v1/admin/settings/card-select-order`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ value: 'used_first' })).status, 401, '没登录不许改');
    assert.equal((await post({ value: 'used_first' }, { authorization: 'test-session', origin: 'https://other.test' })).status, 403, '别的站点发来的不许改');
    assert.equal(seen.length, 0, '被挡下的请求不能碰到服务');

    const headers = { authorization: 'test-session', origin: base };
    const bad = await post({ value: 'random' }, headers);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'invalid_setting_value', '坏值要报错，不能回 200 冒充存上了');

    const ok = await post({ value: 'used_first' }, headers);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { oldValue: 'balance_first', newValue: 'used_first' });
    assert.equal(seen.at(-1).value, 'used_first');
    assert.equal(seen.at(-1).actorId, 'admin', '操作人要交给服务进审计');
  } finally { await new Promise((r) => server.close(r)); }
});
