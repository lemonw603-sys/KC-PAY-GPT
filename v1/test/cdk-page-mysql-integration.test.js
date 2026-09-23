import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createDatabasePool } from '../src/db/pool.js';
import { createAdminCdkService, listCdkCodes, summarizeCdkLiability, updateCdkCodes,
  markCdkIssued, listCdkBatchOptions, updateCdkBatchMetadata } from '../src/services/cdk-service.js';
import { createCdkVerifyService } from '../src/services/cdk-verify-service.js';
import { createOrderFromCdk } from '../src/db/repositories/order-intake-repository.js';
import { returnCdkForOrderInTransaction } from '../src/db/repositories/cdk-return-repository.js';
import { createCdkLookup } from '../src/security/cdk-code.js';

const url = process.env.CDK_TEST_DATABASE_URL;
test('CDK page real MySQL: issuance, expiry, search, history, bulk atomicity and idempotency', { skip: !url && 'CDK_TEST_DATABASE_URL not set' }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/step6_cdk_test');
  const pool = createDatabasePool({ url, tls: { enabled: false } });
  const keys = { cdkHashKey: Buffer.alloc(32, 7), cdkRecoveryKey: Buffer.alloc(32, 9) };
  const create = createAdminCdkService({ pool, ...keys });
  const verify = createCdkVerifyService({ pool, cdkHashKey: keys.cdkHashKey });
  const batches = [], orders = [];
  const make = async (input = {}) => {
    const result = await create({ count: 1, planType: 'plus', requestKey: randomUUID(), ...input });
    batches.push(result.batchNo); return result;
  };
  const codes = async (batch) => (await listCdkCodes(pool, { batchNo: batch.batchNo, limit: 200 }, keys)).codes;
  try {
    const before = await summarizeCdkLiability(pool);
    const first = await make();
    const [[raw]] = await pool.query('SELECT *, TIMESTAMPDIFF(SECOND,created_at,expires_at) AS life FROM cdks WHERE batch_no=?', [first.batchNo]);
    assert.equal(raw.life, 30 * 86400); assert.equal(raw.issuance_kind, 'NORMAL'); assert.ok(raw.issued_at);
    await make({ count: 61 });
    assert.ok(!(await listCdkCodes(pool, { limit: 50 }, keys)).codes.some((r) => r.id === raw.id));
    const found = await listCdkCodes(pool, { q: first.codes[0], limit: 50 }, keys);
    assert.equal(found.total, 1); assert.equal(found.codes[0].id, raw.id);
    assert.equal((await listCdkCodes(pool, { q: 'no-such-code', limit: 50 }, keys)).total, 0);
    const reserve = await make({ count: 2, issuanceKind: 'RESERVE', note: '手机备用' });
    const rc = await codes(reserve);
    await markCdkIssued(pool, rc[0].id, { note: '离线发给甲' });
    await assert.rejects(markCdkIssued(pool, rc[0].id, { issued: false }), { code: 'CDK_UNISSUE_DISABLED' });
    const market = await make({ count: 2, issuanceKind: 'MARKETPLACE', expiryMode: 'NEVER', note: '测试卡网', amount: '99.90' });
    const mc = await codes(market);
    assert.equal(mc[0].expiresAt, null); assert.equal(mc[0].batchAmount, '99.90');
    assert.equal((await listCdkCodes(pool, { q: '测试卡网' }, keys)).total, 2);
    await updateCdkBatchMetadata(pool, market.batchNo, { note: '新渠道', amount: '88.1', currency: 'USD' });
    assert.equal((await codes(market))[0].batchAmount, '88.10');
    assert.ok((await listCdkBatchOptions(pool)).batches.some((b) => b.batchNo === market.batchNo && b.currency === 'USD'));
    const key = randomUUID();
    const input = { count: 2, requestKey: key, note: '幂等测试', amount: '10' };
    const original = await make(input);
    const repeat = await create(input);
    assert.deepEqual(repeat.codes, original.codes);
    for (const changed of [{ note: '别的客户' }, { amount: '11' }, { expiryMode: 'NEVER' }, { issuanceKind: 'RESERVE' }]) {
      await assert.rejects(create({ ...input, ...changed }), { code: 'IDEMPOTENCY_MISMATCH' });
    }
    const date = new Date(Date.now() + 60 * 86400_000).toISOString();
    await updateCdkCodes(pool, { ids: [raw.id], action: 'expiry', expiryMode: 'CUSTOM', expiresAt: date });
    assert.equal((await codes(first))[0].expiresAt, date);
    await pool.query('UPDATE cdks SET expires_at=DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id=?', [raw.id]);
    assert.equal((await verify({ cdk: first.codes[0] })).state, 'EXPIRED');
    assert.equal((await listCdkCodes(pool, { batchNo: first.batchNo, state: 'pending' }, keys)).total, 0);
    await updateCdkCodes(pool, { ids: [raw.id], action: 'expiry', expiryMode: 'NEVER' });
    assert.equal((await verify({ cdk: first.codes[0] })).state, 'VALID');

    // Use real order rows, including immutable terminal history and a running order.
    const statuses = ['RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'CLOSED', 'CREATED'];
    for (let i = 0; i < statuses.length; i++) {
      const batch = await make(); const [row] = await codes(batch); const id = randomUUID(); orders.push(id);
      const ended = i === 2 ? '2026-09-01 00:00:00' : '2026-09-21 00:00:00';
      await pool.query(`INSERT INTO orders (id,public_no,cdk_id,status,customer_email,session_ciphertext,
        card_purchase_idempotency_key,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, 'TEST-' + id, row.id, statuses[i], 'full-email@example.test', 'isolated-fixture', id, ended, ended]);
      await pool.query("UPDATE cdks SET status='REDEEMED',order_id=? WHERE id=?", [id, row.id]);
      const [read] = await codes(batch); assert.equal(read.customerEmail, 'full-email@example.test');
      if (i === 2) { assert.equal(read.historical, true); await pool.query('UPDATE orders SET failure_reason=? WHERE id=?', ['unrelated edit', id]); }
      await assert.rejects(updateCdkCodes(pool, { ids: [row.id, rc[1].id], action: 'revoke' }), { code: 'CDK_SELECTION_CONFLICT' });
      assert.equal((await codes(reserve)).find((r) => r.id === rc[1].id).status, 'AVAILABLE');
    }
    const summary = await summarizeCdkLiability(pool);
    assert.equal(summary.done - before.done, 1); assert.equal(summary.attention - before.attention, 1);
    assert.equal(summary.historical - before.historical, 1); assert.equal(summary.processing - before.processing, 1);
    for (const key of ['pending', 'reserve', 'done', 'attention', 'historical', 'expired', 'processing', 'legacy']) {
      assert.equal((await listCdkCodes(pool, { state: key, limit: 1 }, keys)).total, summary[key]);
    }
    // Fail the audit INSERT on a real DB transaction; UPDATE must roll back too.
    const faultPool = { async getConnection() {
      const conn = await pool.getConnection();
      return { beginTransaction: () => conn.beginTransaction(), commit: () => conn.commit(), rollback: () => conn.rollback(), release: () => conn.release(),
        query: (sql, args) => /INSERT INTO cdk_admin_events/.test(sql) ? Promise.reject(new Error('injected audit failure')) : conn.query(sql, args) };
    } };
    await assert.rejects(updateCdkCodes(faultPool, { ids: [rc[1].id], action: 'revoke' }), /injected audit failure/);
    assert.equal((await codes(reserve)).find((r) => r.id === rc[1].id).status, 'AVAILABLE');
    const parallel = await Promise.all([updateCdkCodes(pool, { ids: [rc[1].id], action: 'revoke' }), updateCdkCodes(pool, { ids: [rc[1].id], action: 'revoke' })]);
    assert.equal(parallel.reduce((n, r) => n + r.changed, 0), 1);
    const revoked = (await codes(reserve)).find((r) => r.id === rc[1].id);
    assert.equal(revoked.latestAt, revoked.revokedAt);
    // Offline reserve use is proof it left our hands: no-payment return must not restock it.
    const reserveUsed = await make({ issuanceKind: 'RESERVE' });
    const [reserveRow] = await codes(reserveUsed);
    const intakeId = randomUUID(); orders.push(intakeId);
    const [savedSettings] = await pool.query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('accept_new_orders','default_card_type_id','default_open_card_amount','default_minimum_required_card_balance')");
    try {
      for (const [key, value] of Object.entries({ accept_new_orders:'true',default_card_type_id:'1',default_open_card_amount:'50',default_minimum_required_card_balance:'16' })) {
        await pool.query('UPDATE app_settings SET setting_value=? WHERE setting_key=?',[value,key]);
      }
      await pool.query("INSERT INTO app_settings (setting_key, setting_value) VALUES ('browser_worker_heartbeat_at', ?), ('worker_heartbeat_at', ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)", [new Date().toISOString(), new Date().toISOString()]); // D-352 块3②：建单要求执行器心跳新鲜
  await createOrderFromCdk(pool,{orderId:intakeId,publicNo:'TEST-'+intakeId,
        cdkLookup:createCdkLookup(reserveUsed.codes[0],keys.cdkHashKey),customerEmail:'offline@example.test',
        chatgptAccountId:'isolated-account',sessionCiphertext:'isolated-session',cardPurchaseIdempotencyKey:intakeId});
      assert.ok((await codes(reserveUsed))[0].issuedAt);
      await pool.query("UPDATE orders SET status='CLOSED' WHERE id=?",[intakeId]);
      const conn=await pool.getConnection();
      try { await conn.beginTransaction(); assert.equal((await returnCdkForOrderInTransaction(conn,{orderId:intakeId,reason:'isolated no-payment test'})).returned,true); await conn.commit(); }
      catch(error){await conn.rollback();throw error;}finally{conn.release();}
      assert.equal((await listCdkCodes(pool,{batchNo:reserveUsed.batchNo,state:'reserve'},keys)).total,0);
      assert.equal((await listCdkCodes(pool,{batchNo:reserveUsed.batchNo,state:'pending'},keys)).total,1);
      await updateCdkCodes(pool,{ids:[reserveRow.id],action:'revoke'});
    } finally {
      for(const row of savedSettings) await pool.query('UPDATE app_settings SET setting_value=? WHERE setting_key=?',[row.setting_value,row.setting_key]);
    }
  } finally {
    if (batches.length) {
      await pool.query('UPDATE cdks SET order_id=NULL WHERE batch_no IN (?)', [batches]);
      await pool.query('DELETE FROM customer_payments WHERE cdk_id IN (SELECT id FROM cdks WHERE batch_no IN (?))', [batches]);
      await pool.query('DELETE FROM cdk_delivery_events WHERE batch_no IN (?)',[batches]);
      if (orders.length) {
        await pool.query('DELETE FROM tasks WHERE order_id IN (?)',[orders]);
        await pool.query('DELETE FROM order_events WHERE order_id IN (?)',[orders]);
        await pool.query('DELETE FROM orders WHERE id IN (?)', [orders]);
      }
      await pool.query('DELETE FROM cdk_admin_events WHERE batch_no IN (?)', [batches]);
      await pool.query('DELETE FROM cdks WHERE batch_no IN (?)', [batches]);
      await pool.query('DELETE FROM cdk_batches WHERE batch_no IN (?)', [batches]);
    }
    await pool.end();
  }
});
