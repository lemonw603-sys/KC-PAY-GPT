import assert from 'node:assert/strict';
import test from 'node:test';
import {
  armRechargePermit,
  getRechargePermitStatus,
  revokeRechargePermit,
  validateRechargePreflight
} from '../src/services/recharge-permit-service.js';
import { encryptSecret } from '../src/security/secret-box.js';
import { sessionFixture } from '../test-support/session-fixture.js';

function transactionalPool(responses) {
  const queries = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      const response = responses.shift();
      if (!response) throw new Error('unexpected query');
      return response;
    }
  };
  return { queries, async getConnection() { return connection; } };
}

test('arms only one untouched CARD_READY submit task with a short expiry', async () => {
  const pool = transactionalPool([
    [[{
      order_id: 'order-1', order_status: 'CARD_READY', task_id: 9,
      task_status: 'PENDING', attempts: 0, payload_json: null
    }], []],
    [[], []],
    [[], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  ]);
  const result = await armRechargePermit(pool, {
    publicNo: 'PJV1-DEMO',
    ttlMinutes: 10,
    now: new Date('2026-08-19T08:00:00.000Z'),
    preflight() {}
  });
  assert.deepEqual(result, {
    publicNo: 'PJV1-DEMO', status: 'ARMED', expiresAt: '2026-08-19T08:10:00.000Z'
  });
  const payload = JSON.parse(pool.queries[3].values[0]);
  assert.equal(payload.rechargePermit.status, 'ARMED');
  assert.match(pool.queries[5].sql, /dispatch_new_recharges/);
});

test('refuses to arm after any ZZSHU create attempt', async () => {
  const pool = transactionalPool([
    [[{
      order_id: 'order-1', order_status: 'CARD_READY', task_id: 9,
      task_status: 'PENDING', attempts: 0, payload_json: null
    }], []],
    [[{ id: 1 }], []]
  ]);
  await assert.rejects(
    armRechargePermit(pool, { publicNo: 'PJV1-DEMO', preflight() {} }),
    (error) => error.code === 'CREATE_ALREADY_ATTEMPTED'
  );
});

test('recharge preflight requires a live Session and a freshly verified funded card', () => {
  const now = new Date('2026-08-19T08:00:00.000Z');
  const key = Buffer.alloc(32, 23);
  const valid = {
    session_ciphertext: encryptSecret(JSON.stringify(sessionFixture({ nowMs: now.getTime() })), key),
    card_last_synced_at: new Date(now.getTime() - 60_000),
    card_last_transaction_synced_at: new Date(now.getTime() - 60_000),
    card_status: 'active',
    card_balance: '16.000000',
    minimum_required_card_balance: '15.500000',
    card_credentials_ciphertext: Buffer.from('encrypted-card')
  };
  assert.doesNotThrow(() => validateRechargePreflight(valid, { sessionEncryptionKey: key, now }));
  assert.throws(
    () => validateRechargePreflight({ ...valid, card_last_synced_at: new Date(now.getTime() - 16 * 60_000) }, {
      sessionEncryptionKey: key, now
    }),
    (error) => error.code === 'CARD_CHECK_STALE'
  );
  assert.throws(
    () => validateRechargePreflight({ ...valid, card_balance: '1.00' }, { sessionEncryptionKey: key, now }),
    (error) => error.code === 'CARD_NOT_READY'
  );
});

test('reports a locked untouched task without exposing payload contents', async () => {
  const pool = {
    async query() {
      return [[{
        order_status: 'CARD_READY', task_status: 'PENDING', attempts: 0, payload_json: null
      }], []];
    }
  };
  assert.deepEqual(await getRechargePermitStatus(pool, { publicNo: 'PJV1-DEMO' }), {
    publicNo: 'PJV1-DEMO', orderStatus: 'CARD_READY', taskStatus: 'PENDING',
    attempts: 0, permitStatus: 'LOCKED', expiresAt: null
  });
});

test('closing a permit disables new recharge dispatch in the same transaction', async () => {
  const pool = transactionalPool([
    [[{
      order_id: 'order-1', order_status: 'CARD_READY', task_id: 9,
      payload_json: JSON.stringify({ rechargePermit: { status: 'ARMED' } })
    }], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  ]);
  const result = await revokeRechargePermit(pool, {
    publicNo: 'PJV1-DEMO',
    disableDispatch: true
  });
  assert.deepEqual(result, { publicNo: 'PJV1-DEMO', status: 'REVOKED' });
  assert.match(pool.queries.at(-1).sql, /dispatch_new_recharges/);
  assert.match(pool.queries.at(-1).sql, /setting_value = 'false'/);
});
