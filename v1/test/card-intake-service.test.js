import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createCardIntakeService } from '../src/services/card-intake-service.js';

function cardDetail(id, overrides = {}) {
  return { data: {
    id, cardTypeId: 'bin-1', status: 'active', fundedAmount: '16.00',
    currentBalance: '16.00', currency: 'USD',
    cardNumber: `4242424242${String(id).replace(/\D/g, '').padStart(6, '0').slice(-6)}`,
    cvv: '123', expiryMonth: 12, expiryYear: 2032,
    ownershipCertain: true, ...overrides
  } };
}

function createMemoryRepository({ existing = [] } = {}) {
  const batches = new Map();
  const discoveries = new Map();
  const cards = new Map(existing.map((key) => [key, { id: `existing-${key}` }]));
  let sequence = 0;
  const key = (account, externalId) => `${account}:${externalId}`;
  const refresh = (batchId) => {
    const batch = batches.get(batchId);
    const rows = [...discoveries.values()].filter((item) => item.intakeBatchId === batchId);
    Object.assign(batch, {
      discoveredCount: rows.length,
      acceptedCount: rows.filter((row) => row.intakeStatus === 'ACCEPTED').length,
      reviewCount: rows.filter((row) => row.intakeStatus === 'REVIEW_REQUIRED').length,
      failedCount: rows.filter((row) => row.intakeStatus === 'FAILED').length
    });
    return { ...batch };
  };
  return {
    batches, discoveries, cards,
    async createBatch(input) {
      const active = [...batches.values()].find((batch) => batch.providerAccountId === input.providerAccountId
        && ['DISCOVERING', 'VALIDATING'].includes(batch.status));
      if (active) return { created: false, batch: { ...active } };
      const batch = { id: `batch-${++sequence}`, status: 'DISCOVERING', ...input };
      batches.set(batch.id, batch);
      return { created: true, batch: { ...batch } };
    },
    async setBatchStatus(id, status) { batches.get(id).status = status; },
    async findExistingExternalIds(account, ids) {
      return new Map(ids.filter((id) => cards.has(key(account, id)))
        .map((id) => [id, cards.get(key(account, id)).id]));
    },
    async addDiscovery({ batchId, providerAccountId, externalCardId, details }) {
      if (cards.has(key(providerAccountId, externalCardId))) {
        return { kind: 'existing', cardId: cards.get(key(providerAccountId, externalCardId)).id };
      }
      const duplicate = [...discoveries.values()].find((row) => row.intakeBatchId === batchId
        && row.providerAccountId === providerAccountId && row.externalCardId === externalCardId);
      if (duplicate) return { kind: 'duplicate', discovery: duplicate };
      const row = { id: `discovery-${++sequence}`, intakeBatchId: batchId, providerAccountId,
        externalCardId, intakeStatus: 'QUARANTINED', validationAttempts: 0,
        firstSnapshotHash: null, secondSnapshotHash: null, details };
      discoveries.set(row.id, row);
      return { kind: 'discovered', discovery: { ...row } };
    },
    async getDiscovery(id) { const row = discoveries.get(id); return row ? { ...row } : null; },
    async listDiscoveries(batchId, { statuses }) {
      return [...discoveries.values()].filter((row) => row.intakeBatchId === batchId
        && statuses.includes(row.intakeStatus)).map((row) => ({ ...row }));
    },
    async recordValidationSnapshot(id, { snapshotHash, details, rulesPassed, ownershipCertain }) {
      const row = discoveries.get(id);
      const stable = Boolean(row.firstSnapshotHash && row.firstSnapshotHash === snapshotHash);
      row.validationAttempts += 1;
      row.firstSnapshotHash = stable ? row.firstSnapshotHash : snapshotHash;
      row.secondSnapshotHash = stable ? snapshotHash : null;
      row.details = details;
      row.intakeStatus = stable
        ? rulesPassed && ownershipCertain ? 'VALIDATED' : 'REVIEW_REQUIRED'
        : 'QUARANTINED';
      return { stable, discovery: { ...row } };
    },
    async markDiscoveryFailed(id, code, reason) {
      const row = discoveries.get(id);
      row.intakeStatus = 'FAILED'; row.failureCode = code; row.failureReason = reason;
    },
    async acceptDiscovery(id, card, { manual = false } = {}) {
      const row = discoveries.get(id);
      assert.ok(row.validationAttempts >= 2);
      assert.equal(row.firstSnapshotHash, row.secondSnapshotHash);
      assert.equal(row.details.validation.rulesPassed, true);
      if (row.intakeStatus === 'REVIEW_REQUIRED') assert.equal(manual, true);
      const scoped = key(row.providerAccountId, row.externalCardId);
      if (cards.has(scoped)) { row.intakeStatus = 'EXISTING'; return { kind: 'existing' }; }
      cards.set(scoped, { id: `card-${++sequence}`, ...card });
      row.intakeStatus = 'ACCEPTED';
      return { kind: 'accepted', inventoryStatus: card.inventoryStatus };
    },
    async refreshBatchStats(id) { return refresh(id); },
    async finalizeBatchIfSettled(id) {
      const pending = [...discoveries.values()].some((row) => row.intakeBatchId === id
        && ['QUARANTINED', 'VALIDATED'].includes(row.intakeStatus));
      batches.get(id).status = pending ? 'VALIDATING' : 'COMPLETED';
      return refresh(id);
    }
  };
}

function createPagedProvider(details, { total = 50 } = {}) {
  const ids = Array.from({ length: total }, (_, index) => `card-${index + 1}`);
  return {
    listCalls: [], detailCalls: new Map(),
    async cards({ page, pageSize }) {
      this.listCalls.push({ page, pageSize });
      const start = (page - 1) * pageSize;
      return { data: { cards: ids.slice(start, start + pageSize).map((id) => ({ id })), total } };
    },
    async card(id) {
      const count = (this.detailCalls.get(id) || 0) + 1;
      this.detailCalls.set(id, count);
      const factory = details[id] || (() => cardDetail(id));
      return factory(count);
    }
  };
}

test('discovers 50 cards with pagination and keeps every new card quarantined', async () => {
  const repository = createMemoryRepository({ existing: ['acct-a:card-50'] });
  const provider = createPagedProvider({});
  const service = createCardIntakeService({ provider, repository, providerAccountId: 'acct-a',
    credentialEncryptionKey: crypto.randomBytes(32), pageSize: 20,
    validationRules: { expectedCardTypeId: 'bin-1', expectedAmount: 16, minimumBalance: 15.5 },
    assumeDedicatedAccount: true });

  const result = await service.discover();
  assert.equal(result.providerTotal, 50);
  assert.equal(result.existing, 1);
  assert.equal(result.discovered, 49);
  assert.deepEqual(provider.listCalls.map((call) => call.page), [1, 2, 3]);
  assert.ok([...repository.discoveries.values()].every((row) => row.intakeStatus === 'QUARANTINED'));
  assert.equal(repository.cards.size, 1, 'discovery must never write a new inventory card');

  const duplicate = await service.discover();
  assert.equal(duplicate.created, false);
  assert.equal(repository.discoveries.size, 49);
});

test('requires two stable snapshots and isolates partial failures without rolling back the batch', async () => {
  const repository = createMemoryRepository({ existing: ['acct-a:card-50'] });
  const details = {
    'card-46': (attempt) => cardDetail('card-46', { currentBalance: attempt === 1 ? '16.00' : '16.10' }),
    'card-47': () => cardDetail('card-47', { ownershipCertain: false }),
    'card-48': () => cardDetail('card-48', { cardTypeId: 'wrong-bin' }),
    'card-49': () => { throw Object.assign(new Error('upstream detail error'), { code: 'UPSTREAM_READ' }); }
  };
  const provider = createPagedProvider(details);
  const service = createCardIntakeService({ provider, repository, providerAccountId: 'acct-a',
    credentialEncryptionKey: Buffer.alloc(32, 7), pageSize: 50,
    validationRules: { expectedCardTypeId: 'bin-1', expectedAmount: 16, minimumBalance: 15.5 },
    assumeDedicatedAccount: true });
  const intake = await service.discover();

  const first = await service.validateBatch(intake.batch.id);
  assert.deepEqual({ accepted: first.accepted, pending: first.pending, failed: first.failed },
    { accepted: 0, pending: 48, failed: 1 });
  assert.equal(repository.cards.size, 1);

  const second = await service.validateBatch(intake.batch.id);
  assert.equal(second.accepted, 45);
  assert.equal(second.pending, 1);
  assert.equal(second.reviewRequired, 2);
  assert.equal(second.failed, 0);
  assert.equal(second.batch.acceptedCount, 45);
  assert.equal(second.batch.reviewCount, 2);
  assert.equal(second.batch.failedCount, 1);
  assert.equal(second.batch.status, 'VALIDATING');
  assert.equal(repository.cards.has('acct-a:card-47'), false, 'unknown ownership must not enter inventory');

  const third = await service.validateBatch(intake.batch.id);
  assert.equal(third.accepted, 1);
  assert.equal(third.batch.status, 'COMPLETED');
});

test('explicit batch acceptance cannot bypass stable technical rules', async () => {
  const repository = createMemoryRepository();
  const provider = createPagedProvider({
    'card-1': () => cardDetail('card-1', { ownershipCertain: false }),
    'card-2': () => cardDetail('card-2', { ownershipCertain: false, fundedAmount: '5' })
  }, { total: 2 });
  const service = createCardIntakeService({ provider, repository, providerAccountId: 'shared-acct',
    credentialEncryptionKey: Buffer.alloc(32, 9), panHmacKey: Buffer.from('independent-pan-key'),
    validationRules: { expectedCardTypeId: 'bin-1', expectedAmount: 16, minimumBalance: 15.5 } });
  const intake = await service.discover();
  await service.validateBatch(intake.batch.id);
  await service.validateBatch(intake.batch.id);
  const rows = [...repository.discoveries.values()];
  assert.ok(rows.every((row) => row.intakeStatus === 'REVIEW_REQUIRED'));

  const accepted = await service.acceptDiscoveries({ batchId: intake.batch.id,
    discoveryIds: rows.map((row) => row.id) });
  assert.equal(accepted.accepted, 1);
  assert.equal(accepted.rejected, 1);
  const stored = repository.cards.get('shared-acct:card-1');
  assert.equal(stored.inventoryStatus, 'AVAILABLE');
  assert.equal(stored.panHmac.length, 64);
  assert.equal(repository.cards.has('shared-acct:card-2'), false);
});

test('same external card ID is independently valid in different provider accounts', async () => {
  const repository = createMemoryRepository();
  for (const account of ['acct-a', 'acct-b']) {
    const provider = createPagedProvider({}, { total: 1 });
    const service = createCardIntakeService({ provider, repository, providerAccountId: account,
      credentialEncryptionKey: Buffer.alloc(32, account === 'acct-a' ? 1 : 2),
      validationRules: { expectedCardTypeId: 'bin-1', expectedAmount: 16 },
      assumeDedicatedAccount: true });
    const intake = await service.discover();
    await service.validateBatch(intake.batch.id);
    await service.validateBatch(intake.batch.id);
  }
  assert.ok(repository.cards.has('acct-a:card-1'));
  assert.ok(repository.cards.has('acct-b:card-1'));
});

test('PAN HMAC remains null when its independent key is not configured', async () => {
  const repository = createMemoryRepository();
  const service = createCardIntakeService({ provider: createPagedProvider({}, { total: 1 }), repository,
    providerAccountId: 'acct-a', credentialEncryptionKey: Buffer.alloc(32, 3),
    validationRules: { expectedCardTypeId: 'bin-1', expectedAmount: 16 }, assumeDedicatedAccount: true });
  const intake = await service.discover();
  await service.validateBatch(intake.batch.id);
  await service.validateBatch(intake.batch.id);
  assert.equal(repository.cards.get('acct-a:card-1').panHmac, null);
});
