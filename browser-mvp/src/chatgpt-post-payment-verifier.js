import { createHash } from 'node:crypto';

import { ContractError } from './contracts.js';
import { probeSessionIdentity } from './session-identity-probe.js';

const DEFAULT_ACCOUNT_CHECK_PATH = '/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=0';
const DEFAULT_CANCEL_PATH = '/backend-api/subscriptions/cancel';

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function boundedInteger(value, name, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function sameOriginPath(value, name) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    throw new ContractError(`${name} must be a same-origin absolute path`);
  }
  return value;
}

async function readSubscription(page, accountCheckPath) {
  return page.evaluate(async ({ path }) => {
    const sessionResponse = await fetch('/api/auth/session', { credentials: 'include' });
    let session = null;
    try { session = await sessionResponse.json(); } catch { session = null; }
    const accessToken = typeof session?.accessToken === 'string' ? session.accessToken : '';
    if (!sessionResponse.ok || !accessToken) {
      return { ok: false, stage: 'session', status: sessionResponse.status };
    }
    const response = await fetch(path, {
      credentials: 'include',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    const account = body?.accounts?.default || {};
    const entitlement = account.entitlement || {};
    const lastActive = account.last_active_subscription || {};
    return {
      ok: response.ok,
      stage: 'account',
      status: response.status,
      accountId: typeof account?.account?.account_id === 'string'
        ? account.account.account_id.trim()
        : (typeof session?.account?.id === 'string' ? session.account.id.trim() : ''),
      hasActive: entitlement.has_active_subscription === true,
      plan: typeof entitlement.subscription_plan === 'string'
        ? entitlement.subscription_plan.trim().toLowerCase() : '',
      willRenew: typeof lastActive.will_renew === 'boolean' ? lastActive.will_renew : null,
      purchaseOrigin: typeof lastActive.purchase_origin_platform === 'string'
        ? lastActive.purchase_origin_platform.trim().toLowerCase() : '',
    };
  }, { path: accountCheckPath });
}

async function cancelSubscription(page, cancelPath, accountId) {
  return page.evaluate(async ({ path, expectedAccountId }) => {
    const sessionResponse = await fetch('/api/auth/session', { credentials: 'include' });
    let session = null;
    try { session = await sessionResponse.json(); } catch { session = null; }
    const accessToken = typeof session?.accessToken === 'string' ? session.accessToken : '';
    const sessionAccountId = typeof session?.account?.id === 'string' ? session.account.id.trim() : '';
    if (!sessionResponse.ok || !accessToken || (sessionAccountId && sessionAccountId !== expectedAccountId)) {
      return { ok: false, status: sessionResponse.status, identityMatched: false };
    }
    const response = await fetch(path, {
      method: 'POST', credentials: 'include',
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ account_id: expectedAccountId }),
    });
    return { ok: response.ok, status: response.status, identityMatched: true };
  }, { path: cancelPath, expectedAccountId: accountId });
}

/**
 * Real post-payment observer bound to the same authenticated BitBrowser page.
 * Access tokens and raw account responses never leave page.evaluate().
 */
export class ChatGptPostPaymentVerifier {
  constructor({
    page,
    expectedIdentity,
    transactionReader,
    accountCheckPath = DEFAULT_ACCOUNT_CHECK_PATH,
    cancelPath = DEFAULT_CANCEL_PATH,
    timeoutMs = 60_000,
    pollIntervalMs = 1_000,
  } = {}) {
    if (!page || typeof page.evaluate !== 'function') throw new TypeError('page is required');
    if (!expectedIdentity || typeof expectedIdentity !== 'object') throw new TypeError('expectedIdentity is required');
    if (!transactionReader || typeof transactionReader.read !== 'function'
      || typeof transactionReader.reconcile !== 'function') {
      throw new TypeError('transactionReader.read/reconcile are required');
    }
    this.page = page;
    this.expectedIdentity = expectedIdentity;
    this.transactionReader = transactionReader;
    this.accountCheckPath = sameOriginPath(accountCheckPath, 'accountCheckPath');
    this.cancelPath = sameOriginPath(cancelPath, 'cancelPath');
    this.timeoutMs = boundedInteger(timeoutMs, 'timeoutMs', { min: 1_000, max: 300_000 });
    this.pollIntervalMs = boundedInteger(pollIntervalMs, 'pollIntervalMs', { min: 100, max: 10_000 });
  }

  async #verifiedIdentity() {
    return probeSessionIdentity(this.page, this.expectedIdentity, {
      accountCheckPath: this.accountCheckPath,
      stabilizationTimeoutMs: Math.min(this.timeoutMs, 15_000),
    });
  }

  async #poll(readiness) {
    const deadline = Date.now() + this.timeoutMs;
    let last = null;
    do {
      last = await readSubscription(this.page, this.accountCheckPath);
      if (readiness(last)) return last;
      if (Date.now() >= deadline) return last;
      await this.page.waitForTimeout(this.pollIntervalMs);
    } while (true);
  }

  async confirmPlus() {
    const identity = await this.#verifiedIdentity();
    const state = await this.#poll((value) => value?.ok && value.hasActive
      && String(value.plan).includes('plus'));
    const confirmed = Boolean(state?.ok && state.hasActive && String(state.plan).includes('plus'));
    return {
      confirmed,
      evidence: {
        kind: 'PLUS_ACTIVE', observed: confirmed,
        identityMatched: identity.identityMatched === true,
        accountIdDigest: state?.accountId ? digest(state.accountId) : null,
        httpStatus: Number(state?.status) || null,
      },
    };
  }

  async confirmCancellation() {
    await this.#verifiedIdentity();
    let state = await readSubscription(this.page, this.accountCheckPath);
    const plus = state?.ok && state.hasActive && String(state.plan).includes('plus');
    if (!plus || !state.accountId) {
      return { confirmed: false, evidence: { kind: 'CANCELLATION_CONFIRMED', observed: false } };
    }
    if (state.willRenew === false) {
      return { confirmed: true, evidence: { kind: 'CANCELLATION_CONFIRMED', observed: true, alreadyCancelled: true } };
    }
    if (/apple|ios|google|android/.test(state.purchaseOrigin)) {
      return { confirmed: false, evidence: { kind: 'CANCELLATION_CONFIRMED', observed: false, unsupportedOrigin: true } };
    }
    const requested = await cancelSubscription(this.page, this.cancelPath, state.accountId);
    if (!requested?.ok || requested.identityMatched !== true) {
      return { confirmed: false, evidence: { kind: 'CANCELLATION_CONFIRMED', observed: false, httpStatus: Number(requested?.status) || null } };
    }
    state = await this.#poll((value) => value?.ok && value.willRenew === false);
    const confirmed = Boolean(state?.ok && state.willRenew === false);
    return {
      confirmed,
      evidence: { kind: 'CANCELLATION_CONFIRMED', observed: confirmed, httpStatus: Number(state?.status) || null },
    };
  }

  async readCardTransactions() {
    return this.transactionReader.read();
  }

  async reconcile({ transactions }) {
    return this.transactionReader.reconcile({ transactions });
  }
}
