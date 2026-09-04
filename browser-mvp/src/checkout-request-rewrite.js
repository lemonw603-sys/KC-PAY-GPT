import { ContractError } from './contracts.js';

const CHECKOUT_PATH = '/backend-api/payments/checkout';

function isCheckoutUrl(rawUrl) {
  try {
    return new URL(rawUrl).pathname === CHECKOUT_PATH;
  } catch {
    return false;
  }
}

export function rewriteOfficialCheckoutBody(postData, { country, currency }) {
  let body;
  try {
    body = JSON.parse(postData);
  } catch {
    throw new ContractError('official Checkout request body must be JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ContractError('official Checkout request body must be an object');
  }
  if (body.plan_name !== 'chatgptplusplan' || body.checkout_ui_mode !== 'custom') {
    throw new ContractError('official Checkout request contract drift');
  }
  if (!body.billing_details || typeof body.billing_details !== 'object' || Array.isArray(body.billing_details)) {
    throw new ContractError('official Checkout billing details are unavailable');
  }
  return JSON.stringify({
    ...body,
    billing_details: { ...body.billing_details, country, currency },
  });
}

/**
 * Preserve the request produced by ChatGPT's active frontend (including all
 * browser-generated anti-abuse/device headers) and change only its explicit
 * pricing country/currency. No independent Checkout API request is created.
 */
export async function installOfficialCheckoutRegionRewrite(page, { country, currency, maxUpstreamRequests = 1 }) {
  if (!page || typeof page.route !== 'function') throw new TypeError('page is required');
  if (!/^[A-Z]{2}$/.test(String(country || '')) || !/^[A-Z]{3}$/.test(String(currency || ''))) {
    throw new ContractError('Checkout region is invalid');
  }
  if (!Number.isInteger(maxUpstreamRequests) || maxUpstreamRequests !== 1) {
    throw new ContractError('exactly one upstream Checkout request is allowed');
  }

  const state = {
    interceptedRequests: 0,
    upstreamRequests: 0,
    extraRequestsAborted: 0,
    rewrittenCountry: country,
    rewrittenCurrency: currency,
    officialHeaders: null,
  };
  const pattern = '**/backend-api/payments/checkout';
  const handler = async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || !isCheckoutUrl(request.url())) {
      await route.continue();
      return;
    }
    state.interceptedRequests += 1;
    if (state.upstreamRequests >= maxUpstreamRequests) {
      state.extraRequestsAborted += 1;
      await route.abort('blockedbyclient');
      return;
    }
    const headers = request.headers();
    state.officialHeaders = {
      bearerHeaderPresent: typeof headers.authorization === 'string' && headers.authorization.startsWith('Bearer '),
      sentinelHeaderPresent: typeof headers['openai-sentinel-token'] === 'string' && headers['openai-sentinel-token'].length > 0,
      deviceHeaderPresent: typeof headers['oai-device-id'] === 'string' && headers['oai-device-id'].length > 0,
      targetPathHeaderPresent: typeof headers['x-openai-target-path'] === 'string' && headers['x-openai-target-path'].length > 0,
      targetRouteHeaderPresent: typeof headers['x-openai-target-route'] === 'string' && headers['x-openai-target-route'].length > 0,
    };
    if (!state.officialHeaders.bearerHeaderPresent || !state.officialHeaders.sentinelHeaderPresent
      || !state.officialHeaders.deviceHeaderPresent || !state.officialHeaders.targetPathHeaderPresent
      || !state.officialHeaders.targetRouteHeaderPresent) {
      state.extraRequestsAborted += 1;
      await route.abort('blockedbyclient');
      return;
    }
    const postData = rewriteOfficialCheckoutBody(request.postData(), { country, currency });
    state.upstreamRequests += 1;
    await route.continue({ postData });
  };
  await page.route(pattern, handler);
  return {
    snapshot: () => structuredClone(state),
    dispose: () => page.unroute(pattern, handler),
  };
}
