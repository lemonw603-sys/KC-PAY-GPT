import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, '../../browser-poc/manifests/non-ph-functional-baseline-2026-08-22.json');

test('NON_PH_FUNCTIONAL baseline is read-only and cannot be promoted to payment', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.networkLevel, 'NON_PH_FUNCTIONAL');
  assert.equal(manifest.scope, 'AUTH_READ_ONLY');
  assert.equal(manifest.profile.siteStatePolicy, 'SESSION_ONLY');
  assert.equal(manifest.network.proxy, false);
  assert.equal(manifest.checkout.createAllowed, false);
  assert.equal(manifest.checkout.paymentWrites, false);
  assert.equal(manifest.promotion.eligibleForPhilippines, false);
  assert.equal(manifest.promotion.eligibleForPayment, false);
});
