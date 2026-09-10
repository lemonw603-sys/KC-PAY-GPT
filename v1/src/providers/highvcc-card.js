// Backup card platform A (highvcc.com / 舜捷跨境): a live, synchronous JSON API, not a
// browser-automation target. There is no service-account credential — the "token" is a
// personal login session's Bearer token (2h inactivity expiry), so this provider never logs
// in itself; it only ever uses whatever token the caller hands it via getAccessToken().
//
// This mirrors the standalone local CLI at browser-mvp/scripts/highvcc-card.mjs (kept as-is
// for ad-hoc local use). The encoding/error-classification helpers below are intentionally a
// small, independent, pure copy — not an import of a scripts/ file into src/ — so this
// provider has no runtime dependency on the browser-mvp package.
//
// Confirmed against the live API 2026-09-10: the cost/open endpoints take
// application/x-www-form-urlencoded bodies, not JSON; a JSON body is read as an effectively
// empty body server-side and comes back as an unrelated error instead of anything about
// encoding. card.balance / cost amounts are in integer USD cents.

export class HighvccProviderError extends Error {
  constructor(message, code, providerMessage = null) {
    super(message);
    this.name = 'HighvccProviderError';
    this.code = code;
    // The platform's own business-reason text (e.g. "美元账户可用余额不足"), kept separate
    // from `message` (which also carries the method/path/HTTP-code for logs) so a caller can
    // show the operator the clean reason instead of a technical string.
    this.providerMessage = providerMessage;
  }
}

export function cents(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n) || n <= 0) {
    throw new HighvccProviderError(`amount must be a positive number of US dollars, got ${JSON.stringify(dollars)}`, 'HIGHVCC_INVALID_AMOUNT');
  }
  return String(Math.round(n * 100));
}

export function buildRequestInit(body, form) {
  if (!body) return { requestBody: undefined, contentType: undefined };
  if (form) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) if (v != null && v !== '') params.set(k, String(v));
    return { requestBody: params.toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' };
  }
  return { requestBody: JSON.stringify(body), contentType: 'application/json' };
}

export function isAuthTrouble(status, json) {
  return status === 401 || status === 403
    || Boolean(json && (json.code === 401 || /登录|过期|token/i.test(String(json.msg || ''))));
}

const HOLDER_NAME_RE = /^[A-Za-z][A-Za-z' -]{0,30}$/;

export function createHighvccCardProvider({ getAccessToken, fetchImpl = fetch, baseUrl = 'https://www.highvcc.com' } = {}) {
  if (typeof getAccessToken !== 'function') throw new TypeError('getAccessToken is required');
  const BASE = String(baseUrl).replace(/\/$/, '');

  async function api(method, path, { body = null, form = false } = {}) {
    const token = await getAccessToken();
    if (!token) throw new HighvccProviderError('no highvcc access token is configured', 'HIGHVCC_TOKEN_MISSING');
    const { requestBody, contentType } = buildRequestInit(body, form);
    const response = await fetchImpl(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(contentType ? { 'Content-Type': contentType } : {}),
        'User-Agent': 'Mozilla/5.0',
      },
      body: requestBody,
    });
    let json = null;
    try { json = await response.json(); } catch { json = null; }
    if (isAuthTrouble(response.status, json)) {
      throw new HighvccProviderError(
        `highvcc token expired or invalid (HTTP ${response.status}${json?.msg ? ` ${json.msg}` : ''})`,
        'HIGHVCC_TOKEN_EXPIRED'
      );
    }
    if (!response.ok) {
      throw new HighvccProviderError(`${method} ${path} -> HTTP ${response.status}${json?.msg ? ` ${json.msg}` : ''}`, 'HIGHVCC_HTTP_ERROR', json?.msg || null);
    }
    if (json?.code !== 200) {
      throw new HighvccProviderError(`${method} ${path} -> code ${json?.code} ${json?.msg || ''}`, 'HIGHVCC_API_ERROR', json?.msg || null);
    }
    return json;
  }

  async function cost({ vid, amount }) {
    const r = await api('POST', '/api/card/openCardCost', { body: { vid, amount: cents(amount), payUnit: 'USD' }, form: true });
    return r.data;
  }

  async function autoCardHolderName() {
    const r = await api('GET', '/api/card/autoCard');
    const first = String(r.data?.firstName || '').trim();
    const last = String(r.data?.lastName || '').trim();
    if (!HOLDER_NAME_RE.test(first) || !HOLDER_NAME_RE.test(last)) {
      throw new HighvccProviderError('platform autoCard returned no usable holder name', 'HIGHVCC_HOLDER_NAME_UNAVAILABLE');
    }
    return { first, last };
  }

  async function detail(cardId) {
    const r = await api('POST', '/api/card/detail', { body: { cardId }, form: true });
    return r.data;
  }

  // Opens exactly one card and returns its full detail. This never decides whether to spend
  // money — the caller (the admin service) owns the confirmation-phrase and audit discipline
  // and only calls this once that has already been satisfied.
  async function open({ vid, amount, firstName, lastName, address }) {
    if (!address?.line1 || !address?.city || !address?.state || !address?.postalCode) {
      throw new HighvccProviderError('a complete billing address is required to open a card', 'HIGHVCC_ADDRESS_INCOMPLETE');
    }
    const holder = (firstName && lastName) ? { first: firstName, last: lastName } : await autoCardHolderName();
    const feeInfo = await cost({ vid, amount });
    const payload = {
      vid, firstName: holder.first, lastName: holder.last,
      street: address.line1, city: address.city, state: address.state, zipCode: address.postalCode,
      unit: 'USD', rechargeAmount: cents(amount), tags: '', gid: null, couponId: null,
    };
    const r = await api('POST', '/api/card/newCard', { body: payload, form: true });
    const cardId = typeof r.data === 'string' ? r.data : r.data?.cardId;
    if (!cardId) throw new HighvccProviderError('newCard did not return a card id', 'HIGHVCC_OPEN_NO_CARD_ID');
    const openedDetail = await detail(cardId);
    return { feeInfo, holder, requestedAddress: address, cardId, detail: openedDetail };
  }

  return { cost, autoCardHolderName, detail, open };
}
