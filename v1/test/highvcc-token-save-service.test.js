import assert from 'node:assert/strict';
import test from 'node:test';

import { createHighvccCardService, BACKUP_A_PROVIDER_ACCOUNT_ID } from '../src/services/highvcc-card-service.js';
import { createHighvccTokenSaveService } from '../src/services/highvcc-token-save-service.js';

// 用真的 highvcc-card-service（setToken / walletStatus / mapProviderError 全走真代码），只把网络和库换成假的：
// 「卡台不认」的判定要经过 provider 抛码 → walletStatus 映射成 PublicApiError 这一整条，才算验到。
const encryptionKey = Buffer.alloc(32, 7);
const panHmacKey = Buffer.alloc(32, 9);
const TOKEN_ALERT_KEY = `provider-token-expired:${BACKUP_A_PROVIDER_ACCOUNT_ID}`; // 生产 operator_alerts.dedupe_key 实值（2026-09-25 查）

function fakePool({ failAlertUpdate = false } = {}) {
  const settings = new Map();
  const queries = [];
  return {
    settings, queries,
    async getConnection() { throw new Error('no transactions expected'); },
    async query(sql, params) {
      queries.push({ sql, params });
      if (failAlertUpdate && /UPDATE operator_alerts/.test(sql)) throw new Error('db hiccup');
      if (sql.includes('FROM app_settings WHERE setting_key')) {
        const v = settings.get(params[0]);
        return [v ? [{ setting_value: v, updated_at: new Date('2026-09-25T07:25:58Z') }] : []];
      }
      if (sql.startsWith('INSERT INTO app_settings')) { settings.set(params[0], params[1]); return [{}]; }
      return [{ affectedRows: 0 }];
    },
  };
}

const wallet = (status, body) => async (url) => {
  assert.equal(new URL(url).pathname, '/api/user/wallet');
  return { ok: status < 400, status, json: async () => body };
};

function build({ fetchImpl, pool = fakePool(), verifyTimeoutMs } = {}) {
  const card = createHighvccCardService({ pool, encryptionKey, panHmacKey, fetchImpl });
  const save = createHighvccTokenSaveService({ pool, setToken: card.setToken, walletStatus: card.walletStatus, verifyTimeoutMs });
  const resolves = () => pool.queries.filter((q) => /UPDATE operator_alerts SET status = 'RESOLVED'/.test(q.sql)
    && JSON.stringify(q.params) === JSON.stringify([TOKEN_ALERT_KEY]));
  return { pool, save, resolves };
}

test('platform accepts the new token -> VALID and the token-expired alert is resolved right away', async () => {
  const { pool, save, resolves } = build({ fetchImpl: wallet(200, { code: 200, data: { usdBalance: 3404 } }) });
  const result = await save({ token: 'a'.repeat(32), requestedBy: 'admin' });
  assert.equal(result.configured, true);
  assert.deepEqual([result.verification, result.alertCleared], ['VALID', true]);
  assert.equal(resolves().length, 1);
  assert.ok(pool.settings.get('highvcc_access_token_ciphertext'), 'the token is stored');
});

test('platform rejects the token (401 / expired message) -> REJECTED, token still saved, no alert touched', async () => {
  for (const fetchImpl of [wallet(401, { code: 401, msg: 'token 已过期' }), wallet(200, { code: 401, msg: '请重新登录' })]) {
    const { pool, save } = build({ fetchImpl });
    const result = await save({ token: 'a'.repeat(32) });
    assert.deepEqual([result.verification, result.alertCleared, result.configured], ['REJECTED', false, true]);
    assert.ok(pool.queries.every((q) => !/operator_alerts/.test(q.sql)), 'opening/pushing the alert stays with the hourly sync');
  }
});

test('platform error or network failure -> UNKNOWN, alert untouched', async () => {
  for (const fetchImpl of [
    wallet(502, null),
    wallet(200, { code: 500, msg: '系统繁忙' }),
    async () => { throw new Error('ECONNRESET'); },
  ]) {
    const { save, resolves } = build({ fetchImpl });
    const result = await save({ token: 'a'.repeat(32) });
    assert.equal(result.verification, 'UNKNOWN');
    assert.equal(resolves().length, 0);
  }
});

test('a platform that never answers -> UNKNOWN after the timeout; the save is not held up', async () => {
  const { save, resolves } = build({ fetchImpl: () => new Promise(() => {}), verifyTimeoutMs: 20 });
  const result = await save({ token: 'a'.repeat(32) });
  assert.deepEqual([result.verification, result.configured], ['UNKNOWN', true]);
  assert.equal(resolves().length, 0);
});

test('token valid but resolving the alert fails -> still VALID with alertCleared false, never reported as a failed save', async () => {
  const { save } = build({ fetchImpl: wallet(200, { code: 200, data: {} }), pool: fakePool({ failAlertUpdate: true }) });
  const result = await save({ token: 'a'.repeat(32) });
  assert.deepEqual([result.verification, result.alertCleared], ['VALID', false]);
});

test('a malformed token is refused before any network call or alert change (existing setToken rule)', async () => {
  let calls = 0;
  const { pool, save } = build({ fetchImpl: async () => { calls += 1; throw new Error('must not be called'); } });
  await assert.rejects(save({ token: 'short' }), (e) => e.code === 'HIGHVCC_TOKEN_INVALID');
  assert.equal(calls, 0);
  assert.ok(pool.queries.every((q) => !/operator_alerts/.test(q.sql)));
});
