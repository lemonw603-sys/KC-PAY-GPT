import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { normalizeCdkOptions, resolveCdkExpiry, CDK_STATE_SQL } from '../src/services/cdk-policy.js';
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('generation defaults to 30 days; never and explicit dates are separate choices', () => {
  const now = new Date('2026-09-21T10:00:00Z');
  assert.equal(resolveCdkExpiry(normalizeCdkOptions(), now).toISOString(), '2026-10-21T10:00:00.000Z');
  assert.equal(resolveCdkExpiry(normalizeCdkOptions({ expiryMode: 'NEVER' }), now), null);
  assert.throws(() => normalizeCdkOptions({ expiryMode: 'CUSTOM', expiresAt: '2026-10-21' }));
  assert.throws(() => resolveCdkExpiry(normalizeCdkOptions({ expiryMode: 'CUSTOM', expiresAt: '2026-09-20T10:00:00Z' }), now));
  assert.equal(normalizeCdkOptions({ amount: '12.1' }).amount, '12.10');
  for (const amount of ['-1', '1.234', '1e2', 'NaN']) assert.throws(() => normalizeCdkOptions({ amount }));
  assert.equal(normalizeCdkOptions({ note: '' }).issuanceKind, 'NORMAL');
});

test('summary and filters share delivery, expiry and legacy predicates', () => {
  assert.match(CDK_STATE_SQL.done, /RECHARGE_SUCCESS/);
  assert.match(CDK_STATE_SQL.pending, /expires_at > CURRENT_TIMESTAMP/);
  assert.match(CDK_STATE_SQL.reserve, /issuance_kind = 'RESERVE'/);
  assert.doesNotMatch(CDK_STATE_SQL.attention, /updated_at/);
});

test('page contract: single pipeline, bulk controls, no rollback-to-stock or obsolete batch list', async () => {
  const html = await read('../public/admin/index.html');
  assert.match(html, /id="cdk-bulk-actions"/);
  assert.match(html, /id="cdk-expiry-mode"/);
  assert.doesNotMatch(html, /id="cdk-batches"|Pro 是两阶段/);
  const js = await read('../public/admin/assets/cdks.js');
  assert.doesNotMatch(js, /data-unissue-cdk/);
  assert.match(js, /generation_fingerprint|JSON.stringify\(input\)/);
  assert.match(js, /clearSelection/);
  assert.match(js, /post\('\/api\/v1\/admin\/cdks\/search'/);
  assert.doesNotMatch(js, /cdks\/codes\?\$/);
  const intake = await read('../src/db/repositories/order-intake-repository.js');
  assert.match(intake, /issued_at = COALESCE\(issued_at, CURRENT_TIMESTAMP\(3\)\)/);
});
