const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 1_000_000;

export class ProviderError extends Error {
  constructor(message, {
    provider,
    kind = 'provider',
    status = null,
    businessCode = null,
    retryable = false,
    uncertain = false,
    cause = undefined
  } = {}) {
    super(message, { cause });
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.status = status;
    this.businessCode = businessCode;
    this.retryable = retryable;
    this.uncertain = uncertain;
  }
}

export class ProviderSchemaError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, kind: 'schema' });
    this.name = 'ProviderSchemaError';
  }
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 2_000) };
  }
}

export async function requestJson({
  provider,
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') {
    throw new ProviderError('fetch is unavailable', {
      provider,
      kind: 'configuration'
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let raceTimeout;
  let response;
  try {
    const request = fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    response = await Promise.race([
      request,
      new Promise((_, reject) => {
        raceTimeout = setTimeout(() => reject(new Error('request timeout')), timeoutMs);
      })
    ]);
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.message === 'request timeout';
    throw new ProviderError(timedOut ? 'Provider request timed out' : 'Provider request failed', {
      provider,
      kind: timedOut ? 'timeout' : 'transport',
      retryable: false,
      uncertain: true,
      cause: error
    });
  } finally {
    clearTimeout(timeout);
    if (raceTimeout) clearTimeout(raceTimeout);
  }

  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw new ProviderError('Provider response body could not be read', {
      provider,
      kind: 'transport',
      status: response.status,
      retryable: false,
      uncertain: true,
      cause: error
    });
  }
  if (text.length > MAX_RESPONSE_CHARS) {
    throw new ProviderSchemaError('Provider response is too large', {
      provider,
      status: response.status,
      uncertain: response.status >= 500
    });
  }

  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    body: parseBody(text)
  };
}

export function extractBusinessError(response) {
  const body = response?.body;
  return {
    code: body && typeof body === 'object' && body.code != null ? String(body.code) : null,
    message: body && typeof body === 'object' && typeof body.message === 'string'
      ? body.message.slice(0, 500)
      : `HTTP ${response?.status ?? 'unknown'}`
  };
}
