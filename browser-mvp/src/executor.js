import { createHash } from 'node:crypto';

import { assertJobEnvelope, ContractError } from './contracts.js';

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
  constructor({ runtimeAdapter, evidenceSink, clock = () => Date.now(), timeoutMs = 5_000 } = {}) {
    if (!runtimeAdapter || typeof runtimeAdapter.open !== 'function' || typeof runtimeAdapter.close !== 'function') throw new TypeError('runtimeAdapter is required');
    if (!evidenceSink || typeof evidenceSink.append !== 'function') throw new TypeError('evidenceSink is required');
    this.runtimeAdapter = runtimeAdapter;
    this.evidenceSink = evidenceSink;
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
    try {
      if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
      if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
      runtime = await this.runtimeAdapter.open(job.manifest);
      const page = await runtime.context.newPage();
      await page.goto(job.metadata.pageContract.urlPrefix, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      if (freezeRequested()) throw new BrowserExecutionError('MANUAL_FREEZE');
      if (!(await assertLease())) throw new BrowserExecutionError('LEASE_LOST');
      const checkpoint = await this._checkPage(page, job.metadata.pageContract);
      await this._event(job, 'checkpoint', 2, {
        action: 'page-signature',
        urlPrefix: job.metadata.pageContract.urlPrefix,
        observedUrlDigest: digest(page.url()),
        observedTitleDigest: digest(checkpoint.title),
        frameCount: checkpoint.frameCount,
      });
      return { status: 'OBSERVED', startedAt, finishedAt: this.clock(), submitCalls: 0 };
    } catch (error) {
      const failure = error instanceof BrowserExecutionError
        ? error
        : new BrowserExecutionError(error.name === 'TimeoutError' ? 'ACTION_TIMEOUT' : 'PAGE_CHECKPOINT_FAILED', error.message, error);
      await this._event(job, 'freeze', 3, { action: 'fail-closed', reason: failure.reason });
      throw failure;
    } finally {
      if (runtime) await this.runtimeAdapter.close(runtime).catch(() => undefined);
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
