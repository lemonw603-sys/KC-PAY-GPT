import { randomUUID } from 'node:crypto';

export class BrowserWorkerError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = 'BrowserWorkerError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function required(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new BrowserWorkerError(`${name} is required`, 'INVALID_ARGUMENT');
  return normalized;
}

function digest(value, name) {
  const normalized = required(value, name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new BrowserWorkerError(`${name} must be a 64-character hex digest`, 'INVALID_ARGUMENT');
  }
  return normalized;
}

export function createBrowserWorkerService({
  dispatchRepository,
  executionRepository,
  resolveExecutionContext,
  runtime = null,
  now = () => new Date()
}) {
  if (!dispatchRepository) throw new TypeError('dispatchRepository is required');
  if (!executionRepository) throw new TypeError('executionRepository is required');
  if (typeof resolveExecutionContext !== 'function') throw new TypeError('resolveExecutionContext is required');

  async function claim(workerId, options = {}) {
    return dispatchRepository.claim({ workerId, ...options });
  }

  async function runClaimedJob(job, { workerId, leaseToken, leaseSeconds = 60 } = {}) {
    const worker = required(workerId, 'workerId');
    if (!job?.jobId || job.status !== 'CLAIMED') {
      throw new BrowserWorkerError('job must be claimed before execution', 'JOB_NOT_CLAIMED');
    }
    if (job.leaseOwner !== worker || !(leaseToken || job.leaseToken)) {
      throw new BrowserWorkerError('claimed job lease owner mismatch', 'LEASE_NOT_OWNED');
    }
    const token = required(leaseToken || job.leaseToken, 'leaseToken');
    const context = await resolveExecutionContext(job);
    const profile = required(context.executorProfileId, 'executorProfileId');
    const accountKeyHmac = digest(context.accountKeyHmac, 'accountKeyHmac');
    const profileManifestSha256 = digest(context.profileManifestSha256, 'profileManifestSha256');
    const networkLeaseHmac = digest(context.networkLeaseHmac, 'networkLeaseHmac');
    const run = await executionRepository.beginRun({
      attemptId: job.attemptId,
      executorProfileId: profile,
      accountKeyHmac,
      workerId: worker,
      startOperationKey: `browser-start:${job.jobKey}`,
      runId: context.runId || randomUUID(),
      leaseSeconds,
      now: now()
    });

    let stopped = false;
    async function assertLeaseBeforeAction(actionKind) {
      if (stopped) throw new BrowserWorkerError('Browser worker has stopped', 'WORKER_STOPPED');
      try {
        await dispatchRepository.heartbeat({
          jobId: job.jobId,
          workerId: worker,
          leaseToken: token,
          leaseSeconds,
          now: now()
        });
      } catch (error) {
        stopped = true;
        throw new BrowserWorkerError(
          `Browser action blocked after lease loss: ${actionKind}`,
          'LEASE_LOST_BEFORE_ACTION',
          { actionKind, causeCode: error?.code }
        );
      }
      const state = await executionRepository.getRecoveryState(run.runId);
      if (state.recoveryMode !== 'RESUMABLE' || state.runStatus !== 'RUNNING') {
        stopped = true;
        throw new BrowserWorkerError(
          `Browser action blocked by run state: ${actionKind}`,
          'RUN_NOT_ACTIONABLE',
          { actionKind, recoveryMode: state.recoveryMode, runStatus: state.runStatus }
        );
      }
      return state;
    }

    async function perform(actionKind, action, { actionTimeoutMs = leaseSeconds * 1000 } = {}) {
      required(actionKind, 'actionKind');
      if (typeof action !== 'function') throw new BrowserWorkerError('action must be a function', 'INVALID_ARGUMENT');
      if (!Number.isInteger(actionTimeoutMs) || actionTimeoutMs < 100 || actionTimeoutMs > 3_600_000) {
        throw new BrowserWorkerError('actionTimeoutMs is invalid', 'INVALID_ARGUMENT');
      }
      await assertLeaseBeforeAction(actionKind);
      if (!runtime || typeof runtime[actionKind] !== 'function') {
        throw new BrowserWorkerError(`Browser runtime action is not configured: ${actionKind}`, 'RUNTIME_ACTION_UNAVAILABLE');
      }
      const controller = new AbortController();
      let leaseFailure = null;
      let rejectLeaseFailure;
      const leaseFailurePromise = new Promise((_, reject) => { rejectLeaseFailure = reject; });
      const intervalMs = Math.max(100, Math.min(1000, Math.floor(leaseSeconds * 500)));
      const watchdog = setInterval(async () => {
        try {
          await dispatchRepository.heartbeat({
            jobId: job.jobId, workerId: worker, leaseToken: token,
            leaseSeconds, now: now()
          });
        } catch (error) {
          if (leaseFailure) return;
          leaseFailure = error;
          stopped = true;
          controller.abort(error);
          rejectLeaseFailure(new BrowserWorkerError(
            `Browser action interrupted after lease loss: ${actionKind}`,
            'LEASE_LOST_DURING_ACTION',
            { actionKind, causeCode: error?.code }
          ));
        }
      }, intervalMs);
      let timeoutId;
      let actionPromise;
      try {
        actionPromise = Promise.resolve().then(() => action(runtime[actionKind], {
          signal: controller.signal, profileManifestSha256, networkLeaseHmac
        }));
        return await Promise.race([
          actionPromise,
          leaseFailurePromise,
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              const timeoutError = new BrowserWorkerError(
                `Browser action timed out: ${actionKind}`, 'ACTION_TIMEOUT'
              );
              stopped = true;
              reject(timeoutError);
              controller.abort(timeoutError);
            }, actionTimeoutMs);
          })
        ]);
      } finally {
        clearInterval(watchdog);
        if (timeoutId) clearTimeout(timeoutId);
        // Promise.race observes late action rejection, while the AbortSignal
        // above asks Playwright/runtime code to stop any still-running work.
        // Do not await it here: a broken runtime must not hold the worker
        // lease forever after the fail-closed timeout.
        actionPromise?.catch(() => {});
      }
    }

    async function complete() {
      if (stopped) throw new BrowserWorkerError('Browser worker has stopped', 'WORKER_STOPPED');
      const result = await dispatchRepository.complete({
        jobId: job.jobId,
        workerId: worker,
        leaseToken: token,
        now: now()
      });
      stopped = true;
      return result;
    }

    return {
      run,
      job,
      assertLeaseBeforeAction,
      perform,
      complete,
      stop() { stopped = true; }
    };
  }

  return { claim, runClaimedJob };
}
