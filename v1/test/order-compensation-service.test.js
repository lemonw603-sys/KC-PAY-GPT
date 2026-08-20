import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrderCompensationService } from '../src/services/order-compensation-service.js';
import { encryptSecret } from '../src/security/secret-box.js';

const key = Buffer.alloc(32, 23);
const hashKey = Buffer.alloc(32, 24);

function fakePool(responses) {
  const queries = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      const response = responses.shift();
      if (response === undefined) throw new Error(`Unexpected query: ${sql}`);
      return response;
    }
  };
  return { queries, async getConnection() { return connection; } };
}

test('compensation creates one replacement and closes only a no-side-effect failed order', async () => {
  const pool = fakePool([
    [[{ id: 'order-1', public_no: 'PJV1-DEMO', status: 'CREATED', plan_type: 'plus',
      code_ciphertext: null, card_count: 0, provider_call_count: 0,
      active_task_count: 0, dead_task_count: 1 }], []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []]
  ]);
  const result = await createOrderCompensationService({ pool, cdkHashKey: hashKey, cdkRecoveryKey: key })(
    'PJV1-DEMO', { confirmation: '补发 PJV1-DEMO' }
  );
  assert.match(result.code, /^PJ-[A-HJ-KM-NP-Z2-9]{5}(?:-[A-HJ-KM-NP-Z2-9]{5}){3}$/);
  assert.equal(result.replayed, false);
  assert.equal(pool.queries.some(({ sql }) => /INSERT INTO order_compensations/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /SET status = 'CLOSED'/.test(sql)), true);
  assert.equal(JSON.stringify(pool.queries).includes(result.code), false);
});

test('compensation returns the same encrypted replacement on retry', async () => {
  const code = 'PJ-ABCDEFGHJKMNPQRST234';
  const pool = fakePool([
    [[{ id: 'order-1', public_no: 'PJV1-DEMO', status: 'CLOSED', plan_type: 'plus',
      code_ciphertext: encryptSecret(code, key), compensated_at: new Date('2026-08-20T00:00:00Z'),
      card_count: 0, provider_call_count: 0, active_task_count: 0, dead_task_count: 1 }], []]
  ]);
  const result = await createOrderCompensationService({ pool, cdkHashKey: hashKey, cdkRecoveryKey: key })(
    'PJV1-DEMO', { confirmation: '补发 PJV1-DEMO' }
  );
  assert.equal(result.code, code);
  assert.equal(result.replayed, true);
  assert.equal(pool.queries.length, 1);
});

test('compensation refuses an order that may have provider side effects', async () => {
  const pool = fakePool([
    [[{ id: 'order-1', public_no: 'PJV1-DEMO', status: 'CARD_FAILED', plan_type: 'plus',
      code_ciphertext: null, card_count: 1, provider_call_count: 2,
      active_task_count: 0, dead_task_count: 1 }], []]
  ]);
  await assert.rejects(
    createOrderCompensationService({ pool, cdkHashKey: hashKey, cdkRecoveryKey: key })(
      'PJV1-DEMO', { confirmation: '补发 PJV1-DEMO' }
    ),
    (error) => error.code === 'COMPENSATION_SIDE_EFFECT_RISK'
  );
  assert.equal(pool.queries.length, 1);
});
