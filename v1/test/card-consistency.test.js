import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCardConsistencyReport } from '../src/diagnostics/card-consistency.js';

test('reports an active provider card when the local catalog is empty', () => {
  const report = buildCardConsistencyReport({
    providerCards: [{ id: 444, status: 'active', cardNumber: 'should-never-be-returned' }],
    localCards: []
  });
  assert.equal(report.ok, false);
  assert.equal(report.providerCardCount, 1);
  assert.equal(report.localCardCount, 0);
  assert.deepEqual(report.findings.map((item) => item.code), [
    'LOCAL_CARD_CATALOG_EMPTY',
    'UNMAPPED_PROVIDER_CARD'
  ]);
  assert.equal(JSON.stringify(report).includes('should-never-be-returned'), false);
});

test('reports local cards missing upstream and terminal status conflicts', () => {
  const report = buildCardConsistencyReport({
    providerCards: [{ cardId: 'upstream-active', status: 'active' }],
    localCards: [
      { provider_card_id: 'upstream-active', status: 'FAILED' },
      { provider_card_id: 'local-only', status: 'ACTIVE' }
    ]
  });
  assert.deepEqual(report.findings.map((item) => item.code), [
    'CARD_STATUS_CONFLICT',
    'LOCAL_CARD_MISSING_UPSTREAM'
  ]);
  assert.equal(report.criticalCount, 2);
});

test('returns a healthy report for aligned card catalogs', () => {
  const report = buildCardConsistencyReport({
    providerCards: [{ card_id: '444', card_status: 'active' }],
    localCards: [{ provider_card_id: '444', status: 'READY' }]
  });
  assert.deepEqual(report, {
    ok: true,
    providerCardCount: 1,
    localCardCount: 1,
    criticalCount: 0,
    warningCount: 0,
    findings: []
  });
});

test('rejects cards without stable identifiers', () => {
  const report = buildCardConsistencyReport({
    providerCards: [{ status: 'active' }],
    localCards: [{ status: 'ACTIVE' }]
  });
  assert.deepEqual(report.findings.map((item) => item.code), [
    'PROVIDER_CARD_WITHOUT_ID',
    'LOCAL_CARD_WITHOUT_PROVIDER_ID'
  ]);
});
