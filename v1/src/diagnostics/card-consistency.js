const ACTIVE_STATUSES = new Set(['active', 'available', 'usable', 'ready']);
const FAILED_STATUSES = new Set(['failed', 'failure', 'invalid', 'inactive', 'closed', 'cancelled', 'canceled']);

function text(value) {
  return value == null ? '' : String(value).trim();
}

function providerId(record) {
  return text(record?.id ?? record?.cardId ?? record?.card_id);
}

function providerStatus(record) {
  return text(record?.status ?? record?.cardStatus ?? record?.card_status).toLowerCase() || 'unknown';
}

function localStatus(record) {
  return text(record?.status).toLowerCase() || 'unknown';
}

function statusFamily(status) {
  if (ACTIVE_STATUSES.has(status)) return 'active';
  if (FAILED_STATUSES.has(status)) return 'failed';
  return 'other';
}

function finding(code, severity, details = {}) {
  return { code, severity, ...details };
}

export function buildCardConsistencyReport({ providerCards, localCards, operationalOverrides = [] }) {
  if (!Array.isArray(providerCards) || !Array.isArray(localCards)) {
    throw new TypeError('providerCards and localCards must be arrays');
  }

  const findings = [];
  const provider = new Map();
  const local = new Map();
  const overrides = new Map((Array.isArray(operationalOverrides) ? operationalOverrides : [])
    .map((item) => [text(item?.externalCardId ?? item?.providerCardId), item]));
  let suppressedOverrideCount = 0;

  for (const record of providerCards) {
    const id = providerId(record);
    if (!id) {
      findings.push(finding('PROVIDER_CARD_WITHOUT_ID', 'critical'));
      continue;
    }
    if (provider.has(id)) {
      findings.push(finding('DUPLICATE_PROVIDER_CARD_ID', 'critical', { providerCardId: id }));
      continue;
    }
    provider.set(id, { id, status: providerStatus(record) });
  }

  for (const record of localCards) {
    const id = text(record?.provider_card_id ?? record?.providerCardId);
    if (!id) {
      findings.push(finding('LOCAL_CARD_WITHOUT_PROVIDER_ID', 'critical'));
      continue;
    }
    if (local.has(id)) {
      findings.push(finding('DUPLICATE_LOCAL_PROVIDER_CARD_ID', 'critical', { providerCardId: id }));
      continue;
    }
    local.set(id, { id, status: localStatus(record) });
  }

  const unsuppressedProviderCount = [...provider.values()]
    .filter((card) => !['RETIRED', 'PRODUCT_ONLY'].includes(
      text(overrides.get(card.id)?.allocationPolicy ?? overrides.get(card.id)?.allocation_policy).toUpperCase()
    )).length;
  if (unsuppressedProviderCount > 0 && local.size === 0) {
    findings.push(finding('LOCAL_CARD_CATALOG_EMPTY', 'critical', {
      providerCardCount: provider.size
    }));
  }

  for (const card of provider.values()) {
    const localCard = local.get(card.id);
    if (!localCard) {
      const override = overrides.get(card.id);
      const policy = text(override?.allocationPolicy ?? override?.allocation_policy).toUpperCase();
      if (policy === 'RETIRED' || policy === 'PRODUCT_ONLY') {
        suppressedOverrideCount += 1;
        continue;
      }
      findings.push(finding('UNMAPPED_PROVIDER_CARD',
        statusFamily(card.status) === 'active' ? 'critical' : 'warning', {
          providerCardId: card.id,
          providerStatus: card.status
        }));
      continue;
    }
    const upstreamFamily = statusFamily(card.status);
    const localFamily = statusFamily(localCard.status);
    if (upstreamFamily !== 'other' && localFamily !== 'other' && upstreamFamily !== localFamily) {
      findings.push(finding('CARD_STATUS_CONFLICT', 'critical', {
        providerCardId: card.id,
        providerStatus: card.status,
        localStatus: localCard.status
      }));
    }
  }

  for (const card of local.values()) {
    if (!provider.has(card.id)) {
      findings.push(finding('LOCAL_CARD_MISSING_UPSTREAM', 'critical', {
        providerCardId: card.id,
        localStatus: card.status
      }));
    }
  }

  const criticalCount = findings.filter((item) => item.severity === 'critical').length;
  const warningCount = findings.filter((item) => item.severity === 'warning').length;
  const result = {
    ok: findings.length === 0,
    providerCardCount: provider.size,
    localCardCount: local.size,
    criticalCount,
    warningCount,
    findings
  };
  if (suppressedOverrideCount > 0) result.suppressedOverrideCount = suppressedOverrideCount;
  return result;
}
