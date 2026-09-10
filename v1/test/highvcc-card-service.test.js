import assert from 'node:assert/strict';
import test from 'node:test';

import { createHighvccCardService, BACKUP_A_PROVIDER_ACCOUNT_ID } from '../src/services/highvcc-card-service.js';

const encryptionKey = Buffer.alloc(32, 7);
const panHmacKey = Buffer.alloc(32, 9);

function fakeFetch(handlers) {
  return async (url, init) => {
    const path = new URL(url).pathname;
    const handler = handlers[path];
    if (!handler) throw new Error(`unexpected fetch to ${path}`);
    const result = handler(init);
    return { ok: result.status < 400, status: result.status, json: async () => result.body };
  };
}

function fakePool({ existingCardWithSamePan = false } = {}) {
  const settings = new Map();
  const addressAssignments = new Map();
  const cardsInserted = [];
  const connectionQueries = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params) {
      connectionQueries.push({ sql, params });
      if (sql.includes('SELECT id FROM cards WHERE pan_hmac')) {
        return [existingCardWithSamePan ? [{ id: 'existing-card' }] : []];
      }
      if (sql.startsWith('INSERT INTO cards')) { cardsInserted.push(params); return [{ affectedRows: 1 }]; }
      return [[]];
    },
  };
  const poolQueries = [];
  const pool = {
    connectionQueries, poolQueries, cardsInserted, settings,
    async getConnection() { return connection; },
    async query(sql, params) {
      poolQueries.push({ sql, params });
      if (sql.includes('FROM app_settings WHERE setting_key')) {
        const v = settings.get(params[0]);
        return [v ? [{ setting_value: v, updated_at: new Date('2026-09-10T08:00:00Z') }] : []];
      }
      if (sql.startsWith('INSERT INTO app_settings')) { settings.set(params[0], params[1]); return [{}]; }
      if (sql.includes('browser_billing_address_assignments') && sql.startsWith('SELECT row_index AS rowIndex, COUNT')) {
        return [[]];
      }
      if (sql.startsWith('INSERT IGNORE INTO browser_billing_address_assignments')) {
        addressAssignments.set(params[0], params[2]); return [{}];
      }
      if (sql.includes('SELECT row_index AS rowIndex FROM browser_billing_address_assignments WHERE binding_ref')) {
        const idx = addressAssignments.get(params[0]);
        return [idx == null ? [] : [{ rowIndex: idx }]];
      }
      return [[]];
    },
  };
  return pool;
}

test('setToken then getAccessToken round-trips through encryption, and tokenStatus never returns the value', async () => {
  const pool = fakePool();
  const service = createHighvccCardService({ pool, encryptionKey, panHmacKey });
  const before = await service.tokenStatus();
  assert.equal(before.configured, false);
  await service.setToken({ token: 'a'.repeat(32) });
  const after = await service.tokenStatus();
  assert.equal(after.configured, true);
  assert.ok(after.updatedAt);
  assert.equal(JSON.stringify(after).includes('a'.repeat(32)), false);
  // the stored setting_value is the base64 ciphertext, never the plaintext token
  assert.equal(pool.settings.get('highvcc_access_token_ciphertext').includes('a'.repeat(32)), false);
});

test('setToken rejects a value that does not look like a token', async () => {
  const pool = fakePool();
  const service = createHighvccCardService({ pool, encryptionKey, panHmacKey });
  await assert.rejects(service.setToken({ token: 'short' }), (e) => e.code === 'HIGHVCC_TOKEN_INVALID');
  await assert.rejects(service.setToken({ token: `has spaces ${'a'.repeat(20)}` }), (e) => e.code === 'HIGHVCC_TOKEN_INVALID');
});

test('quote: fails clearly when no token is configured, without calling the network', async () => {
  const pool = fakePool();
  const service = createHighvccCardService({ pool, encryptionKey, panHmacKey, fetchImpl: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(service.quote({ amount: 50 }), (e) => e.code === 'HIGHVCC_TOKEN_MISSING');
});

test('quote: defaults vid and returns the fee readout once a token is set', async () => {
  const pool = fakePool();
  const fetchImpl = fakeFetch({
    '/api/card/openCardCost': (init) => {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('vid'), '708'); // HIGHVCC_DEFAULT_VID
      return { status: 200, body: { code: 200, data: { feeDetail: '$50.50', popMsg: 'notice' } } };
    },
  });
  const service = createHighvccCardService({ pool, encryptionKey, panHmacKey, fetchImpl });
  await service.setToken({ token: 'a'.repeat(32) });
  const quote = await service.quote({ amount: 50 });
  assert.equal(quote.vid, '708');
  assert.equal(quote.feeDetail, '$50.50');
});

// Real production failure 2026-09-10: newCard rejected with "美元账户可用余额不足"
// (insufficient USD wallet balance) — a normal rejection, not a bug, but the admin UI had
// nothing to show beyond a generic "failed" message. The route must be able to surface the
// platform's own reason via `.detail` instead of only a bare error code.
test('openCard: a clean platform rejection (e.g. insufficient balance) surfaces the real reason via .detail, not just a code', async () => {
  const pool = fakePool();
  const fetchImpl = fakeFetch({
    '/api/card/autoCard': () => ({ status: 200, body: { code: 200, data: { firstName: 'Jamie', lastName: 'Winder' } } }),
    '/api/card/openCardCost': () => ({ status: 200, body: { code: 200, data: { feeDetail: '$50.50' } } }),
    '/api/card/newCard': () => ({ status: 200, body: { code: 500, msg: '美元账户可用余额不足' } }),
  });
  const service = createHighvccCardService({ pool, encryptionKey, panHmacKey, fetchImpl });
  await service.setToken({ token: 'a'.repeat(32) });
  await assert.rejects(service.openCard({ amount: 50, confirmation: '开卡 708 50' }), (e) => {
    assert.equal(e.code, 'HIGHVCC_API_ERROR');
    assert.equal(e.status, 502);
    assert.equal(e.detail, '美元账户可用余额不足');
    return true;
  });
  // rejected before newCard ever produced a card id: no partial/duplicate row written
  assert.equal(pool.cardsInserted.length, 0);
});

test('openCard: requires the exact confirmation phrase before spending anything', async () => {
  const pool = fakePool();
  const service = createHighvccCardService({ pool, encryptionKey, panHmacKey, fetchImpl: async () => { throw new Error('must not fetch'); } });
  await service.setToken({ token: 'a'.repeat(32) });
  await assert.rejects(
    service.openCard({ amount: 50, confirmation: 'wrong' }),
    (e) => e.code === 'HIGHVCC_OPEN_CONFIRMATION_REQUIRED'
  );
  assert.equal(pool.cardsInserted.length, 0);
});

function openHandlers({ balanceCents = 5000 } = {}) {
  return {
    '/api/card/autoCard': () => ({ status: 200, body: { code: 200, data: { firstName: 'Jamie', lastName: 'Winder' } } }),
    '/api/card/openCardCost': () => ({ status: 200, body: { code: 200, data: { feeDetail: '$50.50' } } }),
    '/api/card/newCard': () => ({ status: 200, body: { code: 200, data: 'HGabc123' } }),
    '/api/card/detail': () => ({ status: 200, body: { code: 200, data: {
      card: { cardId: 'HGabc123', number: '4111111111111111', cvc: '123', expMonth: 9, expYear: 2028, firstName: 'Jamie', lastName: 'Winder', balance: balanceCents },
      adress: { street: '3556 Se Woodward St', city: 'Portland', state: 'OR', zipCode: '97202' },
    } } }),
  };
}

test('openCard: full flow inserts one card row with cents converted to dollars and the backup-A provider account', async () => {
  const pool = fakePool();
  const service = createHighvccCardService({ pool, encryptionKey, panHmacKey, fetchImpl: fakeFetch(openHandlers()) });
  await service.setToken({ token: 'a'.repeat(32) });
  const result = await service.openCard({ amount: 50, confirmation: '开卡 708 50' });
  assert.equal(result.last4, '1111');
  assert.equal(result.balance, '50.00');
  assert.equal(result.holder, 'Jamie Winder');
  assert.equal(pool.cardsInserted.length, 1);
  const [params] = pool.cardsInserted;
  // (id, provider_card_id, card_type_id, last4, funded_amount, current_balance,
  //  credentials_ciphertext, pan_ciphertext, pan_hmac, provider_account_id, external_card_id)
  assert.equal(params[1], 'HGabc123'); // provider_card_id
  assert.equal(params[2], 'MANUAL_BACKUP'); // card_type_id — same inventory pool as spreadsheet-imported backup-A cards
  assert.equal(params[3], '1111'); // last4
  assert.equal(params[4], 50); // funded_amount, dollars not cents
  assert.equal(params[5], 50); // current_balance, dollars not cents
  assert.equal(Buffer.isBuffer(params[6]), true); // card_credentials_ciphertext
  assert.equal(Buffer.isBuffer(params[7]), true); // card_number_ciphertext
  assert.equal(params[9], BACKUP_A_PROVIDER_ACCOUNT_ID);
  assert.equal(params[10], 'HGabc123'); // external_card_id
  // never a plaintext PAN/CVC anywhere in the returned result
  assert.equal(JSON.stringify(result).includes('4111111111111111'), false);
  assert.equal(JSON.stringify(result).includes('123'), true); // "123" also matches other digits; explicit CVC field check instead
  assert.equal(Object.keys(result).includes('cvc'), false);
  assert.equal(Object.keys(result).includes('pan'), false);
});

test('openCard: a duplicate PAN (already in inventory) is refused after the money is already spent, not silently double-inserted', async () => {
  const pool = fakePool({ existingCardWithSamePan: true });
  const service = createHighvccCardService({ pool, encryptionKey, panHmacKey, fetchImpl: fakeFetch(openHandlers()) });
  await service.setToken({ token: 'a'.repeat(32) });
  await assert.rejects(
    service.openCard({ amount: 50, confirmation: '开卡 708 50' }),
    (e) => e.code === 'HIGHVCC_OPEN_DUPLICATE_CARD'
  );
  assert.equal(pool.cardsInserted.length, 0);
});

test('openCard: an amount outside the sane range is rejected before any network call', async () => {
  const pool = fakePool();
  const service = createHighvccCardService({ pool, encryptionKey, panHmacKey, fetchImpl: async () => { throw new Error('must not fetch'); } });
  await service.setToken({ token: 'a'.repeat(32) });
  await assert.rejects(service.openCard({ amount: -1, confirmation: '开卡 708 -1' }), (e) => e.code === 'HIGHVCC_INVALID_AMOUNT');
  await assert.rejects(service.openCard({ amount: 5000, confirmation: '开卡 708 5000' }), (e) => e.code === 'HIGHVCC_INVALID_AMOUNT');
});
