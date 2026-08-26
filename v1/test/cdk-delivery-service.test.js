import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  CdkDeliveryError,
  createCdkDeliveryService,
  hmacRecipientReference
} from '../src/services/cdk-delivery-service.js';

function scriptedPool(responses) {
  const queries = [];
  const transaction = { began: 0, committed: 0, rolledBack: 0, released: 0 };
  const connection = {
    async beginTransaction() { transaction.began += 1; },
    async commit() { transaction.committed += 1; },
    async rollback() { transaction.rolledBack += 1; },
    release() { transaction.released += 1; },
    async query(sql, values = []) {
      queries.push({ sql, values });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error(`unexpected query: ${sql}`);
      return response;
    }
  };
  return {
    queries,
    transaction,
    async getConnection() { return connection; },
    async query(sql, values = []) { return connection.query(sql, values); }
  };
}

const hmacKey = Buffer.alloc(32, 7);
const cdk1 = '11111111-1111-4111-8111-111111111111';
const cdk2 = '22222222-2222-4222-8222-222222222222';
const batchNo = 'B-20260820-A1B2C3';
const deliveredAt = new Date('2026-08-20T12:00:00.000Z');

test('requires an independent 32-byte recipient reference HMAC key', () => {
  assert.throws(
    () => createCdkDeliveryService({ pool: {}, recipientReferenceHmacKey: Buffer.alloc(31) }),
    (error) => error instanceof CdkDeliveryError && error.code === 'INVALID_HMAC_KEY'
  );
  const digest = hmacRecipientReference('customer@example.com', hmacKey);
  assert.equal(digest.length, 64);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, crypto.createHash('sha256').update('customer@example.com').digest('hex'));
});

test('records one CDK delivery without storing CDK plaintext, recipient plaintext, or keys', async () => {
  const recipientReference = 'customer@example.com';
  const expectedHash = hmacRecipientReference(recipientReference, hmacKey);
  const pool = scriptedPool([
    [[{ id: cdk1, batch_no: batchNo, status: 'AVAILABLE' }], []],
    [{ affectedRows: 1 }, []]
  ]);
  const service = createCdkDeliveryService({ pool, recipientReferenceHmacKey: hmacKey });

  const result = await service.recordDelivery({
    cdkId: cdk1,
    eventType: 'DELIVERED',
    channel: 'telegram',
    recipientReference,
    actorId: 'operator-1',
    metadata: { ticket: 'support-7', retry: false },
    deliveredAt,
    idFactory: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  });

  assert.deepEqual(result.eventIds, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
  assert.equal(result.batchNo, batchNo);
  assert.equal(result.recipientReferenceHash, expectedHash);
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
  assert.match(pool.queries[0].sql, /SELECT id, batch_no, status[\s\S]*FROM cdks[\s\S]*FOR UPDATE/);
  assert.match(pool.queries[1].sql, /INSERT INTO cdk_delivery_events/);

  const allSql = pool.queries.map((entry) => entry.sql).join('\n');
  assert.doesNotMatch(allSql, /code_hash|codes_ciphertext|recipient_note/i);
  const serializedValues = JSON.stringify(pool.queries.flatMap((entry) => entry.values));
  assert.doesNotMatch(serializedValues, /customer@example\.com|PJ-|VCK-|734FEA12|secret|070707/);
  assert.match(serializedValues, new RegExp(expectedHash));
});

test('batch delivery freezes an explicit CDK set and verifies every CDK belongs to the batch', async () => {
  const expectedHash = hmacRecipientReference('tg:user:42', hmacKey);
  const pool = scriptedPool([
    [[
      { id: cdk1, batch_no: batchNo, status: 'AVAILABLE' },
      { id: cdk2, batch_no: batchNo, status: 'REDEEMED' }
    ], []],
    [{ affectedRows: 2 }, []]
  ]);
  const service = createCdkDeliveryService({ pool, recipientReferenceHmacKey: hmacKey });

  const result = await service.recordBatchDelivery({
    batchNo,
    cdkIds: [cdk1, cdk2],
    eventType: 'RESENT',
    channel: 'manual',
    recipientReference: 'tg:user:42',
    actorId: 'admin',
    deliveredAt,
    idFactory: (() => {
      let count = 0;
      return () => `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${++count}`;
    })()
  });

  assert.equal(result.recordedCount, 2);
  assert.deepEqual(result.cdkIds, [cdk1, cdk2]);
  assert.equal(result.recipientReferenceHash, expectedHash);
  assert.match(pool.queries[0].sql, /WHERE id IN \(\?, \?\)/);
  assert.doesNotMatch(pool.queries[0].sql, /WHERE\s+batch_no\s*=\s*\?/i, 'batch recording must not expand dynamically from batch_no');
  assert.equal(pool.queries[1].values.length, 18);
  assert.deepEqual(pool.transaction, { began: 1, committed: 1, rolledBack: 0, released: 1 });
});

test('batch delivery rolls back when any explicit CDK is outside the selected batch', async () => {
  const pool = scriptedPool([
    [[
      { id: cdk1, batch_no: batchNo, status: 'AVAILABLE' },
      { id: cdk2, batch_no: 'B-OTHER', status: 'AVAILABLE' }
    ], []]
  ]);
  const service = createCdkDeliveryService({ pool, recipientReferenceHmacKey: hmacKey });

  await assert.rejects(
    service.recordBatchDelivery({
      batchNo,
      cdkIds: [cdk1, cdk2],
      recipientReference: 'tg:user:42',
      deliveredAt
    }),
    (error) => error.code === 'CDK_BATCH_MISMATCH'
  );
  assert.deepEqual(pool.transaction, { began: 1, committed: 0, rolledBack: 1, released: 1 });
  assert.equal(pool.queries.length, 1);
});

test('never records delivered or resent events for revoked CDKs', async () => {
  const pool = scriptedPool([
    [[{ id: cdk1, batch_no: batchNo, status: 'REVOKED' }], []]
  ]);
  const service = createCdkDeliveryService({ pool, recipientReferenceHmacKey: hmacKey });
  await assert.rejects(service.recordDelivery({
    cdkId: cdk1,
    eventType: 'DELIVERED',
    recipientReference: 'order:fixture'
  }), (error) => error.code === 'CDK_NOT_DELIVERABLE');
  assert.equal(pool.queries.length, 1);
  assert.equal(pool.transaction.rolledBack, 1);
});

test('rejects dynamic, duplicate, missing, and malformed CDK sets before insert', async () => {
  const pool = scriptedPool([]);
  const service = createCdkDeliveryService({ pool, recipientReferenceHmacKey: hmacKey });

  await assert.rejects(
    service.recordBatchDelivery({ batchNo, recipientReference: 'x' }),
    (error) => error.code === 'INVALID_CDK_SET'
  );
  await assert.rejects(
    service.recordBatchDelivery({ batchNo, cdkIds: [cdk1, cdk1], recipientReference: 'x' }),
    (error) => error.code === 'DUPLICATE_CDK'
  );
  await assert.rejects(
    service.recordDelivery({ cdkId: 'PJ-ABCDE-FGHJK-MNPQR-ST234', recipientReference: 'x' }),
    (error) => error.code === 'INVALID_CDK_ID'
  );
  assert.equal(pool.transaction.began, 0);
});

test('rejects sensitive metadata that could contain plaintext CDKs, recipients, or keys', async () => {
  const pool = scriptedPool([]);
  const service = createCdkDeliveryService({ pool, recipientReferenceHmacKey: hmacKey });

  await assert.rejects(
    service.recordDelivery({ cdkId: cdk1, recipientReference: 'x', metadata: { recipientEmail: 'customer@example.com' } }),
    (error) => error.code === 'SENSITIVE_METADATA'
  );
  await assert.rejects(
    service.recordDelivery({ cdkId: cdk1, recipientReference: 'x', metadata: { note: 'PJ-ABCDE-FGHJK-MNPQR-ST234' } }),
    (error) => error.code === 'SENSITIVE_METADATA'
  );
  await assert.rejects(
    service.recordDelivery({ cdkId: cdk1, recipientReference: 'x', metadata: { api_key: 'abc' } }),
    (error) => error.code === 'SENSITIVE_METADATA'
  );
  assert.equal(pool.transaction.began, 0);
});
