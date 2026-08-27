import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ledgerSql = fs.readFileSync(new URL('../migrations/038_card_consumption_capacity.sql', import.meta.url), 'utf8');
const attemptLinkSql = fs.readFileSync(new URL('../migrations/039_card_consumption_attempt_link.sql', import.meta.url), 'utf8');

test('card consumption ledger reserves capacity independently from provider transaction sync', () => {
  assert.match(ledgerSql, /CREATE TABLE IF NOT EXISTS card_consumption_ledger/i);
  assert.match(ledgerSql, /status IN \('RESERVED','CONSUMED','RELEASED','RECONCILIATION'\)/i);
  assert.match(ledgerSql, /UNIQUE KEY uq_card_consumption_order \(card_id, order_id\)/i);
  assert.match(ledgerSql, /card_max_successful_payments[^]*'3'/i);
});

test('attempt linkage is additive and replay guarded after migration 038', () => {
  assert.match(attemptLinkSql, /information_schema\.COLUMNS/i);
  assert.match(attemptLinkSql, /ADD COLUMN recharge_attempt_id CHAR\(36\)/i);
  assert.match(attemptLinkSql, /UNIQUE INDEX uq_card_consumption_attempt/i);
  assert.match(attemptLinkSql, /CONSTRAINT fk_card_consumption_attempt FOREIGN KEY/i);
  assert.doesNotMatch(attemptLinkSql, /DROP\s+(?:TABLE|COLUMN)/i);
});
