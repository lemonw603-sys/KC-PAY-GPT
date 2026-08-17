import { z } from 'zod';
import {
  ProviderError,
  ProviderSchemaError,
  extractBusinessError,
  requestJson
} from './http-client.js';

const envelopeSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data: z.unknown().optional()
}).passthrough();

function normalizeBaseUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  if (!url) throw new Error('Hnskj card API base URL is required');
  return url;
}

function assertIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (key.length < 16 || key.length > 128) {
    throw new Error('Hnskj X-Idempotency-Key must contain 16-128 characters');
  }
  return key;
}

function parseEnvelope(response, { uncertainOnSchema = false, retryableOnSchema = false } = {}) {
  const result = envelopeSchema.safeParse(response.body);
  if (!result.success) {
    throw new ProviderSchemaError('Invalid Hnskj response envelope', {
      provider: 'hnskj',
      status: response.status,
      retryable: retryableOnSchema,
      uncertain: uncertainOnSchema || response.status >= 500
    });
  }
  if (!response.ok || result.data.success !== true) {
    const error = extractBusinessError(response);
    throw new ProviderError(`Hnskj API error: ${error.message}`, {
      provider: 'hnskj',
      status: response.status,
      businessCode: error.code,
      retryable: response.status === 503,
      uncertain: response.status >= 500
    });
  }
  return result.data;
}

export class HnskjCardProvider {
  constructor({ baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 30_000 }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = String(apiKey || '').trim();
    if (!this.apiKey) throw new Error('Hnskj card API key is required');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(path, {
    headers = {},
    uncertainOnSchema = false,
    retryableOnSchema = false,
    ...options
  } = {}) {
    try {
      const response = await requestJson({
        provider: 'hnskj',
        url: `${this.baseUrl}${path}`,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        ...options,
        headers: { 'X-API-Key': this.apiKey, ...headers }
      });
      return parseEnvelope(response, { uncertainOnSchema, retryableOnSchema });
    } catch (error) {
      if (error instanceof ProviderError && ['timeout', 'transport'].includes(error.kind)) {
        const readOnly = !options.method || options.method === 'GET';
        const idempotentWrite = Boolean(headers['X-Idempotency-Key']);
        error.retryable = readOnly || idempotentWrite;
        error.uncertain = !readOnly;
      }
      throw error;
    }
  }

  accountProfile() { return this.request('/account/profile'); }

  accountBalance() { return this.request('/account/balance'); }

  cardTypes() { return this.request('/card-types'); }

  cards({ status, page = 1, pageSize = 50 } = {}) {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) query.set('status', String(status));
    return this.request(`/cards?${query}`);
  }

  card(cardId) {
    return this.request(`/cards/${encodeURIComponent(String(cardId))}`);
  }

  async purchaseCard({ cardTypeId, openCardAmount, idempotencyKey, remark }) {
    const amount = Number(openCardAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Hnskj openCardAmount must be a positive integer');
    }
    return this.request('/cards/purchase', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': assertIdempotencyKey(idempotencyKey) },
      uncertainOnSchema: true,
      retryableOnSchema: true,
      body: {
        cardTypeId,
        quantity: 1,
        openCardAmount: amount,
        ...(remark ? { remark: String(remark).slice(0, 128) } : {})
      }
    });
  }

  refreshBalance(cardId) {
    return this.request(`/cards/${encodeURIComponent(String(cardId))}/refresh-balance`, {
      method: 'POST'
    });
  }

  transactions(cardId, query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params}` : '';
    return this.request(`/cards/${encodeURIComponent(String(cardId))}/transactions${suffix}`);
  }

  withdraw(cardId, idempotencyKey) {
    return this.request(`/cards/${encodeURIComponent(String(cardId))}/withdraw`, {
      method: 'POST',
      headers: { 'X-Idempotency-Key': assertIdempotencyKey(idempotencyKey) },
      uncertainOnSchema: true,
      retryableOnSchema: true
    });
  }
}
