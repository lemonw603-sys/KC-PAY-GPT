import { createHash } from 'node:crypto';

import { assertJobEnvelope, ContractError } from './contracts.js';
import { probeSessionIdentity } from './session-identity-probe.js';
import { observeCheckout } from './checkout-observer.js';

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

function assertReadOnlyPageContract(contract) {
  if (!contract || typeof contract !== 'object') throw new ContractError('pageContract is required');
  if (typeof contract.urlPrefix !== 'string' || contract.urlPrefix.length === 0) throw new ContractError('pageContract.urlPrefix is required');
  if (typeof contract.title !== 'string' || contract.title.length === 0) throw new ContractError('pageContract.title is required');
  if (typeof contract.requiredSelector !== 'string' || contract.requiredSelector.length === 0) throw new ContractError('pageContract.requiredSelector is required');
  if (typeof contract.markerText !== 'string' || contract.markerText.length === 0) throw new ContractError('pageContract.markerText is required');
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

  async execute(job, { assertLease, freezeRequested = () => false } = {}) {
    assertJobEnvelope(job);
    if (job.state !== 'RUNNING') throw new BrowserExecutionError('INVALID_STATE', 'job must be RUNNING before Browser execution');
    if (typeof assertLease !== 'function') throw new TypeError('assertLease callback is required');
    assertReadOnlyPageContract(job.metadata?.pageContract);
    const startedAt = this.clock();
    await this._event(job, 'intent', 1, { action: 'observe-page', mode: job.manifest.mode });
    let runtime;
    let sessionLease;
    try {
      if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
      if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
      runtime = await this.runtimeAdapter.open(job.manifest, { profileRef: job.profileRef });
      if (job.metadata?.sessionRef) {
        if (!this.sessionProvider || typeof this.sessionProvider.open !== 'function' || typeof this.sessionProvider.bootstrap !== 'function') {
          throw new BrowserExecutionError('SESSION_PROVIDER_UNAVAILABLE');
        }
        sessionLease = await this.sessionProvider.open(job.metadata.sessionRef, { purpose: 'browser-observe' });
        const sessionResult = await this.sessionProvider.bootstrap(sessionLease, runtime.context);
        await this._event(job, 'checkpoint', 2, {
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
      if (job.metadata.sessionIdentity) {
        try {
          sessionIdentity = await probeSessionIdentity(page, job.metadata.sessionIdentity);
        } catch (error) {
          throw new BrowserExecutionError('SESSION_IDENTITY_MISMATCH', error.message, error);
        }
      }
      const checkpoint = await this._checkPage(page, job.metadata.pageContract);
      await this._event(job, 'checkpoint', sessionLease ? 3 : 2, {
        action: 'page-signature',
        urlPrefix: job.metadata.pageContract.urlPrefix,
        observedUrlDigest: digest(page.url()),
        observedTitleDigest: digest(checkpoint.title),
        frameCount: checkpoint.frameCount,
      });
      let checkout = null;
      if (job.metadata.checkoutContract) {
        try {
          checkout = await observeCheckout(page, job.metadata.checkoutContract);
        } catch (error) {
          throw new BrowserExecutionError('CHECKOUT_OBSERVATION_FAILED', error.message, error);
        }
      }
      return { status: 'OBSERVED', startedAt, finishedAt: this.clock(), submitCalls: 0, sessionBootstrapped: Boolean(sessionLease), sessionIdentity, checkout };
    } catch (error) {
      const failure = error instanceof BrowserExecutionError
        ? error
        : new BrowserExecutionError(error.name === 'TimeoutError' ? 'ACTION_TIMEOUT' : 'PAGE_CHECKPOINT_FAILED', error.message, error);
      await this._event(job, 'freeze', 3, { action: 'fail-closed', reason: failure.reason });
      throw failure;
    } finally {
      if (runtime) await this.runtimeAdapter.close(runtime).catch(() => undefined);
      if (sessionLease && this.sessionProvider) await this.sessionProvider.close(sessionLease).catch(() => undefined);
    }
  }

  async _checkPage(page, contract) {
    const url = page.url();
    const title = await page.title();
    if (!url.startsWith(contract.urlPrefix)) throw new BrowserExecutionError('PAGE_DRIFT');
    if (title !== contract.title) throw new BrowserExecutionError('PAGE_DRIFT');
    const marker = page.locator(contract.requiredSelector);
    if (await marker.count() !== 1) throw new BrowserExecutionError('PAGE_DRIFT');
    const text = await marker.textContent();
    if (!text?.includes(contract.markerText)) throw new BrowserExecutionError('PAGE_DRIFT');
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
