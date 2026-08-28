import crypto from 'node:crypto';
import { encryptSecret } from '../security/secret-box.js';

const ACTIVE = new Set(['active', 'available', 'usable', 'ready']);
const TERMINAL = new Set(['failed', 'failure', 'invalid', 'inactive', 'closed', 'cancelled', 'canceled']);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function stableCardSnapshotHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function first(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function unwrapDetail(envelope) {
  return envelope?.data?.card ?? envelope?.data ?? envelope ?? {};
}

function defaultMapListPage(response) {
  const data = response?.data ?? response ?? {};
  const cards = data.cards ?? data.items ?? data.list ?? [];
  return {
    cards: Array.isArray(cards) ? cards : [],
    total: Number.isFinite(Number(data.total)) ? Number(data.total) : null,
    watermark: data.watermark ?? data.nextWatermark ?? data.updatedAt ?? null
  };
}

function defaultMapListCard(record) {
  return {
    externalCardId: first(record, ['id', 'cardId', 'card_id']),
    watermark: first(record, ['updatedAt', 'updated_at', 'createdAt', 'created_at'])
  };
}

function defaultMapCardDetail(envelope, { externalCardId } = {}) {
  const data = unwrapDetail(envelope);
  const cardNumber = first(data, ['cardNumber', 'card_number', 'pan']);
  const cvv = first(data, ['cvv', 'cvc', 'securityCode', 'security_code']);
  const expMonth = first(data, ['expiryMonth', 'expiry_month', 'expMonth', 'exp_month']);
  const expYear = first(data, ['expiryYear', 'expiry_year', 'expYear', 'exp_year']);
  return {
    externalCardId: String(first(data, ['id', 'cardId', 'card_id']) ?? externalCardId ?? ''),
    cardTypeId: first(data, ['cardTypeId', 'card_type_id', 'cardBinId', 'card_bin_id']),
    cardTypeName: first(data, ['cardType', 'card_type']),
    status: String(first(data, ['status', 'cardStatus', 'card_status']) || '').toLowerCase(),
    fundedAmount: first(data, ['fundedAmount', 'funded_amount', 'openAmount', 'open_amount', 'amount']),
    currentBalance: first(data, ['cardBalance', 'currentBalance', 'current_balance', 'balance']),
    currency: String(first(data, ['currency', 'cardCurrency', 'card_currency']) || 'USD').toUpperCase(),
    credentials: cardNumber && cvv && expMonth && expYear ? {
      cardNumber: String(cardNumber).replace(/\s+/g, ''),
      cvv: String(cvv), expMonth: Number(expMonth), expYear: Number(expYear)
    } : null,
    ownershipCertain: data.ownershipCertain ?? data.ownership_certain
  };
}

function resolveMappedCardType(card, rules) {
  if (card.cardTypeId != null && String(card.cardTypeId).trim() !== '') return card;
  const name = String(card.cardTypeName || '').trim();
  if (!name) return card;
  const matches = (rules.allowedCardTypes || []).filter((item) =>
    String(item?.name || '').trim() === name && String(item?.id || '').trim());
  return matches.length === 1 ? { ...card, cardTypeId: String(matches[0].id) } : card;
}

function numberOrNull(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function validateMappedCard(card, rules, assumeDedicatedAccount) {
  const errors = [];
  const externalCardId = String(card.externalCardId || '').trim();
  const cardTypeId = String(card.cardTypeId || '').trim();
  const status = String(card.status || '').trim().toLowerCase();
  const fundedAmount = numberOrNull(card.fundedAmount);
  const currentBalance = numberOrNull(card.currentBalance);
  const allowedTypes = new Set((rules.allowedCardTypeIds ||
    (rules.expectedCardTypeId != null ? [rules.expectedCardTypeId] : [])).map(String));
  const expectedAmount = rules.expectedAmount == null ? null : Number(rules.expectedAmount);
  const minimumBalance = Math.max(0, Number(rules.minimumBalance ?? expectedAmount ?? 0));
  const tolerance = Math.max(0, Number(rules.amountTolerance ?? 0.000001));

  if (!externalCardId) errors.push('EXTERNAL_ID_MISSING');
  if (!cardTypeId) errors.push('CARD_TYPE_MISSING');
  else if (allowedTypes.size && !allowedTypes.has(cardTypeId)) errors.push('CARD_TYPE_MISMATCH');
  if (!status) errors.push('STATUS_MISSING');
  if (Number.isNaN(fundedAmount)) errors.push('FUNDED_AMOUNT_INVALID');
  if (expectedAmount != null) {
    if (fundedAmount == null) errors.push('FUNDED_AMOUNT_MISSING');
    else if (Math.abs(fundedAmount - expectedAmount) > tolerance) errors.push('FUNDED_AMOUNT_MISMATCH');
  }
  if (Number.isNaN(currentBalance) || (currentBalance != null && currentBalance < 0)) {
    errors.push('BALANCE_INVALID');
  }

  const credentials = card.credentials;
  const credentialsComplete = Boolean(credentials?.cardNumber && credentials?.cvv
    && Number.isInteger(Number(credentials?.expMonth)) && Number(credentials.expMonth) >= 1
    && Number(credentials.expMonth) <= 12 && Number.isInteger(Number(credentials?.expYear)));
  const ownershipCertain = card.ownershipCertain == null
    ? Boolean(assumeDedicatedAccount) : Boolean(card.ownershipCertain);
  const rulesPassed = errors.length === 0;
  const active = ACTIVE.has(status);
  const terminal = TERMINAL.has(status);
  const balanceReady = currentBalance != null && currentBalance >= minimumBalance;
  const readiness = terminal ? 'FAILED'
    : active && credentialsComplete && balanceReady ? 'AVAILABLE' : 'PROVISIONING';
  return { errors, rulesPassed, ownershipCertain, credentialsComplete, readiness,
    minimumBalance: String(minimumBalance) };
}

function sanitizedDetails(card, validation) {
  const number = card.credentials?.cardNumber || '';
  return {
    externalCardId: String(card.externalCardId),
    cardTypeId: card.cardTypeId == null ? null : String(card.cardTypeId),
    cardTypeName: card.cardTypeName == null ? null : String(card.cardTypeName),
    status: String(card.status || ''),
    fundedAmount: card.fundedAmount == null ? null : String(card.fundedAmount),
    currentBalance: card.currentBalance == null ? null : String(card.currentBalance),
    currency: String(card.currency || 'USD'),
    last4: number ? String(number).slice(-4) : null,
    validation
  };
}

function cardSnapshot(card) {
  return {
    externalCardId: String(card.externalCardId || ''),
    cardTypeId: card.cardTypeId == null ? null : String(card.cardTypeId),
    cardTypeName: card.cardTypeName == null ? null : String(card.cardTypeName),
    status: String(card.status || '').toLowerCase(),
    fundedAmount: card.fundedAmount == null ? null : String(card.fundedAmount),
    currentBalance: card.currentBalance == null ? null : String(card.currentBalance),
    currency: String(card.currency || 'USD').toUpperCase(),
    credentials: card.credentials ? {
      cardNumber: String(card.credentials.cardNumber || '').replace(/\s+/g, ''),
      cvv: String(card.credentials.cvv || ''),
      expMonth: Number(card.credentials.expMonth), expYear: Number(card.credentials.expYear)
    } : null,
    ownershipCertain: card.ownershipCertain == null ? null : Boolean(card.ownershipCertain)
  };
}

export function createCardIntakeService({ provider, repository, providerAccountId,
  credentialEncryptionKey, sessionEncryptionKey, panHmacKey = null,
  getOperationalOverride = null,
  pageSize = 50, maxPages = 100, validationRules = {}, assumeDedicatedAccount = false,
  mapListPage = defaultMapListPage, mapListCard = defaultMapListCard,
  mapCardDetail = defaultMapCardDetail } = {}) {
  if (!provider?.cards || !provider?.card) throw new Error('Card intake requires cards() and card() provider methods');
  if (!repository) throw new Error('Card intake requires a repository');
  if (!providerAccountId) throw new Error('Card intake requires providerAccountId');
  const encryptionKey = credentialEncryptionKey ?? sessionEncryptionKey;
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
    throw new Error('Card intake credential encryption key must be exactly 32 bytes');
  }
  const safePageSize = Math.max(1, Math.min(500, Number(pageSize) || 50));
  const safeMaxPages = Math.max(1, Math.min(1000, Number(maxPages) || 100));

  async function fetchCatalog() {
    const records = [];
    const pageWatermarks = [];
    let expectedTotal = null;
    for (let page = 1; page <= safeMaxPages; page += 1) {
      const mapped = await mapListPage(await provider.cards({ page, pageSize: safePageSize }), { page });
      const items = Array.isArray(mapped?.cards) ? mapped.cards : [];
      if (mapped?.total != null && Number.isFinite(Number(mapped.total))) expectedTotal = Number(mapped.total);
      if (mapped?.watermark != null) pageWatermarks.push(String(mapped.watermark));
      for (const item of items) {
        const summary = await mapListCard(item, { page });
        const id = String(summary?.externalCardId || '').trim();
        if (id) records.push({ externalCardId: id, watermark: summary?.watermark ?? null });
      }
      if (expectedTotal != null && records.length >= expectedTotal) break;
      if (items.length < safePageSize) break;
      if (page === safeMaxPages) {
        const error = new Error('Provider card list exceeded the configured page limit');
        error.code = 'CARD_LIST_PAGE_LIMIT';
        throw error;
      }
    }
    const unique = [...new Map(records.map((item) => [item.externalCardId, item])).values()]
      .sort((a, b) => a.externalCardId.localeCompare(b.externalCardId));
    const baselineHash = stableCardSnapshotHash(unique);
    const watermarkValues = [...pageWatermarks, ...unique.map((item) => item.watermark).filter((v) => v != null)].sort();
    return {
      records: unique,
      baselineHash,
      baselineWatermark: watermarkValues.at(-1) || null,
      baseline: { count: unique.length, idsHash: baselineHash }
    };
  }

  async function discover({ requestedBy = 'admin' } = {}) {
    const catalog = await fetchCatalog();
    const opened = await repository.createBatch({ providerAccountId, requestedBy,
      baselineHash: catalog.baselineHash, baselineWatermark: catalog.baselineWatermark,
      baseline: catalog.baseline });
    if (!opened.created) return { batch: opened.batch, created: false,
      activeBatch: repository.activeBatchStatuses?.includes(opened.batch?.status) === true };
    const batchId = opened.batch.id;
    let existing = 0;
    let discovered = 0;
    let duplicates = 0;
    const existingIds = await repository.findExistingExternalIds(
      providerAccountId, catalog.records.map((item) => item.externalCardId)
    );
    for (const record of catalog.records) {
      if (existingIds.has(record.externalCardId)) { existing += 1; continue; }
      try {
        const result = await repository.addDiscovery({ batchId, providerAccountId,
          externalCardId: record.externalCardId, details: { listWatermark: record.watermark } });
        if (result.kind === 'existing') existing += 1;
        else if (result.kind === 'discovered') discovered += 1;
        else duplicates += 1;
      } catch (error) {
        // A malformed or concurrently changed card is isolated without losing the batch.
        duplicates += 1;
      }
    }
    await repository.setBatchStatus(batchId, 'VALIDATING');
    const batch = await repository.refreshBatchStats(batchId);
    return { created: true, batch, existing, discovered, duplicates,
      providerTotal: catalog.records.length };
  }

  function materializeCard(mapped, validation) {
    const credentials = mapped.credentials;
    const normalizedPan = credentials?.cardNumber ? String(credentials.cardNumber).replace(/\s+/g, '') : null;
    return {
      inventoryStatus: validation.readiness,
      cardTypeId: String(mapped.cardTypeId),
      last4: normalizedPan?.slice(-4) || null,
      status: String(mapped.status || '').toLowerCase(),
      fundedAmount: mapped.fundedAmount == null ? null : String(mapped.fundedAmount),
      currentBalance: mapped.currentBalance == null ? null : String(mapped.currentBalance),
      currency: String(mapped.currency || 'USD').toUpperCase(),
      credentialsCiphertext: credentials ? encryptSecret(JSON.stringify(credentials), encryptionKey) : null,
      cardNumberCiphertext: normalizedPan ? encryptSecret(normalizedPan, encryptionKey) : null,
      panHmac: normalizedPan && panHmacKey
        ? crypto.createHmac('sha256', panHmacKey).update(normalizedPan).digest('hex') : null,
      syncTier: validation.readiness === 'AVAILABLE' ? 'AVAILABLE'
        : validation.readiness === 'PROVISIONING' ? 'PROVISIONING' : 'ARCHIVED'
    };
  }

  async function readAndValidate(discovery) {
    const envelope = await provider.card(discovery.externalCardId);
    const rawMapped = await mapCardDetail(envelope, { externalCardId: discovery.externalCardId,
      providerAccountId });
    const mapped = resolveMappedCardType(rawMapped, validationRules);
    mapped.externalCardId = String(mapped.externalCardId || discovery.externalCardId);
    if (mapped.externalCardId !== discovery.externalCardId) {
      throw Object.assign(new Error('Provider detail returned a different external card ID'),
        { code: 'CARD_IDENTITY_MISMATCH' });
    }
    const validation = validateMappedCard(mapped, validationRules, assumeDedicatedAccount);
    const snapshotHash = stableCardSnapshotHash(cardSnapshot(mapped));
    return { mapped, validation, snapshotHash, details: sanitizedDetails(mapped, validation) };
  }

  async function validateBatch(batchId, { limit = 5000 } = {}) {
    const discoveries = await repository.listDiscoveries(batchId,
      { statuses: ['QUARANTINED'], limit });
    const result = { checked: 0, accepted: 0, pending: 0, reviewRequired: 0, failed: 0, existing: 0 };
    for (const discovery of discoveries) {
      result.checked += 1;
      try {
        const read = await readAndValidate(discovery);
        const recorded = await repository.recordValidationSnapshot(discovery.id, {
          snapshotHash: read.snapshotHash, details: read.details,
          rulesPassed: read.validation.rulesPassed,
          ownershipCertain: read.validation.ownershipCertain
        });
        if (!recorded.stable) { result.pending += 1; continue; }
        if (!read.validation.rulesPassed || !read.validation.ownershipCertain) {
          result.reviewRequired += 1;
          continue;
        }
        const accepted = await repository.acceptDiscovery(discovery.id,
          materializeCard(read.mapped, read.validation));
        result[accepted.kind === 'accepted' ? 'accepted' : 'existing'] += 1;
      } catch (error) {
        const failure = await repository.markDiscoveryFailed(discovery.id,
          error?.code || 'CARD_READ_FAILED', error?.message || 'Card read failed');
        result[failure?.terminal === false ? 'pending' : 'failed'] += 1;
      }
    }
    result.batch = await repository.finalizeBatchIfSettled(batchId);
    return result;
  }

  async function acceptDiscoveries({ batchId, discoveryIds }) {
    const ids = [...new Set((discoveryIds || []).map(String))];
    const result = { accepted: 0, existing: 0, rejected: 0, failures: [] };
    for (const id of ids) {
      try {
        const discovery = await repository.getDiscovery(id);
        if (!discovery || discovery.intakeBatchId !== batchId) {
          throw Object.assign(new Error('Discovery does not belong to the batch'), { code: 'DISCOVERY_BATCH_MISMATCH' });
        }
        if (typeof getOperationalOverride === 'function') {
          const override = await getOperationalOverride({
            providerAccountId: discovery.providerAccountId,
            externalCardId: discovery.externalCardId
          });
          const policy = String(override?.allocationPolicy || '').toUpperCase();
          const product = String(override?.productCode || '').toLowerCase();
          if (policy === 'RETIRED' || (policy === 'PRODUCT_ONLY' && product !== 'plus')) {
            throw Object.assign(new Error('Card is blocked by an operator allocation override'), {
              code: 'CARD_OPERATIONAL_OVERRIDE_BLOCKED'
            });
          }
        }
        const read = await readAndValidate(discovery);
        if (read.snapshotHash !== discovery.secondSnapshotHash || !read.validation.rulesPassed) {
          throw Object.assign(new Error('Card changed or no longer passes technical validation'),
            { code: 'CARD_VALIDATION_CHANGED' });
        }
        const accepted = await repository.acceptDiscovery(id,
          materializeCard(read.mapped, read.validation), { manual: true });
        result[accepted.kind === 'accepted' ? 'accepted' : 'existing'] += 1;
      } catch (error) {
        result.rejected += 1;
        result.failures.push({ discoveryId: id, code: error?.code || 'CARD_ACCEPT_FAILED' });
      }
    }
    result.batch = await repository.finalizeBatchIfSettled(batchId);
    return result;
  }

  return {
    fetchCatalog,
    discover,
    startIntake: discover,
    validateBatch,
    acceptDiscoveries,
    acceptBatch: acceptDiscoveries
  };
}
