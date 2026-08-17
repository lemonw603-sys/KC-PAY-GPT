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

const profileDataSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  balance: z.string(),
  currency: z.string(),
  activeCards: z.number(),
  levelName: z.string(),
  createdAt: z.string()
}).passthrough();

const balanceDataSchema = z.object({
  balance: z.string(),
  currency: z.string(),
  exchangeRate: z.string()
}).passthrough();

const cardTypeSchema = z.object({
  id: z.number(),
  cardType: z.string(),
  cardCountry: z.string(),
  binPrefix: z.string(),
  baseCardFeeUsdt: z.string(),
  effectiveCardFeeUsdt: z.string(),
  feeRate: z.string(),
  effectiveFeeRate: z.string(),
  minServiceFeeUsdt: z.string(),
  minAmount: z.string(),
  maxAmount: z.string(),
  minRechargeAmount: z.string(),
  chargebackFee: z.string(),
  consumeRate: z.string(),
  description: z.string(),
  requireMinBalance: z.number(),
  minBalanceUsdt: z.string(),
  isFeatured: z.number(),
  allowUserInvalid: z.number()
}).passthrough();

const cardTypesDataSchema = z.object({
  cardTypes: z.array(cardTypeSchema),
  purchaseEnabled: z.boolean(),
  exchangeRate: z.number(),
  discount: z.object({ levelName: z.string() }).passthrough(),
  cardLimit: z.object({
    currentCount: z.number(),
    maxLimit: z.number(),
    remaining: z.number()
  }).passthrough()
}).passthrough();

const cardsDataSchema = z.object({
  cards: z.array(z.record(z.string(), z.unknown())),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  source: z.string()
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

function validateData(envelope, schema, operation) {
  const result = schema.safeParse(envelope.data);
  if (!result.success) {
    throw new ProviderSchemaError(`Invalid Hnskj ${operation} data`, {
      provider: 'hnskj',
      uncertain: false
    });
  }
  return { ...envelope, data: result.data };
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

  async accountProfile() {
    return validateData(await this.request('/account/profile'), profileDataSchema, 'profile');
  }

  async accountBalance() {
    return validateData(await this.request('/account/balance'), balanceDataSchema, 'balance');
  }

  async cardTypes() {
    return validateData(await this.request('/card-types'), cardTypesDataSchema, 'card-types');
  }

  async cards({ status, page = 1, pageSize = 50 } = {}) {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) query.set('status', String(status));
    return validateData(
      await this.request(`/cards?${query}`),
      cardsDataSchema,
      'cards list'
    );
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
