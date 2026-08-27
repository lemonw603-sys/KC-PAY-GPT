import { z } from 'zod';
import {
  ProviderError,
  ProviderSchemaError,
  extractBusinessError,
  requestJson
} from './http-client.js';

const envelopeSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().nullable()
}).passthrough();

const createDataSchema = z.object({
  order_no: z.string().min(1),
  card_key: z.string().min(1),
  status: z.enum(['pending', 'processing']).optional(),
  order_type: z.literal('direct').optional(),
  plan_type: z.string().optional()
}).passthrough();

const statusDataSchema = z.object({
  order_no: z.string().optional(),
  card_key: z.string().nullable().optional(),
  plan_type: z.string().optional(),
  status: z.enum(['pending', 'processing', 'success', 'failed']),
  failure_reason: z.string().nullable().optional(),
  payment_result: z.unknown().nullable().optional(),
  payment_amount: z.union([z.string(), z.number()]).nullable().optional(),
  payment_currency: z.string().nullable().optional(),
  token: z.record(z.string(), z.unknown()).nullable().optional(),
  is_subscription_cancelled: z.union([z.literal(0), z.literal(1)]).optional(),
  finished_at: z.string().nullable().optional(),
  updated_at: z.string().optional()
}).passthrough();

function normalizePaymentAmount(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  return /^\d+(?:\.\d{1,6})?$/.test(text) ? text : undefined;
}

function normalizePaymentCurrency(value) {
  if (value == null || value === '') return null;
  const currency = String(value).trim().toUpperCase();
  return /^[A-Z]{3,8}$/.test(currency) ? currency : undefined;
}

function normalizePaymentDetails(amountValue, currencyValue) {
  const amount = normalizePaymentAmount(amountValue);
  const currency = normalizePaymentCurrency(currencyValue);
  const bothMissing = amount === null && currency === null;
  if (bothMissing) return { paymentAmount: null, paymentCurrency: null, paymentDetailsStatus: 'missing' };
  const bothValid = typeof amount === 'string' && typeof currency === 'string';
  if (bothValid) return { paymentAmount: amount, paymentCurrency: currency, paymentDetailsStatus: 'valid' };
  return { paymentAmount: null, paymentCurrency: null, paymentDetailsStatus: 'invalid' };
}

function normalizeBaseUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  if (!url) throw new Error('Zzshu recharge API base URL is required');
  return url;
}

/**
 * Build the direct-order request without performing network I/O.
 * This is intentionally separate from createDirectOrder so pre-payment
 * validation cannot accidentally submit a charge.
 */
export function buildDirectOrderRequest({ cardNumber, expMonth, expYear, cvv, token, planType = 'plus' }) {
  return {
    path: '/third-party/orders/direct',
    method: 'POST',
    body: {
      orderType: 'direct',
      cardNumber: String(cardNumber),
      expMonth: Number(expMonth),
      expYear: Number(expYear),
      cvv: String(cvv),
      token,
      planType: String(planType)
    }
  };
}

function parseEnvelope(response, { uncertainOnSchema = false } = {}) {
  const result = envelopeSchema.safeParse(response.body);
  if (!result.success) {
    throw new ProviderSchemaError('Invalid Zzshu response envelope', {
      provider: 'zzshu',
      status: response.status,
      uncertain: uncertainOnSchema || response.status >= 500
    });
  }
  return result.data;
}

function throwApiError(response, envelope, {
  operation,
  allowCapacityRetry = false,
  readOnly = false
}) {
  const error = extractBusinessError(response);
  const code = error.code || String(envelope?.code ?? '');
  const capacity = allowCapacityRetry && response.status === 429 && code === '42902';
  const maintenance = response.status === 403 && code === '40305';
  throw new ProviderError(`Zzshu ${operation} error: ${error.message}`, {
    provider: 'zzshu',
    status: response.status,
    businessCode: code || null,
    // 40305 is a creation-time maintenance gate: no order is created,
    // so retrying later is safe and required by the upstream contract.
    retryable: capacity || maintenance || (readOnly && response.status >= 500),
    uncertain: readOnly ? false : (response.status >= 500 || response.status === 0)
  });
}

function safePaymentResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    success: typeof value.success === 'boolean' ? value.success : undefined,
    status: typeof value.status === 'string' ? value.status : undefined
  };
}

function normalizeStatus(value) {
  const result = statusDataSchema.safeParse(value);
  if (!result.success) {
    throw new ProviderSchemaError('Invalid Zzshu order status payload', {
      provider: 'zzshu',
      uncertain: false
    });
  }
  const data = result.data;
  const payment = normalizePaymentDetails(data.payment_amount, data.payment_currency);
  return {
    orderNo: data.order_no || null,
    cardKey: data.card_key || null,
    planType: data.plan_type || null,
    status: data.status,
    failureReason: data.failure_reason ?? null,
    paymentResult: safePaymentResult(data.payment_result),
    ...payment,
    isSubscriptionCancelled: data.is_subscription_cancelled ?? null,
    finishedAt: data.finished_at ?? null,
    updatedAt: data.updated_at ?? null
  };
}

function normalizeWorkflowStatus(value) {
  const safe = normalizeStatus(value);
  const parsed = statusDataSchema.safeParse(value);
  const token = parsed.success ? parsed.data.token : null;
  const complete = token
    && typeof token.accessToken === 'string' && token.accessToken.length > 0
    && typeof token.sessionToken === 'string' && token.sessionToken.length > 0
    && typeof token.expires === 'string' && token.expires.length > 0
    && token.user && typeof token.user === 'object' && typeof token.user.id === 'string'
    && token.account && typeof token.account === 'object';
  return {
    ...safe,
    latestSession: complete ? token : null
  };
}

export class ZzshuRechargeProvider {
  constructor({ baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 60_000 }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = String(apiKey || '').trim();
    if (!this.apiKey) throw new Error('Zzshu recharge API key is required');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { headers = {}, readOnly = false, ...options } = {}) {
    try {
      return await requestJson({
        provider: 'zzshu',
        url: `${this.baseUrl}${path}`,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        ...options,
        headers: { 'X-API-Key': this.apiKey, ...headers }
      });
    } catch (error) {
      if (readOnly && error instanceof ProviderError && ['timeout', 'transport'].includes(error.kind)) {
        error.retryable = true;
        error.uncertain = false;
      }
      throw error;
    }
  }

  async checkConnection() {
    const response = await this.request('/third-party/user', { readOnly: true });
    const envelope = parseEnvelope(response);
    if (!response.ok || envelope.code !== 0) {
      throwApiError(response, envelope, { operation: 'connection check', readOnly: true });
    }
    return { ok: true };
  }

  async createDirectOrder({ cardNumber, expMonth, expYear, cvv, token, planType = 'plus' }) {
    const request = buildDirectOrderRequest({ cardNumber, expMonth, expYear, cvv, token, planType });
    const response = await this.request('/third-party/orders/direct', {
      method: 'POST',
      body: request.body
    });
    const envelope = parseEnvelope(response, {
      uncertainOnSchema: response.ok || response.status >= 500
    });
    if (!response.ok || envelope.code !== 0) {
      throwApiError(response, envelope, {
        operation: 'create',
        allowCapacityRetry: true,
        readOnly: false
      });
    }
    const data = createDataSchema.safeParse(envelope.data);
    if (!data.success) {
      throw new ProviderSchemaError('Zzshu create response lacks order_no/card_key', {
        provider: 'zzshu',
        status: response.status,
        uncertain: true
      });
    }
    return {
      orderNo: data.data.order_no,
      cardKey: data.data.card_key,
      status: data.data.status || 'processing',
      planType: data.data.plan_type || planType
    };
  }

  async queryStatusInternal(cardKey, includeSession) {
    const key = String(cardKey || '').trim();
    if (!key || key.length > 128) throw new Error('Zzshu cardKey must contain 1-128 characters');
    const response = await this.request('/third-party/orders/status', {
      method: 'POST',
      readOnly: true,
      body: { cardKey: key }
    });
    const envelope = parseEnvelope(response);
    if (!response.ok || envelope.code !== 0) {
      const error = extractBusinessError(response);
      throw new ProviderError(`Zzshu status error: ${error.message}`, {
        provider: 'zzshu',
        status: response.status,
        businessCode: error.code || String(envelope.code),
        retryable: response.status >= 500,
        uncertain: false
      });
    }
    const normalize = includeSession ? normalizeWorkflowStatus : normalizeStatus;
    const data = Array.isArray(envelope.data)
      ? envelope.data.map(normalize)
      : normalize(envelope.data);
    return data;
  }

  queryStatus(cardKey) {
    return this.queryStatusInternal(cardKey, false);
  }

  queryStatusWithSession(cardKey) {
    return this.queryStatusInternal(cardKey, true);
  }
}
