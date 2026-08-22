import { runBrowserWorkerLoop } from './browser-worker-loop.js';

export class BrowserWorkerProcessError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BrowserWorkerProcessError';
    this.code = code;
  }
}

function required(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new BrowserWorkerProcessError(`${name} is required`, 'INVALID_ARGUMENT');
  return normalized;
}

export function createBrowserWorkerProcess({
  workerService,
  workerId,
  runtimeMode = 'LOCAL_MOCK',
  runtime,
  executeJob,
  leaseSeconds = 60,
  onIteration = () => {}
}) {
  const worker = required(workerId, 'workerId');
  if (runtimeMode !== 'LOCAL_MOCK') {
    throw new BrowserWorkerProcessError(
      'Browser worker process only permits LOCAL_MOCK until real-runtime approval',
      'REAL_RUNTIME_NOT_APPROVED'
    );
  }
  if (!runtime || runtime.mode !== 'LOCAL_MOCK') {
    throw new BrowserWorkerProcessError('LOCAL_MOCK runtime manifest is required', 'RUNTIME_MANIFEST_REQUIRED');
  }
  if (typeof executeJob !== 'function') throw new TypeError('executeJob is required');
  let stopped = false;
  return {
    workerId: worker,
    runtimeMode,
    async run({ iterations = 1 } = {}) {
      if (stopped) return [];
      return runBrowserWorkerLoop({
        workerService,
        workerId: worker,
        leaseSeconds,
        executeJob,
        iterations,
        onIteration: async (result) => {
          if (!stopped) await onIteration(result);
        }
      });
    },
    stop() { stopped = true; }
  };
}
