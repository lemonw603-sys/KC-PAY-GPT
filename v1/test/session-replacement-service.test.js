import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionReplacementService } from '../src/services/session-replacement-service.js';
import { sessionFixture } from '../test-support/session-fixture.js';

const nowMs = Date.parse('2026-08-21T03:00:00.000Z');

function fixturePool({ count = 0, expiresAt = '2026-08-24T03:00:00.000Z', risk = 0, assignedCardId = 'card-1' } = {}) {
  const queries = [];
  const responses = [
    [[{
      id: 'order-1', public_no: 'PJV1-ABCDEFGHIJKLMNOPQRST', status: 'WAITING_FOR_SESSION',
      version: 7, customer_email: 'old@example.com', chatgpt_account_id: 'old-account',
      customer_action_code: 'ACCOUNT_ALREADY_PLUS', session_replacement_count: count,
      session_repair_expires_at: new Date(expiresAt), assigned_card_id: assignedCardId
    }], []],
    [[{ count: risk }], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 2 }, []],
    [{ affectedRows: 1 }, []]
  ];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, values) { queries.push({ sql, values }); return responses.shift(); }
  };
  return { queries, pool: { async getConnection() { return connection; } } };
}

test('replaces Session on the same order and records metadata without retaining old Session', async () => {
  const { pool, queries } = fixturePool();
  const session = sessionFixture({ nowMs, lifetimeSeconds: 7200 });
  session.user.email = 'new@example.com';
  session.account.id = 'new-account';
  const service = createSessionReplacementService({
    pool, sessionEncryptionKey: Buffer.alloc(32, 12), cdkHashKey: Buffer.alloc(32, 13),
    now: () => nowMs
  });
  assert.deepEqual(await service({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST', session }), {
    publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST', status: 'PROCESSING',
    replacementCount: 1, replacementsRemaining: 2
  });
  assert.match(queries[2].sql, /INSERT INTO order_session_replacements/);
  assert.match(queries[3].sql, /status = \?/);
  assert.equal(queries[3].values[0], 'CARD_READY');
  assert.match(queries[4].sql, /'BROWSER_PREFLIGHT','PREPARE_RECHARGE','SUBMIT_RECHARGE'/);
  assert.equal(JSON.stringify(queries).includes(session.accessToken), false);
  assert.equal(JSON.stringify(queries).includes(session.sessionToken), false);
});

test('returns a cardless Browser order to WAITING_FOR_CARD after Session replacement', async () => {
  const { pool, queries } = fixturePool({ assignedCardId: null });
  const session = sessionFixture({ nowMs, lifetimeSeconds: 7200 });
  const service = createSessionReplacementService({
    pool, sessionEncryptionKey: Buffer.alloc(32, 12), cdkHashKey: Buffer.alloc(32, 13),
    now: () => nowMs
  });
  await service({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST', session });
  assert.equal(queries[3].values[0], 'WAITING_FOR_CARD');
  assert.equal(queries[5].values[1], 'WAITING_FOR_CARD');
});

test('enforces three replacements and the original repair deadline', async () => {
  const session = sessionFixture({ nowMs, lifetimeSeconds: 7200 });
  const atLimit = fixturePool({ count: 3 });
  await assert.rejects(() => createSessionReplacementService({
    pool: atLimit.pool, sessionEncryptionKey: Buffer.alloc(32, 12),
    cdkHashKey: Buffer.alloc(32, 13), now: () => nowMs
  })({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST', session }),
  (error) => error.code === 'SESSION_REPLACEMENT_LIMIT_REACHED');

  const expired = fixturePool({ expiresAt: '2026-08-21T02:59:59.000Z' });
  await assert.rejects(() => createSessionReplacementService({
    pool: expired.pool, sessionEncryptionKey: Buffer.alloc(32, 12),
    cdkHashKey: Buffer.alloc(32, 13), now: () => nowMs
  })({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST', session }),
  (error) => error.code === 'SESSION_REPLACEMENT_EXPIRED');
});
