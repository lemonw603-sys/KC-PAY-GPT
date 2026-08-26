import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ContractError } from './contracts.js';
import { PaymentSafetyGate } from './payment-safety-gate.js';

function clone(value) { return structuredClone(value); }

/** Durable journal wrapper. Only opaque refs/statuses enter the WAL; no PAN/CVC/session material. */
export class DurablePaymentSafetyGate {
  constructor({ wal, filePath, clock = () => Date.now() } = {}) {
    if (!wal || typeof wal.append !== 'function' || typeof wal.verify !== 'function') throw new TypeError('wal is required');
    if (typeof filePath !== 'string' || filePath.length === 0) throw new TypeError('filePath is required');
    this.wal = wal;
    this.filePath = filePath;
    this.clock = clock;
    this.journalJobId = 'brjob:payment-gate:journal';
    this.gate = new PaymentSafetyGate({ clock });
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const records = await this.wal.verify();
    const latest = records.filter((record) => record.event.type === 'checkpoint' && record.event.summary?.action === 'payment-gate-state').at(-1);
    if (latest) this.gate.restore(latest.event.summary.snapshot);
    try { await readFile(this.filePath, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this._write({ version: 1, initializedAt: this.clock() });
    }
    return this;
  }

  async prepare(input) { return this._mutate(() => this.gate.prepare(input)); }
  async markSubmitted(permit, providerCallRef) { return this._mutate(() => this.gate.markSubmitted(permit, providerCallRef)); }
  async markUnknown(permit, reason) { return this._mutate(() => this.gate.markUnknown(permit, reason)); }
  async reconcileUnknown(permit, outcome) { return this._mutate(() => this.gate.reconcileUnknown(permit, outcome)); }
  async stop(scope, ref = null) { return this._mutate(() => { this.gate.stop(scope, ref); return this.gate.snapshot(); }); }
  async resume(scope, ref = null) { return this._mutate(() => { this.gate.resume(scope, ref); return this.gate.snapshot(); }); }
  async stopOnFundsDifference(input) { return this._mutate(() => this.gate.stopOnFundsDifference(input)); }
  canSubmit(input) { return this.gate.canSubmit(input); }
  snapshot() { return this.gate.snapshot(); }

  async _mutate(operation) {
    const before = this.gate.snapshot();
    const result = operation();
    try {
      await this._appendState();
      return clone(result);
    } catch (error) {
      this.gate.restore(before);
      throw error;
    }
  }

  async _appendState() {
    const snapshot = this.gate.snapshot();
    const records = await this.wal.verify();
    await this.wal.append({
      jobId: this.journalJobId,
      type: 'checkpoint',
      // AppendOnlyWal sequences are global across the file, not per job.
      sequence: records.length + 1,
      payloadDigest: '0'.repeat(64),
      summary: { action: 'payment-gate-state', snapshot },
    });
  }

  async _write(state) {
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temp, this.filePath);
  }
}
