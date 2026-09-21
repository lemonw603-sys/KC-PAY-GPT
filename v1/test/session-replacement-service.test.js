import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionReplacementService } from '../src/services/session-replacement-service.js';
import { sessionFixture } from '../test-support/session-fixture.js';

const nowMs = Date.parse('2026-08-21T03:00:00.000Z');

function fixturePool({ count = 0, expiresAt = '2026-08-24T03:00:00.000Z', risk = 0, assignedCardId = 'card-1', tasks = [] } = {}) {
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
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('lease_active')) return [tasks, []];
      return responses.shift() || [{ affectedRows: 1 }, []];
    }
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
    replacementCount: 1, replacementsRemaining: null
  });
  assert.match(queries[2].sql, /FOR UPDATE/);
  assert.match(queries[3].sql, /INSERT INTO order_session_replacements/);
  assert.match(queries[4].sql, /status = \?/);
  assert.equal(queries[4].values[0], 'CARD_READY');
  assert.match(queries[5].sql, /'BROWSER_PREFLIGHT','PREPARE_RECHARGE','SUBMIT_RECHARGE'/);
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
  assert.equal(queries.find(q=>q.sql.includes('UPDATE orders SET status')).values[0], 'WAITING_FOR_CARD');
  assert.equal(queries.find(q=>q.sql.includes('INSERT INTO order_events')).values[1], 'WAITING_FOR_CARD');
  assert.ok(queries.some(q=>q.sql.includes("UPDATE tasks SET status = 'DEAD'")));
  assert.ok(queries.some(q=>q.sql.includes("VALUES (?, 'ASSIGN_CARD', 'PENDING'")));
});

test('a completed assignment is reused, not duplicated; active leases and funds risk reject before mutations', async()=>{
  for (const scenario of [
    {tasks:[{id:9,task_type:'ASSIGN_CARD',status:'COMPLETED',lease_active:0}],ok:true},
    {tasks:[{id:9,task_type:'ASSIGN_CARD',status:'RUNNING',lease_active:1}],code:'SESSION_REPLACEMENT_CONFLICT'},
    {tasks:[{id:9,task_type:'SUBMIT_RECHARGE',status:'RUNNING',lease_active:1}],code:'SESSION_REPLACEMENT_CONFLICT'},
    {tasks:[{id:9,task_type:'ASSIGN_CARD',lease_active:0},{id:10,task_type:'ASSIGN_CARD',lease_active:0}],code:'SESSION_REPLACEMENT_CONFLICT'},
    {risk:1,code:'FUNDS_STATE_UNSAFE'}
  ]) {
    const {pool,queries}=fixturePool({assignedCardId:null,...scenario});
    const service=createSessionReplacementService({pool,sessionEncryptionKey:Buffer.alloc(32,12),cdkHashKey:Buffer.alloc(32,13),now:()=>nowMs});
    const call=()=>service({publicNo:'PJV1-ABCDEFGHIJKLMNOPQRST',session:sessionFixture({nowMs})});
    if(scenario.ok){await call();assert.ok(queries.some(q=>q.sql.includes('max_attempts = 10080')&&q.values[0]===9));assert.equal(queries.some(q=>q.sql.includes('INSERT INTO tasks')),false);}
    else {await assert.rejects(call,{code:scenario.code,status:409});assert.equal(queries.some(q=>/INSERT|UPDATE orders|UPDATE tasks/.test(q.sql.replace(/FOR UPDATE/g,''))),false);}
  }
});

test('a customer may replace the Session any number of times and after the old repair deadline', async () => {
  for (const scenario of [{ count: 3 }, { expiresAt: '2026-08-20T03:00:00.000Z' }, { count: 12, expiresAt: '2026-08-01T00:00:00.000Z' }]) {
    const { pool, queries } = fixturePool(scenario);
    const session = sessionFixture({ nowMs, lifetimeSeconds: 7200 });
    const service = createSessionReplacementService({
      pool, sessionEncryptionKey: Buffer.alloc(32, 12), cdkHashKey: Buffer.alloc(32, 13), now: () => nowMs
    });
    const result = await service({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST', session });
    assert.equal(result.status, 'PROCESSING');
    assert.equal(result.replacementsRemaining, null);
    assert.equal(result.replacementCount, (scenario.count || 0) + 1);
    assert.ok(queries.some(({ sql }) => /INSERT INTO order_session_replacements/.test(sql)));
  }
});
