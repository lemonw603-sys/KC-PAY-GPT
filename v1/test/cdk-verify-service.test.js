import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createCdkVerifyService } from '../src/services/cdk-verify-service.js';
import { findCdkForVerification } from '../src/db/repositories/cdk-verify-repository.js';
import { createCdkLookup } from '../src/security/cdk-code.js';

const HASH_KEY = crypto.randomBytes(32);
const CODE = 'PJ-ABCDE-FGHJK-LMNPQ-RSTUV';

function serviceWith(found, { blocked = false, onBlockedCheck = () => {} } = {}) {
  return createCdkVerifyService({
    pool: {},
    cdkHashKey: HASH_KEY,
    repository: {
      findCdkForVerification: async () => found,
      cdkReturnWouldBeBlocked: async (_pool, orderId) => {
        onBlockedCheck(orderId);
        return blocked;
      }
    }
  });
}

const availableCdk = { status: 'AVAILABLE', planType: 'plus', productName: null, order: null };

function redeemed(orderStatus, extra = {}) {
  return {
    status: 'REDEEMED',
    planType: 'plus',
    productName: 'ChatGPT Plus',
    order: {
      internalOrderId: 'order-1',
      publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST',
      status: orderStatus
    },
    ...extra
  };
}

test('an unredeemed code says VALID and names the product the customer bought', async () => {
  const verify = serviceWith(availableCdk);
  const result = await verify({ cdk: CODE });
  assert.deepEqual(result, {
    state: 'VALID',
    product: { planType: 'plus', label: 'ChatGPT Plus' }
  });
  // Nothing about an order exists yet, so nothing about one is returned.
  assert.equal('order' in result, false);
});

test('a code nobody issued, and a revoked code, are the same answer and leak nothing', async () => {
  for (const found of [null, { status: 'REVOKED', planType: 'plus', productName: null, order: null }]) {
    const result = await serviceWith(found)({ cdk: CODE });
    assert.deepEqual(result, { state: 'INVALID' });
  }
});

test('a status this code was not written to understand never says go ahead', async () => {
  const result = await serviceWith({ status: 'SOME_FUTURE_STATE', planType: 'plus', order: null })({ cdk: CODE });
  assert.deepEqual(result, { state: 'INVALID' });
});

test('an order waiting for a new Session sends the customer back to the Session step', async () => {
  const result = await serviceWith(redeemed('WAITING_FOR_SESSION'))({ cdk: CODE });
  assert.equal(result.state, 'NEEDS_SESSION');
  assert.equal(result.order.publicNo, 'PJV1-ABCDEFGHIJKLMNOPQRST');
  assert.equal(result.product.label, 'ChatGPT Plus');
});

test('an order that ended without taking money frees the code again', async () => {
  const seen = [];
  for (const ended of ['RECHARGE_FAILED', 'CLOSED']) {
    const verify = serviceWith(redeemed(ended), { blocked: false, onBlockedCheck: (id) => seen.push(id) });
    const result = await verify({ cdk: CODE });
    assert.equal(result.state, 'VALID');
    // A reusable code must not carry the dead order's number onto the screen.
    assert.equal('order' in result, false);
  }
  assert.deepEqual(seen, ['order-1', 'order-1']);
});

test('payment evidence keeps the code bound even when the order ended', async () => {
  const verify = serviceWith(redeemed('RECHARGE_FAILED'), { blocked: true });
  const result = await verify({ cdk: CODE });
  assert.equal(result.state, 'BOUND_TO_ORDER');
  assert.equal(result.order.publicNo, 'PJV1-ABCDEFGHIJKLMNOPQRST');
});

test('a delivered or running order sends the customer to that order, without asking the ledger', async () => {
  for (const live of ['RECHARGE_SUCCESS', 'CARD_PURCHASING', 'SUBMIT_UNKNOWN', 'CREATED']) {
    let asked = false;
    const verify = serviceWith(redeemed(live), { onBlockedCheck: () => { asked = true; } });
    const result = await verify({ cdk: CODE });
    assert.equal(result.state, 'BOUND_TO_ORDER', live);
    assert.equal(result.order.publicNo, 'PJV1-ABCDEFGHIJKLMNOPQRST');
    // The evidence query costs three COUNTs; only the branch that needs it pays.
    assert.equal(asked, false, live);
  }
});

test('a redeemed code with no order behind it is refused rather than guessed at', async () => {
  const result = await serviceWith({ status: 'REDEEMED', planType: 'plus', productName: null, order: null })({ cdk: CODE });
  assert.deepEqual(result, { state: 'INVALID' });
});

test('a mistyped code is an answer, a malformed request is an error', async () => {
  const verify = serviceWith(availableCdk);
  for (const tooShort of ['', '   ', 'PJ-ABC']) {
    assert.deepEqual(await verify({ cdk: tooShort }), { state: 'INVALID' });
  }
  assert.deepEqual(await verify({ cdk: 'x'.repeat(257) }), { state: 'INVALID' });
  for (const bad of [null, undefined, 'string', [], { cdk: 42 }, { code: CODE }]) {
    await assert.rejects(() => verify(bad), (error) => {
      assert.equal(error.code, 'INVALID_CDK_REQUEST');
      assert.equal(error.status, 400);
      return true;
    });
  }
});

test('the lookup matches either hash version and refuses an ambiguous double match', async () => {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return [[
        { id: 'c1', status: 'AVAILABLE', plan_type: 'plus', order_id: null, internal_order_id: null },
        { id: 'c2', status: 'AVAILABLE', plan_type: 'plus', order_id: null, internal_order_id: null }
      ]];
    }
  };
  const lookup = createCdkLookup(CODE, HASH_KEY);
  assert.equal(await findCdkForVerification(pool, lookup), null);
  assert.deepEqual(queries[0].params, [
    lookup.current.version, lookup.current.hash,
    lookup.legacy.version, lookup.legacy.hash
  ]);
  // Read-only by construction: one SELECT, no transaction, no locking clause.
  assert.match(queries[0].sql, /^\s*SELECT/);
  assert.equal(/FOR UPDATE|INSERT|UPDATE |DELETE/.test(queries[0].sql), false);
});

test('the plan label falls back to the code own plan when no product row is joined yet', async () => {
  const result = await serviceWith({ status: 'AVAILABLE', planType: 'pro_20x', productName: null, order: null })({ cdk: CODE });
  assert.deepEqual(result.product, { planType: 'pro_20x', label: 'ChatGPT Pro 20X' });
});
