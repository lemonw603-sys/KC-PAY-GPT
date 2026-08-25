import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

import { EvidenceSink } from './ports.js';
import { assertEvidenceEvent, assertSafeObject, ContractError } from './contracts.js';

const GENESIS = '0'.repeat(64);

export class WalIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WalIntegrityError';
  }
}

function hashRecord(record) {
  return createHash('sha256').update(`${record.prevHash}|${record.sequence}|${JSON.stringify(record.event)}|${record.appendedAt}`).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

export class AppendOnlyWal {
  constructor({ filePath, clock = () => Date.now() } = {}) {
    if (typeof filePath !== 'string' || filePath.length === 0) throw new TypeError('filePath is required');
    this.filePath = filePath;
    this.clock = clock;
    this._lock = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await appendFile(this.filePath, '', { mode: 0o600 });
    }
    return this;
  }

  async append(event) {
    assertEvidenceEvent(event);
    assertSafeObject(event, 'event');
    return this._withLock(async () => {
      const records = await this._readRecords();
      const previous = records.at(-1);
      const base = {
        version: 1,
        sequence: records.length + 1,
        prevHash: previous?.hash ?? GENESIS,
        event: clone(event),
        appendedAt: this.clock(),
      };
      const record = { ...base, hash: hashRecord(base) };
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      return clone(record);
    });
  }

  async verify() {
    return this._withLock(async () => clone(await this._readRecords()));
  }

  async _readRecords() {
    let raw;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    if (raw.length === 0) return [];
    const lines = raw.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const records = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        throw new WalIntegrityError(`WAL line ${index + 1} is not valid JSON`);
      }
      if (!record || record.version !== 1 || record.sequence !== index + 1 || record.prevHash !== (records.at(-1)?.hash ?? GENESIS) || record.hash !== hashRecord(record)) {
        throw new WalIntegrityError(`WAL integrity check failed at line ${index + 1}`);
      }
      try {
        assertEvidenceEvent(record.event);
        assertSafeObject(record.event, 'event');
      } catch (error) {
        if (error instanceof ContractError) throw new WalIntegrityError(`WAL event ${index + 1} violates contract`);
        throw error;
      }
      records.push(record);
    }
    return records;
  }

  async _withLock(operation) {
    const next = this._lock.then(operation, operation);
    this._lock = next.catch(() => undefined);
    return next;
  }
}

export class WalEvidenceSink extends EvidenceSink {
  constructor(wal) {
    super();
    if (!wal || typeof wal.append !== 'function') throw new TypeError('wal is required');
    this.wal = wal;
  }

  async append(event) {
    assertEvidenceEvent(event);
    return this.wal.append(event);
  }
}
