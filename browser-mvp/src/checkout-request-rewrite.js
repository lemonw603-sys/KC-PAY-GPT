import { ContractError } from './contracts.js';

const CHECKOUT_PATH = '/backend-api/payments/checkout';
const PRICING_PREFIX = '/backend-api/checkout_pricing_config/configs/';

function parsedUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function parseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function officialHeaderShape(headers) {
  return {
    bearerHeaderPresent: typeof headers.authorization === 'string' && headers.authorization.startsWith('Bearer '),
    sentinelHeaderPresent: typeof headers['openai-sentinel-token'] === 'string' && headers['openai-sentinel-token'].length > 0,
    deviceHeaderPresent: typeof headers['oai-device-id'] === 'string' && headers['oai-device-id'].length > 0,
    targetPathHeaderPresent: typeof headers['x-openai-target-path'] === 'string' && headers['x-openai-target-path'].length > 0,
    targetRouteHeaderPresent: typeof headers['x-openai-target-route'] === 'string' && headers['x-openai-target-route'].length > 0,
  };
}

/**
 * Select an alternate official pricing configuration before ChatGPT builds
 * and signs the Checkout request. The Checkout POST itself is never changed:
 * it is only inspected, bounded to one request, and allowed when the official
 * frontend produced the requested country/currency with its complete headers.
 */
export async function installOfficialPricingRegionSelection(page, {
  sourceCountry = 'US', country, currency, maxUpstreamCheckoutRequests = 1,
}) {
  if (!page || typeof page.route !== 'function') throw new TypeError('page is required');
  if (!/^[A-Z]{2}$/.test(sourceCountry) || !/^[A-Z]{2}$/.test(String(country || ''))
    || !/^[A-Z]{3}$/.test(String(currency || ''))) {
    throw new ContractError('Checkout pricing region is invalid');
  }
  if (maxUpstreamCheckoutRequests !== 1) {
    throw new ContractError('exactly one upstream Checkout request is allowed');
  }

  const state = {
    pricingRequestsRewritten: 0,
    checkoutRequestsIntercepted: 0,
    upstreamCheckoutRequests: 0,
    checkoutRequestsAborted: 0,
    selectedCountry: country,
    selectedCurrency: currency,
    officialHeaders: null,
  };
  const pricingPattern = '**/backend-api/checkout_pricing_config/configs/*';
  const checkoutPattern = '**/backend-api/payments/checkout';
  const pricingHandler = async (route) => {
    const request = route.request();
    const url = parsedUrl(request.url());
    if (request.method() !== 'GET' || !url || url.pathname !== `${PRICING_PREFIX}${sourceCountry}`) {
      await route.continue();
      return;
    }
    url.pathname = `${PRICING_PREFIX}${country}`;
    state.pricingRequestsRewritten += 1;
    await route.continue({ url: url.toString() });
  };
  const checkoutHandler = async (route) => {
    const request = route.request();
    const url = parsedUrl(request.url());
    if (request.method() !== 'POST' || !url || url.pathname !== CHECKOUT_PATH) {
      await route.continue();
      return;
    }
    state.checkoutRequestsIntercepted += 1;
    const body = parseJsonObject(request.postData());
    const headers = officialHeaderShape(request.headers());
    state.officialHeaders = headers;
    const headersComplete = Object.values(headers).every(Boolean);
    const bodyMatches = body?.plan_name === 'chatgptplusplan' && body?.checkout_ui_mode === 'custom'
      && body?.billing_details?.country === country && body?.billing_details?.currency === currency;
    if (state.upstreamCheckoutRequests >= maxUpstreamCheckoutRequests || !headersComplete || !bodyMatches) {
      state.checkoutRequestsAborted += 1;
      await route.abort('blockedbyclient');
      return;
    }
    state.upstreamCheckoutRequests += 1;
    await route.continue();
  };
  await page.route(pricingPattern, pricingHandler);
  await page.route(checkoutPattern, checkoutHandler);
  return {
    snapshot: () => structuredClone(state),
    dispose: async () => {
      await page.unroute(checkoutPattern, checkoutHandler);
      await page.unroute(pricingPattern, pricingHandler);
    },
  };
}
