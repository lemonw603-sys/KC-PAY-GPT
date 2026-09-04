const CHECKOUT_CREATE_PATH = '/backend-api/payments/checkout';
const CHECKOUT_SNAPSHOT_PATH = '/backend-api/payments/checkout/snapshot';
const PRICING_CONFIG_PREFIX = '/backend-api/checkout_pricing_config/';

function safeUrlShape(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return { origin: url.origin, path: url.pathname };
  } catch {
    return { origin: null, path: null };
  }
}

function redactStripePath(path) {
  return String(path || '')
    .replace(/(\/v1\/payment_pages\/)[^/]+/i, '$1:checkout')
    .replace(/\b(?:cs_(?:live|test)_|oaics_)[A-Za-z0-9_-]+\b/g, ':checkout');
}

function safeString(value, { max = 80, pattern = /^[\w .%+-]+$/u } = {}) {
  if (typeof value !== 'string' || value.length > max || !pattern.test(value)) return null;
  return value;
}

function safeCountry(value) {
  const normalized = safeString(value, { max: 2, pattern: /^[A-Za-z]{2}$/ });
  return normalized?.toUpperCase() || null;
}

function safeCurrency(value) {
  const normalized = safeString(value, { max: 3, pattern: /^[A-Za-z]{3}$/ });
  return normalized?.toUpperCase() || null;
}

function safeMode(value) {
  return ['custom', 'hosted'].includes(value) ? value : null;
}

function safePlan(value) {
  return safeString(value, { max: 64, pattern: /^[A-Za-z0-9_-]+$/ });
}

function parseJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function sanitizeCheckoutCreateRequest(rawUrl, method, postData) {
  const url = safeUrlShape(rawUrl);
  if (url.path !== CHECKOUT_CREATE_PATH || String(method).toUpperCase() !== 'POST') return null;
  const body = parseJsonObject(postData);
  return {
    kind: 'checkout-create-request',
    method: 'POST',
    ...url,
    bodyFormat: body ? 'json' : postData ? 'non-json' : 'empty',
    entryPoint: safeString(body?.entry_point, { max: 64, pattern: /^[A-Za-z0-9_-]+$/ }),
    planName: safePlan(body?.plan_name),
    checkoutUiMode: safeMode(body?.checkout_ui_mode),
    billingCountry: safeCountry(body?.billing_details?.country),
    billingCurrency: safeCurrency(body?.billing_details?.currency),
  };
}

export function sanitizeCheckoutSnapshotRequest(rawUrl, method, postData) {
  const url = safeUrlShape(rawUrl);
  if (url.path !== CHECKOUT_SNAPSHOT_PATH || String(method).toUpperCase() !== 'POST') return null;
  const body = parseJsonObject(postData);
  const address = body?.snapshot?.billing_address?.address;
  return {
    kind: 'checkout-snapshot-request', method: 'POST', ...url,
    bodyFormat: body ? 'json' : postData ? 'non-json' : 'empty',
    billingCountry: safeCountry(address?.country),
    billingState: safeCountry(address?.state),
    namePresent: typeof body?.snapshot?.billing_address?.name === 'string' && body.snapshot.billing_address.name.length > 0,
    streetPresent: typeof address?.line1 === 'string' && address.line1.length > 0,
    cityPresent: typeof address?.city === 'string' && address.city.length > 0,
    zipPresent: typeof address?.postal_code === 'string' && address.postal_code.length > 0,
  };
}

function findWhitelistedScalar(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key) && ['string', 'number', 'boolean'].includes(typeof child)) return child;
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findWhitelistedScalar(child, keys, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

function extractPricingSignals(value, output = {}, prefix = '', depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5 || Object.keys(output).length >= 40) return output;
  for (const [key, child] of Object.entries(value)) {
    if (Object.keys(output).length >= 40) break;
    const path = prefix ? `${prefix}.${key}` : key;
    const pricingKey = /(?:^|_)(?:country|currency|price|amount|tax|vat|psp|inclusive|exclusive)(?:_|$)/i.test(key);
    const forbiddenKey = /secret|token|authorization|cookie|session|customer|email|address|card|url|\bid\b/i.test(key);
    if (pricingKey && !forbiddenKey && ['string', 'number', 'boolean'].includes(typeof child)) {
      const safeValue = typeof child === 'string'
        ? safeString(child, { max: 80, pattern: /^[A-Za-z0-9 _.,%+-]+$/ })
        : Number.isFinite(child) || typeof child === 'boolean' ? child : null;
      if (safeValue !== null) output[path] = safeValue;
    } else if (!forbiddenKey && child && typeof child === 'object') {
      extractPricingSignals(child, output, path, depth + 1);
    }
  }
  return output;
}

export function sanitizeCheckoutCreateResponse(rawUrl, status, bodyText) {
  const url = safeUrlShape(rawUrl);
  if (url.path !== CHECKOUT_CREATE_PATH) return null;
  const body = parseJsonObject(bodyText);
  return {
    kind: 'checkout-create-response',
    ...url,
    status: Number.isInteger(status) ? status : null,
    bodyFormat: body ? 'json' : bodyText ? 'non-json' : 'empty',
    checkoutUiMode: safeMode(findWhitelistedScalar(body, new Set(['checkout_ui_mode', 'checkoutUiMode']))),
    billingCountry: safeCountry(findWhitelistedScalar(body, new Set(['billing_country', 'billingCountry', 'country']))),
    billingCurrency: safeCurrency(findWhitelistedScalar(body, new Set(['billing_currency', 'billingCurrency', 'currency']))),
    processorEntity: safeString(findWhitelistedScalar(body, new Set(['processor_entity', 'processorEntity'])), {
      max: 80,
      pattern: /^[A-Za-z0-9 _.-]+$/,
    }),
  };
}

export function sanitizeObservedRequest(rawUrl, method, postData) {
  const checkout = sanitizeCheckoutCreateRequest(rawUrl, method, postData);
  if (checkout) return checkout;
  const snapshot = sanitizeCheckoutSnapshotRequest(rawUrl, method, postData);
  if (snapshot) return snapshot;
  const url = safeUrlShape(rawUrl);
  if (url.path?.startsWith(PRICING_CONFIG_PREFIX)) {
    return { kind: 'pricing-config-request', method: String(method).toUpperCase(), ...url };
  }
  if (url.origin?.includes('stripe.com')) {
    return { kind: 'stripe-request', method: String(method).toUpperCase(), ...url, path: redactStripePath(url.path) };
  }
  return null;
}

export function sanitizeObservedResponse(rawUrl, status, bodyText = null) {
  const checkout = sanitizeCheckoutCreateResponse(rawUrl, status, bodyText);
  if (checkout) return checkout;
  const url = safeUrlShape(rawUrl);
  if (url.path === CHECKOUT_SNAPSHOT_PATH) {
    const body = parseJsonObject(bodyText);
    return {
      kind: 'checkout-snapshot-response', status, ...url,
      bodyFormat: body ? 'json' : bodyText ? 'non-json' : 'not-captured',
      pricingSignals: body ? extractPricingSignals(body) : {},
    };
  }
  if (url.path?.startsWith(PRICING_CONFIG_PREFIX)) {
    const body = parseJsonObject(bodyText);
    return {
      kind: 'pricing-config-response', status, ...url,
      bodyFormat: body ? 'json' : bodyText ? 'non-json' : 'not-captured',
      pricingSignals: body ? extractPricingSignals(body) : {},
    };
  }
  if (url.origin?.includes('stripe.com')) {
    return { kind: 'stripe-response', status, ...url, path: redactStripePath(url.path) };
  }
  return null;
}

export function assertEvidenceIsSecretFree(evidence, forbiddenValues = []) {
  const serialized = JSON.stringify(evidence);
  const forbiddenNames = [
    'authorization', 'cookie', 'sessiontoken', 'accesstoken', 'pan', 'cvc',
    'line1', 'postalcode', 'client_secret', 'session_id', 'checkout_session_id',
  ];
  const pending = [evidence];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const forbidden = forbiddenNames.find((name) => normalizedKey.includes(name.replace(/[^a-z0-9]/g, '')));
      if (forbidden) throw new Error(`evidence contains forbidden field: ${forbidden}`);
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  const scalarValues = [];
  const scalarPending = [evidence];
  while (scalarPending.length) {
    const value = scalarPending.pop();
    if (value && typeof value === 'object') scalarPending.push(...Object.values(value));
    else if (value !== undefined && value !== null) scalarValues.push(String(value));
  }
  for (const value of forbiddenValues.filter(Boolean).map(String)) {
    // Short secrets such as CVCs are common substrings of unrelated amounts,
    // counts and hashes. Require an exact scalar match for them; longer secret
    // material remains protected by the stricter substring scan.
    const leaked = value.length < 8 ? scalarValues.includes(value) : serialized.includes(value);
    if (leaked) throw new Error('evidence contains a forbidden value');
  }
  return true;
}
