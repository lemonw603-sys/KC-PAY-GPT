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

// These endpoints have had field-level drift across observed responses.  We
// still require an object-shaped data payload at the provider boundary so a
// scalar/null response cannot leak into workflow code; operation-specific
// field interpretation remains in the mapper that owns the business rule.
const objectDataSchema = z.record(z.string(), z.unknown());

const decimalValueSchema = z.union([
  z.number(),
  z.string().trim().regex(/^-?\d+(?:\.\d+)?$/)
]).transform((value) => String(value));

const transactionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  typeText: z.string().optional(),
  statusText: z.string().optional(),
  amount: decimalValueSchema,
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  fee: decimalValueSchema.optional(),
  tradeTime: z.string().optional(),
  relatedTxnId: z.string().optional(),
  settlementStatus: z.string().optional(),
  originalAmount: decimalValueSchema.optional(),
  originalCurrency: z.string().length(3).transform((value) => value.toUpperCase()).optional(),
  merchantName: z.string().optional(),
  merchantCountry: z.string().optional(),
  merchantMcc: z.string().optional(),
  platformCardId: z.string().optional()
});

const transactionsDataSchema = z.object({
  transactions: z.array(transactionSchema),
  total: z.number(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  source: z.string().optional(),
  cardNo: z.string().optional()
});

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
    const maintenance = result.data.success === false
      && /(?:维护|内测结束|升级|暂不可用|temporar(?:y|ily)\s+unavailable|maintenance)/i.test(
        String(error.message || result.data.message || '')
      );
    throw new ProviderError(`Hnskj API error: ${error.message}`, {
      provider: 'hnskj',
      status: response.status,
      businessCode: error.code,
      kind: maintenance ? 'maintenance' : 'provider',
      retryable: maintenance || response.status === 502 || response.status === 503,
      retryAfterMs: maintenance ? 300_000 : null,
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

function validateObjectData(envelope, operation) {
  return validateData(envelope, objectDataSchema, operation);
}

const CARD_FAILURE_STATUSES = new Set(['failed', 'failure', 'invalid', 'inactive', 'closed', 'cancelled', 'canceled']);

function cardData(envelope) {
  return envelope?.data?.card ?? envelope?.data ?? {};
}

function valueAt(object, paths) {
  for (const path of paths) {
    let value = object;
    for (const key of path) value = value?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function optionalString(value) {
  return value === undefined || value === null || String(value).trim() === ''
    ? undefined : String(value);
}

export function normalizeHnskjTransaction(record) {
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const directAmount = valueAt(source, [['amount']]);
  const usdAmount = valueAt(source, [['amountUsd'], ['usdAmount']]);
  const originalAmount = valueAt(source, [['originalAmount'], ['original_amount']]);
  const amount = directAmount ?? usdAmount ?? originalAmount;
  const currency = directAmount != null
    ? valueAt(source, [['currency']])
    : usdAmount != null
      ? valueAt(source, [['usdCurrency']])
      : valueAt(source, [['originalCurrency'], ['original_currency']]);
  // The provider's webhook-cache projection also returns local monitoring
  // records (for example chargeback/chargeback_fee) without an explicit
  // currency.  Those records are denominated in the account's USD ledger;
  // rejecting the entire page here hid the real PURCHASE row that followed
  // them and made every later reconciliation look like a missing payment.
  const normalizedCurrency = currency ?? (
    source.platform === true && String(source.source || '').toLowerCase() === 'local'
      ? 'USD' : null
  );
  return Object.fromEntries(Object.entries({
    id: optionalString(valueAt(source, [['id'], ['transactionId'], ['transaction_id']])),
    type: optionalString(valueAt(source, [['type'], ['transactionType'], ['transaction_type']])),
    status: optionalString(valueAt(source, [['status'], ['transactionStatus'], ['transaction_status']])),
    typeText: optionalString(valueAt(source, [['typeText'], ['type_text']])),
    statusText: optionalString(valueAt(source, [['statusText'], ['status_text']])),
    amount,
    currency: optionalString(normalizedCurrency),
    fee: valueAt(source, [['fee'], ['feeAmount'], ['fee_amount']]) ?? undefined,
    tradeTime: optionalString(valueAt(source, [
      ['tradeTime'], ['txnTime'], ['transaction_time'], ['createTime'], ['createdAt']
    ])),
    relatedTxnId: optionalString(valueAt(source, [['relatedTxnId'], ['related_txn_id']])),
    settlementStatus: optionalString(valueAt(source, [['settlementStatus'], ['settlement_status']])),
    originalAmount: originalAmount ?? undefined,
    originalCurrency: optionalString(valueAt(source, [['originalCurrency'], ['original_currency']])),
    merchantName: optionalString(valueAt(source, [['merchantName'], ['merchant']])),
    merchantCountry: optionalString(valueAt(source, [['merchantCountry'], ['merchant_country']])),
    merchantMcc: optionalString(valueAt(source, [['merchantMcc'], ['merchant_mcc']])),
    platformCardId: optionalString(valueAt(source, [['platformCardId'], ['cardId'], ['card_id']]))
  }).filter(([, value]) => value !== undefined));
}

function validateTransactionsData(envelope) {
  const raw = envelope?.data;
  const normalized = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw, transactions: Array.isArray(raw.transactions)
      ? raw.transactions.map(normalizeHnskjTransaction) : raw.transactions }
    : raw;
  return validateData({ ...envelope, data: normalized }, transactionsDataSchema, 'card transactions');
}

export function mapPurchasedCard(envelope) {
  const data = envelope?.data;
  const providerCardId = valueAt(data, [
    ['card', 'id'], ['card', 'cardId'], ['card', 'card_id'],
    ['id'], ['cardId'], ['card_id']
  ]);
  if (providerCardId === null) {
    throw new ProviderSchemaError('Hnskj accepted the card purchase but returned no recognizable card ID', {
      provider: 'hnskj',
      retryable: false,
      uncertain: true
    });
  }
  return String(providerCardId);
}

export function mapCardRechargeResult(envelope) {
  const data = envelope?.data && typeof envelope.data === 'object' ? envelope.data : {};
  const rawStatus = valueAt(data, [['status'], ['rechargeStatus'], ['recharge_status'], ['transactionStatus']]);
  const status = String(rawStatus || '').trim().toLowerCase();
  const reference = valueAt(data, [['id'], ['rechargeId'], ['recharge_id'], ['transactionId'], ['transaction_id']]);
  if (['success', 'succeeded', 'completed', 'complete', 'settled'].includes(status)) {
    return { state: 'SETTLED', externalReference: reference ? String(reference) : null };
  }
  if (['pending', 'processing', 'submitted', 'created'].includes(status)) {
    return { state: 'PENDING', externalReference: reference ? String(reference) : null };
  }
  throw new ProviderSchemaError('Invalid Hnskj card recharge result', {
    provider: 'hnskj', uncertain: true
  });
}

export function mapCardCredentials(envelope) {
  const data = cardData(envelope);
  const cardNumber = String(data.cardNumber ?? data.card_number ?? data.number ?? data.pan ?? '').trim();
  const cvv = String(data.cvv ?? data.cvc ?? data.securityCode ?? data.security_code ?? '').trim();
  const expMonth = Number(data.expiryMonth ?? data.expiry_month ?? data.expMonth ?? data.exp_month);
  const expYear = Number(data.expiryYear ?? data.expiry_year ?? data.expYear ?? data.exp_year);
  if (
    !/^[0-9]{12,19}$/.test(cardNumber)
    || !/^[0-9]{3,4}$/.test(cvv)
    || !Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12
    || !Number.isInteger(expYear) || expYear < new Date().getUTCFullYear()
  ) {
    throw new ProviderSchemaError('Invalid Hnskj card credentials data', {
      provider: 'hnskj',
      uncertain: false
    });
  }
  return { cardNumber, expMonth, expYear, cvv };
}

export function mapCardProvisioning(envelope, minimumRequiredBalance, now = new Date()) {
  const data = cardData(envelope);
  const status = String(data.status || '').trim().toLowerCase();
  const currentBalance = Number(data.cardBalance ?? data.currentBalance ?? data.current_balance);
  const minimum = Number(minimumRequiredBalance);
  const cardNumber = String(data.cardNumber ?? data.card_number ?? data.number ?? data.pan ?? '').trim();
  const cvv = String(data.cvv ?? data.cvc ?? '').trim();
  const expMonth = Number(data.expiryMonth ?? data.expiry_month ?? data.expMonth ?? data.exp_month);
  const expYear = Number(data.expiryYear ?? data.expiry_year ?? data.expYear ?? data.exp_year);
  const expiryIndex = expYear * 12 + expMonth;
  const currentIndex = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
  const credentialsReady = /^[0-9]{12,19}$/.test(cardNumber)
    && /^[0-9]{3,4}$/.test(cvv)
    && Number.isInteger(expMonth) && expMonth >= 1 && expMonth <= 12
    && Number.isInteger(expYear) && expiryIndex >= currentIndex;
  const safe = {
    state: 'pending',
    status: status || 'unknown',
    currentBalance: Number.isFinite(currentBalance) ? currentBalance : null,
    currency: String(data.currency || 'USD'),
    last4: credentialsReady ? cardNumber.slice(-4) : null
  };
  if (CARD_FAILURE_STATUSES.has(status)) {
    return { ...safe, state: 'failed', failureCode: 'CARD_PROVISIONING_FAILED', failureReason: `Provider card status: ${status}` };
  }
  if (
    status === 'active'
    && credentialsReady
    && Number.isFinite(minimum) && minimum > 0
    && Number.isFinite(currentBalance) && currentBalance >= minimum
  ) {
    return { ...safe, state: 'ready' };
  }
  return safe;
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

  async card(cardId) {
    return validateObjectData(
      await this.request(`/cards/${encodeURIComponent(String(cardId))}`),
      'card detail'
    );
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

  async rechargeCard({ cardId, amount, idempotencyKey, remark }) {
    const rechargeAmount = Number(amount);
    if (!Number.isInteger(rechargeAmount) || rechargeAmount <= 0) {
      throw new Error('Hnskj recharge amount must be a positive integer');
    }
    const id = String(cardId || '').trim();
    if (!id) throw new Error('Hnskj recharge card ID is required');
    return this.request(`/cards/${encodeURIComponent(id)}/recharge`, {
      method: 'POST',
      headers: { 'X-Idempotency-Key': assertIdempotencyKey(idempotencyKey) },
      uncertainOnSchema: true,
      retryableOnSchema: true,
      body: {
        amount: rechargeAmount,
        ...(remark ? { remark: String(remark).slice(0, 128) } : {})
      }
    });
  }

  async refreshBalance(cardId) {
    return validateObjectData(
      await this.request(`/cards/${encodeURIComponent(String(cardId))}/refresh-balance`, {
        method: 'POST'
      }),
      'balance refresh'
    );
  }

  async transactions(cardId, query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params}` : '';
    return validateTransactionsData(
      await this.request(`/cards/${encodeURIComponent(String(cardId))}/transactions${suffix}`),
    );
  }

  async withdraw(cardId, idempotencyKey) {
    return validateObjectData(
      await this.request(`/cards/${encodeURIComponent(String(cardId))}/withdraw`, {
        method: 'POST',
        headers: { 'X-Idempotency-Key': assertIdempotencyKey(idempotencyKey) },
        uncertainOnSchema: true,
        retryableOnSchema: true
      }),
      'card withdrawal'
    );
  }
}
