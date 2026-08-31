import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';

const manifest = JSON.parse(fs.readFileSync(new URL('../browser-poc/manifests/non-ph-functional-baseline-2026-08-22.json', import.meta.url)));
const usManifest = JSON.parse(fs.readFileSync(new URL('../browser-poc/manifests/non-ph-us-readonly-2026-08-23.json', import.meta.url)));

test('NON_PH_FUNCTIONAL manifest is read-only and cannot promote to payment', () => {
  assert.equal(manifest.scope, 'AUTH_READ_ONLY');
  assert.equal(manifest.networkLevel, 'NON_PH_FUNCTIONAL');
  assert.equal(manifest.checkout.createAllowed, false);
  assert.equal(manifest.checkout.observationPermit, false);
  assert.equal(manifest.checkout.paymentWrites, false);
  assert.equal(manifest.promotion.eligibleForPayment, false);
  assert.equal(manifest.promotion.eligibleForPhilippines, false);
  assert.equal(manifest.profile.profileMode, 'TEMPORARY_BROWSER_CONTEXT');
  assert.equal(manifest.profile.cloudProfile, false);
  assert.equal(manifest.profile.profileSync, false);
});

test('NON_PH_US is a separate read-only cohort and cannot promote to PH or payment', () => {
  assert.equal(usManifest.networkLevel, 'NON_PH_US');
  assert.equal(usManifest.scope, 'AUTH_READ_ONLY');
  assert.equal(usManifest.network.proxy, true);
  assert.equal(usManifest.network.countryAssertion, 'US');
  assert.equal(usManifest.checkout.createAllowed, false);
  assert.equal(usManifest.checkout.paymentWrites, false);
  assert.equal(usManifest.promotion.eligibleForPhilippines, false);
  assert.equal(usManifest.promotion.eligibleForPayment, false);
});
