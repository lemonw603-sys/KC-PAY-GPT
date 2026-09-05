import { createHash } from 'node:crypto';

import { assertJobEnvelope, ContractError } from './contracts.js';
import { probeSessionIdentity } from './session-identity-probe.js';
import { observeCheckout } from './checkout-observer.js';
import { navigateToChatGPTPlusCheckout } from './chatgpt-checkout-navigator.js';
import { fillSecureCardFieldsNonPayment } from './nonpayment-card-fill.js';
import { fillBillingAddress, fillTransientBillingEmail } from './billing-address-fill.js';
import { assertCardMaterial } from './card-material-lease.js';

export class BrowserExecutionError extends Error {
  constructor(reason, message = `Browser execution stopped: ${reason}`, cause) {
    super(message, { cause });
    this.name = 'BrowserExecutionError';
    this.reason = reason;
    this.failClosed = true;
  }
}

function digest(input) {
  return createHash('sha256').update(input).digest('hex');
}

function assertReadOnlyPageContract(contract, { identityProbeRequired = false } = {}) {
  if (!contract || typeof contract !== 'object') throw new ContractError('pageContract is required');
  if (typeof contract.urlPrefix !== 'string' || contract.urlPrefix.length === 0) throw new ContractError('pageContract.urlPrefix is required');
  if (typeof contract.title !== 'string' || contract.title.length === 0) throw new ContractError('pageContract.title is required');
  if (typeof contract.requiredSelector !== 'string' || contract.requiredSelector.length === 0) throw new ContractError('pageContract.requiredSelector is required');
  if (typeof contract.markerText !== 'string') throw new ContractError('pageContract.markerText must be a string');
  if (!identityProbeRequired && contract.markerText.length === 0) throw new ContractError('pageContract.markerText is required');
}

export class BrowserExecutionService {
  constructor({ runtimeAdapter, evidenceSink, sessionProvider = null, clock = () => Date.now(), timeoutMs = 5_000 } = {}) {
    if (!runtimeAdapter || typeof runtimeAdapter.open !== 'function' || typeof runtimeAdapter.close !== 'function') throw new TypeError('runtimeAdapter is required');
    if (!evidenceSink || typeof evidenceSink.append !== 'function') throw new TypeError('evidenceSink is required');
    this.runtimeAdapter = runtimeAdapter;
    this.evidenceSink = evidenceSink;
    this.sessionProvider = sessionProvider;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
  }

  async execute(job, {
    assertLease,
    signal = null,
    freezeRequested = () => false,
    cardMaterialLeaseProvider = null,
    cardMaterialLease = null,
    cardMaterialRef = null,
    validateCardMaterialOnly = false,
    fillCardFields = false,
  } = {}) {
    assertJobEnvelope(job);
    if (job.state !== 'RUNNING') throw new BrowserExecutionError('INVALID_STATE', 'job must be RUNNING before Browser execution');
    if (typeof assertLease !== 'function') throw new TypeError('assertLease callback is required');
    assertReadOnlyPageContract(job.metadata?.pageContract, {
      identityProbeRequired: Boolean(job.metadata?.accountProbeContract),
    });
    if (job.metadata?.checkoutNavigationContract && !job.metadata?.checkoutContract) {
      throw new ContractError('checkoutContract is required when Checkout navigation is enabled');
    }
    if (job.metadata?.accountProbeContract && !job.metadata?.sessionIdentity) {
      throw new ContractError('sessionIdentity is required when account probing is enabled');
    }
    const startedAt = this.clock();
    let evidenceSequence = 0;
    await this._event(job, 'intent', ++evidenceSequence, { action: 'observe-page', mode: job.manifest.mode });
    let runtime;
    let sessionLease;
    let sessionBootstrapped = false;
    let ownedCardMaterialLease = false;
    let abortRuntime;
    try {
      if (signal?.aborted) throw new BrowserExecutionError('LEASE_LOST');
      if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
      if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
      runtime = await this.runtimeAdapter.open(job.manifest, { profileRef: job.profileRef });
      abortRuntime = () => {
        // Closing the BrowserContext is the only reliable way to interrupt a
        // Playwright navigation/locator wait after the shared lease is lost.
        // close() is idempotently attempted again in finally.
        this.runtimeAdapter.close(runtime).catch(() => undefined);
      };
      signal?.addEventListener('abort', abortRuntime, { once: true });
      if (signal?.aborted) throw new BrowserExecutionError('LEASE_LOST');
      if (job.metadata?.sessionRef) {
        if (!this.sessionProvider || typeof this.sessionProvider.open !== 'function' || typeof this.sessionProvider.bootstrap !== 'function') {
          throw new BrowserExecutionError('SESSION_PROVIDER_UNAVAILABLE');
        }
        let sessionResult;
        if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
        try {
          sessionLease = await this.sessionProvider.open(job.metadata.sessionRef, { purpose: 'browser-observe' });
          sessionResult = await this.sessionProvider.bootstrap(sessionLease, runtime.context);
          sessionBootstrapped = true;
          await this.sessionProvider.close(sessionLease);
          sessionLease = null;
        } catch (error) {
          const sessionReasons = [
            'BROWSER_PREFLIGHT_CONTEXT_UNAVAILABLE', 'BROWSER_PREFLIGHT_SOURCE_UNAVAILABLE',
            'SESSION_INVALID', 'SESSION_MATERIAL_INVALID', 'INCOMPLETE_SESSION',
            'INVALID_SESSION_EXPIRY', 'SESSION_EXPIRED', 'INVALID_SESSION_TOKEN',
            'INVALID_ACCESS_TOKEN', 'INVALID_ACCESS_TOKEN_CLAIMS', 'ACCESS_TOKEN_EXPIRED',
            'ACCESS_TOKEN_NEAR_EXPIRY',
          ];
          const reason = sessionReasons.includes(error?.code) ? error.code : 'SESSION_INVALID';
          throw new BrowserExecutionError(
            reason,
            reason === 'SESSION_INVALID'
              ? 'stored Browser Session is unavailable or invalid'
              : 'Browser preflight Session source is temporarily unavailable',
            error,
          );
        }
        await this._event(job, 'checkpoint', ++evidenceSequence, {
          action: 'session-bootstrap',
          sessionDigest: sessionResult.sessionDigest,
          cookieCount: sessionResult.cookieCount,
        });
      }
      const page = await runtime.context.newPage();
      await page.goto(job.metadata.pageContract.urlPrefix, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
      if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
      let sessionIdentity = null;
      let transientBillingEmail = null;
      if (job.metadata.sessionIdentity) {
        try {
          sessionIdentity = await probeSessionIdentity(
            page,
            job.metadata.sessionIdentity,
            { ...(job.metadata.accountProbeContract || {}), onVerifiedEmail: (email) => { transientBillingEmail = email; } },
          );
        } catch (error) {
          const reason = [
            'SESSION_INVALID',
            'SESSION_IDENTITY_MISMATCH',
            'ACCOUNT_STATUS_UNKNOWN',
            'CHATGPT_ACCESS_BLOCKED',
          ].includes(error?.code)
            ? error.code : 'SESSION_IDENTITY_MISMATCH';
          throw new BrowserExecutionError(reason, error.message, error);
        }
        await this._event(job, 'checkpoint', ++evidenceSequence, {
          action: 'account-readonly-probe',
          loggedIn: sessionIdentity.loggedIn,
          identityMatched: sessionIdentity.identityMatched,
          subscriptionStatus: sessionIdentity.subscriptionStatus || null,
          alreadyPlus: sessionIdentity.alreadyPlus ?? null,
          submitCalls: 0,
        });
        if (sessionIdentity.alreadyPlus) {
          throw new BrowserExecutionError(
            'ACCOUNT_ALREADY_PLUS',
            'target account is not a free account before payment',
          );
        }
      }
      const checkpoint = await this._checkPage(page, job.metadata.pageContract);
      await this._event(job, 'checkpoint', ++evidenceSequence, {
        action: 'page-signature',
        urlPrefix: job.metadata.pageContract.urlPrefix,
        observedUrlDigest: digest(page.url()),
        observedTitleDigest: digest(checkpoint.title),
        frameCount: checkpoint.frameCount,
      });
      if (cardMaterialRef != null) {
        if (cardMaterialLease || !cardMaterialLeaseProvider || typeof cardMaterialLeaseProvider.open !== 'function') {
          throw new BrowserExecutionError('CARD_MATERIAL_PRECHECK_CONTRACT');
        }
        if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
        try {
          cardMaterialLease = await cardMaterialLeaseProvider.open(cardMaterialRef, {
            purpose: 'browser-nonpayment-preflight',
          });
          ownedCardMaterialLease = true;
        } catch (error) {
          throw new BrowserExecutionError('CARD_NOT_READY', 'stored card material is unavailable or invalid', error);
        }
      }
      let cardMaterialReady = false;
      if (validateCardMaterialOnly) {
        if (!cardMaterialLeaseProvider || !cardMaterialLease
          || typeof cardMaterialLeaseProvider.withMaterial !== 'function') {
          throw new BrowserExecutionError('CARD_MATERIAL_PRECHECK_CONTRACT');
        }
        try {
          await cardMaterialLeaseProvider.withMaterial(cardMaterialLease, (material) => {
            assertCardMaterial(material);
          });
          cardMaterialReady = true;
          if (!fillCardFields && ownedCardMaterialLease) {
            await cardMaterialLeaseProvider.close(cardMaterialLease);
            cardMaterialLease = null;
            ownedCardMaterialLease = false;
          }
        } catch (error) {
          throw new BrowserExecutionError('CARD_NOT_READY', 'stored card material preflight failed', error);
        }
        await this._event(job, 'checkpoint', ++evidenceSequence, {
          action: 'card-material-preflight',
          ready: true,
          fieldsWritten: 0,
          submitCalls: 0,
        });
      }
      let checkoutNavigation = null;
      if (job.metadata.checkoutNavigationContract) {
        const assertContinue = async () => {
          if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
          if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
        };
        try {
          checkoutNavigation = await navigateToChatGPTPlusCheckout(page, job.metadata.checkoutNavigationContract, {
            timeoutMs: this.timeoutMs,
            assertContinue,
          });
        } catch (error) {
          if (error instanceof BrowserExecutionError) throw error;
          throw new BrowserExecutionError('CHECKOUT_NAVIGATION_FAILED', error.message, error);
        }
        await this._event(job, 'checkpoint', ++evidenceSequence, {
          action: 'checkout-navigation',
          checkoutCreated: checkoutNavigation.checkoutCreated,
          questionnaireSkipped: checkoutNavigation.questionnaireSkipped,
          checkoutUrlDigest: checkoutNavigation.checkoutUrlDigest,
          submitCalls: 0,
        });
      }
      if (cardMaterialLease && cardMaterialLeaseProvider && typeof cardMaterialLeaseProvider.withMaterial === 'function') {
        await cardMaterialLeaseProvider.withMaterial(cardMaterialLease, async (material) => {
          if (material?.billingAddress) await fillBillingAddress(page, material.billingAddress, { timeoutMs: this.timeoutMs });
        });
      }
      if (transientBillingEmail) {
        await fillTransientBillingEmail(page, transientBillingEmail, { timeoutMs: this.timeoutMs });
      }
      let checkout = null;
      if (job.metadata.checkoutContract) {
        try {
          checkout = await observeCheckout(page, job.metadata.checkoutContract);
        } catch (error) {
          throw new BrowserExecutionError('CHECKOUT_OBSERVATION_FAILED', error.message, error);
        }
      }
      let cardFill = null;
      if (fillCardFields) {
        if (!cardMaterialLeaseProvider || !cardMaterialLease || !checkout) {
          throw new BrowserExecutionError('CARD_MATERIAL_FILL_CONTRACT');
        }
        try {
          cardFill = await fillSecureCardFieldsNonPayment(page, {
            cardMaterialLeaseProvider,
            lease: cardMaterialLease,
            assertContinue: async () => {
              if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
              if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
            },
            timeoutMs: this.timeoutMs,
          });
        } catch (error) {
          if (error instanceof BrowserExecutionError) throw error;
          throw new BrowserExecutionError('CARD_MATERIAL_FILL_FAILED', error.message, error);
        }
      }
      const readonlyChecklist = job.metadata.accountProbeContract ? {
        loggedIn: sessionIdentity?.loggedIn === true,
        identityMatched: sessionIdentity?.identityMatched === true,
        alreadyPlus: sessionIdentity?.alreadyPlus === true,
        plusEntryPresent: checkoutNavigation?.plusEntryPresent === true,
        checkoutRecognized: checkout?.recognized === true,
        fieldsWritten: 0,
        submitCalls: 0,
      } : null;
      return { status: 'OBSERVED', startedAt, finishedAt: this.clock(), submitCalls: 0, sessionBootstrapped, cardMaterialReady, sessionIdentity, checkoutNavigation, checkout, cardFill, readonlyChecklist };
    } catch (error) {
      const failure = error instanceof BrowserExecutionError
        ? error
        : new BrowserExecutionError(error.name === 'TimeoutError' ? 'ACTION_TIMEOUT' : 'PAGE_CHECKPOINT_FAILED', error.message, error);
      await this._event(job, 'freeze', ++evidenceSequence, { action: 'fail-closed', reason: failure.reason });
      throw failure;
    } finally {
      if (abortRuntime) signal?.removeEventListener('abort', abortRuntime);
      if (runtime) await this.runtimeAdapter.close(runtime).catch(() => undefined);
      if (sessionLease && this.sessionProvider) await this.sessionProvider.close(sessionLease).catch(() => undefined);
      if (ownedCardMaterialLease && cardMaterialLease && cardMaterialLeaseProvider) {
        await cardMaterialLeaseProvider.close(cardMaterialLease).catch(() => undefined);
      }
    }
  }

  async _checkPage(page, contract) {
    const url = page.url();
    if (!url.startsWith(contract.urlPrefix)) throw new BrowserExecutionError('PAGE_DRIFT');
    const marker = page.locator(contract.requiredSelector);
    try {
      await marker.waitFor({ state: 'visible', timeout: this.timeoutMs });
    } catch (error) {
      throw new BrowserExecutionError('PAGE_DRIFT', 'required page marker did not become visible', error);
    }
    if (await marker.count() !== 1) throw new BrowserExecutionError('PAGE_DRIFT');
    const title = await page.title();
    const titleMatches = contract.title === 'ChatGPT'
      ? title === contract.title || title.startsWith(`${contract.title}:`)
      : title === contract.title;
    if (!titleMatches) throw new BrowserExecutionError('PAGE_DRIFT');
    const text = await marker.textContent();
    if (contract.markerText && !text?.includes(contract.markerText)) throw new BrowserExecutionError('PAGE_DRIFT');
    return { title, frameCount: page.frames().length };
  }

  async _event(job, type, sequence, summary) {
    await this.evidenceSink.append({
      jobId: job.jobId,
      type,
      sequence,
      payloadDigest: digest(`${job.jobId}:${type}:${sequence}:${JSON.stringify(summary)}`),
      summary,
    });
  }
}
