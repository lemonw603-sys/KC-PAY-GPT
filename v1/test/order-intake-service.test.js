import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createOrderIntakeService } from '../src/services/order-intake-service.js';
import { decryptSecret } from '../src/security/secret-box.js';
import { sessionFixture } from '../test-support/session-fixture.js';

test('hashes the CDK and encrypts the complete Session before repository access', async () => {
  const key = crypto.randomBytes(32);
  const nowMs = Date.parse('2026-08-17T00:00:00.000Z');
  const session = sessionFixture({ nowMs });
  let stored;
  const service = createOrderIntakeService({
    pool: {},
    sessionEncryptionKey: key,
    now: () => nowMs,
    repository: {
      createOrderFromCdk: async (_pool, input) => {
        stored = input;
        return { publicNo: input.publicNo, status: 'CREATED' };
      }
    }
  });

  const result = await service({ cdk: '  CDK-fixture-1234  ', session });
  assert.equal(result.status, 'CREATED');
  assert.equal(stored.cdkHash, crypto.createHash('sha256').update('CDK-fixture-1234').digest('hex'));
  assert.equal(stored.cardPurchaseIdempotencyKey, `purchase-${stored.orderId}`);
  assert.deepEqual(JSON.parse(decryptSecret(stored.sessionCiphertext, key)), session);
  assert.equal(JSON.stringify(stored).includes('CDK-fixture-1234'), false);
});
