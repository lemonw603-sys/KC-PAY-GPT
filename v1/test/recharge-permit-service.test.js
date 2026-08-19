import assert from 'node:assert/strict';
import test from 'node:test';
import {
  armRechargePermit,
  getRechargePermitStatus
} from '../src/services/recharge-permit-service.js';

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
    now: new Date('2026-08-19T08:00:00.000Z')
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
    armRechargePermit(pool, { publicNo: 'PJV1-DEMO' }),
    (error) => error.code === 'CREATE_ALREADY_ATTEMPTED'
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
