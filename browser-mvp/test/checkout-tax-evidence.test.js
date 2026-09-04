import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertEvidenceIsSecretFree,
  sanitizeCheckoutCreateRequest,
  sanitizeCheckoutCreateResponse,
  sanitizeCheckoutSnapshotRequest,
  sanitizeObservedRequest,
  sanitizeObservedResponse,
} from '../src/checkout-tax-evidence.js';

test('checkout request evidence keeps only pricing controls', () => {
  const secrets = ['sk-synthetic-secret', '4242424242424242', '123', '100 Example Street', '00000'];
  const evidence = sanitizeCheckoutCreateRequest(
    'https://chatgpt.com/backend-api/payments/checkout?token=never-log-this',
    'POST',
    JSON.stringify({
      entry_point: 'all_plans_pricing_modal',
      plan_name: 'chatgptplusplan',
      checkout_ui_mode: 'custom',
      billing_details: { country: 'ph', currency: 'php', line1: secrets[3], postalCode: secrets[4] },
      card: { pan: secrets[1], cvc: secrets[2] },
      accessToken: secrets[0],
    }),
  );
  assert.deepEqual(evidence, {
    kind: 'checkout-create-request', method: 'POST', origin: 'https://chatgpt.com',
    path: '/backend-api/payments/checkout', bodyFormat: 'json',
    entryPoint: 'all_plans_pricing_modal', planName: 'chatgptplusplan', checkoutUiMode: 'custom',
    billingCountry: 'PH', billingCurrency: 'PHP',
  });
  assert.equal(assertEvidenceIsSecretFree(evidence, secrets), true);
});

test('checkout response evidence discards ids, URLs and secrets recursively', () => {
  const secrets = ['cs_live_secret', 'oaics_secret', 'test@example.com'];
  const evidence = sanitizeCheckoutCreateResponse(
    'https://chatgpt.com/backend-api/payments/checkout',
    200,
    JSON.stringify({
      checkout_session_id: secrets[1], url: `https://example.test/${secrets[0]}`,
      nested: { billing_country: 'PH', billing_currency: 'PHP', processor_entity: 'OpenAI LLC' },
      customer: { email: secrets[2] },
    }),
  );
  assert.equal(evidence.status, 200);
  assert.equal(evidence.billingCountry, 'PH');
  assert.equal(evidence.billingCurrency, 'PHP');
  assert.equal(evidence.processorEntity, 'OpenAI LLC');
  assert.deepEqual(evidence.pricingSignals, {
    'nested.billing_country': 'PH', 'nested.billing_currency': 'PHP',
  });
  assert.equal(assertEvidenceIsSecretFree(evidence, secrets), true);
});

test('pricing and Stripe observations retain path and status but never query or body', () => {
  const pricing = sanitizeObservedRequest(
    'https://chatgpt.com/backend-api/checkout_pricing_config/configs/PH?secret=value', 'GET', null,
  );
  const stripe = sanitizeObservedResponse(
    'https://api.stripe.com/v1/payment_methods?client_secret=secret', 200, '{"card":"never"}',
  );
  assert.deepEqual(pricing, {
    kind: 'pricing-config-request', method: 'GET', origin: 'https://chatgpt.com',
    path: '/backend-api/checkout_pricing_config/configs/PH',
  });
  assert.deepEqual(stripe, {
    kind: 'stripe-response', status: 200, origin: 'https://api.stripe.com', path: '/v1/payment_methods',
  });
  assert.equal(assertEvidenceIsSecretFree([pricing, stripe], ['value', 'secret', 'never']), true);
});

test('billing snapshot records only region and field-presence booleans', () => {
  const secrets = ['Synthetic Tester', '100 Example Street', 'Example City', '00000'];
  const evidence = sanitizeCheckoutSnapshotRequest(
    'https://chatgpt.com/backend-api/payments/checkout/snapshot', 'POST',
    JSON.stringify({ snapshot: { billing_address: { name: secrets[0], address: {
      line1: secrets[1], city: secrets[2], country: 'US', postal_code: secrets[3], state: 'DE',
    } } } }),
  );
  assert.deepEqual(evidence, {
    kind: 'checkout-snapshot-request', method: 'POST', origin: 'https://chatgpt.com',
    path: '/backend-api/payments/checkout/snapshot', bodyFormat: 'json',
    billingCountry: 'US', billingState: 'DE', namePresent: true, streetPresent: true,
    cityPresent: true, zipPresent: true,
  });
  assert.equal(assertEvidenceIsSecretFree(evidence, secrets), true);
});

test('Stripe payment page path redacts the checkout identifier', () => {
  const secretId = 'cs_live_this_must_not_be_logged';
  const evidence = sanitizeObservedResponse(`https://api.stripe.com/v1/payment_pages/${secretId}/init`, 200);
  assert.equal(evidence.path, '/v1/payment_pages/:checkout/init');
  assert.equal(assertEvidenceIsSecretFree(evidence, [secretId]), true);
});

test('pricing config response keeps tax and PSP signals but drops identifiers and secrets', () => {
  const evidence = sanitizeObservedResponse(
    'https://chatgpt.com/backend-api/checkout_pricing_config/configs/PH',
    200,
    JSON.stringify({
      country: 'PH', currency: 'PHP', plus: { price: 982.14, tax_inclusive: false, vat_rate: 12 },
      psp_override: { amount: 982.14, currency: 'PHP' },
      cookie_preferences: { price: 1, currency: 'USD' },
      client_secret: 'never-log', customer_email: 'test@example.com', checkout_session_id: 'oaics_never',
    }),
  );
  assert.deepEqual(evidence.pricingSignals, {
    country: 'PH', currency: 'PHP', 'plus.price': 982.14, 'plus.tax_inclusive': false,
    'plus.vat_rate': 12, 'psp_override.amount': 982.14, 'psp_override.currency': 'PHP',
  });
  assert.equal(assertEvidenceIsSecretFree(evidence, ['never-log', 'test@example.com', 'oaics_never']), true);
});

test('unrelated traffic and invalid modes are ignored or nulled', () => {
  assert.equal(sanitizeObservedRequest('https://chatgpt.com/backend-api/me', 'GET', null), null);
  const evidence = sanitizeCheckoutCreateRequest(
    'https://chatgpt.com/backend-api/payments/checkout', 'POST',
    JSON.stringify({ checkout_ui_mode: 'unsafe', billing_details: { country: 'Philippines', currency: 'PESO' } }),
  );
  assert.equal(evidence.checkoutUiMode, null);
  assert.equal(evidence.billingCountry, null);
  assert.equal(evidence.billingCurrency, null);
});

test('secret scan rejects forbidden field names but not harmless URL path text', () => {
  assert.equal(assertEvidenceIsSecretFree({ path: '/cookie-preferences/status' }), true);
  assert.equal(assertEvidenceIsSecretFree({ digest: 'abc579def' }, ['579']), true);
  assert.throws(
    () => assertEvidenceIsSecretFree({ harmlessName: '579' }, ['579']),
    /forbidden value/,
  );
  assert.throws(
    () => assertEvidenceIsSecretFree({ nested: { client_secret: 'redacted' } }),
    /forbidden field: client_secret/,
  );
});
