'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ContractError } = require('./experiment-core');

const GENESIS_HASH = 'GENESIS';
const SCHEMA_VERSION = 1;
const SAFE_REFERENCE_SUFFIX = /(?:ref|hash|hmac|fingerprint)$/i;
const SENSITIVE_KEY = /(?:sessiontoken|accesstoken|cookie|password|permitnonce|cardnumber|cardnumberraw|pan|cvv|cvc|navigationurl|rawurl|checkouturl|hostedurl|fragment|secret)$/i;
const SENSITIVE_VALUE_PATTERNS = Object.freeze([
    /https:\/\/(?:pay\.openai\.com|checkout\.stripe\.com)\/c\/pay\//i,
    /https:\/\/chatgpt\.com\/checkout\//i,
    /__Secure-(?:next-auth|authjs)\.session-token/i,
    /(?:cs_(?:live|test)|oaics)_[A-Za-z0-9_-]+/,
    /#(?:fid|synthetic-authority|payment)[A-Za-z0-9_-]*/i
]);

function canonicalize(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new ContractError('WAL_NON_JSON_VALUE');
        return value;
    }
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) {
        throw new ContractError('WAL_NON_JSON_VALUE');
    }
    const output = {};
    for (const key of Object.keys(value).sort()) {
        if (value[key] === undefined || typeof value[key] === 'function' || typeof value[key] === 'symbol') {
            throw new ContractError('WAL_NON_JSON_VALUE');
        }
        output[key] = canonicalize(value[key]);
    }
    return output;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function assertNoSensitiveData(value, pathParts = []) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoSensitiveData(item, [...pathParts, String(index)]));
        return;
    }
    if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
            if (SENSITIVE_KEY.test(normalized) && !SAFE_REFERENCE_SUFFIX.test(normalized)) {
                throw new ContractError('WAL_SENSITIVE_FIELD', [...pathParts, key].join('.'));
            }
            assertNoSensitiveData(child, [...pathParts, key]);
        }
        return;
    }
    if (typeof value === 'string' && SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
        throw new ContractError('WAL_SENSITIVE_VALUE', pathParts.join('.'));
    }
}

function eventHash(eventWithoutHash) {
    return sha256(canonicalJson(eventWithoutHash));
}

class AppendOnlyWal {
    constructor({ filePath }) {
        if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
            throw new ContractError('WAL_ABSOLUTE_PATH_REQUIRED');
        }
        this.filePath = filePath;
        this.lockPath = `${filePath}.lock`;
        this.verifiedCache = null;
    }

    readAll({ useCache = false } = {}) {
        if (useCache && this.#cacheMatchesFile()) return this.verifiedCache.events;
        if (!fs.existsSync(this.filePath)) {
            const events = Object.freeze([]);
            this.verifiedCache = { fingerprint: null, events };
            return events;
        }
        const content = fs.readFileSync(this.filePath, 'utf8');
        if (!content) {
            const events = Object.freeze([]);
            this.verifiedCache = { fingerprint: this.#fileFingerprint(), events };
            return events;
        }
        if (!content.endsWith('\n')) throw new ContractError('WAL_TRUNCATED');

        const events = [];
        const seenEventIds = new Set();
        let expectedPrevHash = GENESIS_HASH;
        const lines = content.slice(0, -1).split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            let event;
            try {
                event = JSON.parse(lines[index]);
            } catch {
                throw new ContractError('WAL_INVALID_JSON', `line ${index + 1}`);
            }
            const expectedSequence = index + 1;
            if (event.schemaVersion !== SCHEMA_VERSION) throw new ContractError('WAL_SCHEMA_UNSUPPORTED');
            if (event.sequence !== expectedSequence) throw new ContractError('WAL_SEQUENCE_BROKEN');
            if (event.prevHash !== expectedPrevHash) throw new ContractError('WAL_CHAIN_BROKEN');
            if (seenEventIds.has(event.eventId)) throw new ContractError('WAL_DUPLICATE_EVENT_ID');
            const { hash, ...withoutHash } = event;
            if (typeof hash !== 'string' || hash !== eventHash(withoutHash)) {
                throw new ContractError('WAL_HASH_MISMATCH');
            }
            assertNoSensitiveData(event.payload);
            seenEventIds.add(event.eventId);
            expectedPrevHash = hash;
            events.push(deepFreeze(event));
        }
        const frozenEvents = Object.freeze(events);
        this.verifiedCache = {
            fingerprint: this.#fileFingerprint(),
            events: frozenEvents
        };
        return frozenEvents;
    }

    head() {
        const events = this.readAll();
        return Object.freeze({
            sequence: events.length,
            hash: events.length ? events.at(-1).hash : GENESIS_HASH
        });
    }

    append({ runId, eventType, payload = {}, occurredAt = new Date().toISOString(), eventId }, { expectedHeadHash } = {}) {
        const lockFd = this.#acquireLock();
        try {
            const events = this.readAll({ useCache: true });
            const headHash = events.length ? events.at(-1).hash : GENESIS_HASH;
            if (expectedHeadHash !== undefined && expectedHeadHash !== headHash) {
                throw new ContractError('WAL_HEAD_CONFLICT');
            }
            if (typeof runId !== 'string' || !runId) throw new ContractError('WAL_RUN_ID_REQUIRED');
            if (typeof eventType !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(eventType)) {
                throw new ContractError('WAL_EVENT_TYPE_INVALID');
            }
            const canonicalPayload = canonicalize(payload);
            assertNoSensitiveData(canonicalPayload);
            const withoutHash = {
                schemaVersion: SCHEMA_VERSION,
                sequence: events.length + 1,
                eventId: eventId || `event_${crypto.randomBytes(12).toString('hex')}`,
                runId,
                eventType,
                occurredAt,
                prevHash: headHash,
                payload: canonicalPayload
            };
            if (events.some((event) => event.eventId === withoutHash.eventId)) {
                throw new ContractError('WAL_DUPLICATE_EVENT_ID');
            }
            const event = deepFreeze({ ...withoutHash, hash: eventHash(withoutHash) });
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
            const fd = fs.openSync(this.filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
            try {
                fs.writeSync(fd, `${JSON.stringify(event)}\n`, null, 'utf8');
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            fs.chmodSync(this.filePath, 0o600);
            this.verifiedCache = {
                fingerprint: this.#fileFingerprint(),
                events: Object.freeze([...events, event])
            };
            return event;
        } finally {
            fs.closeSync(lockFd);
            fs.unlinkSync(this.lockPath);
        }
    }

    #acquireLock() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
        try {
            const fd = fs.openSync(this.lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
            fs.writeSync(fd, `${process.pid}\n`, null, 'utf8');
            fs.fsyncSync(fd);
            return fd;
        } catch (error) {
            if (error?.code === 'EEXIST') throw new ContractError('WAL_BUSY');
            throw error;
        }
    }

    #fileFingerprint() {
        if (!fs.existsSync(this.filePath)) return null;
        const stat = fs.statSync(this.filePath, { bigint: true });
        return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    }

    #cacheMatchesFile() {
        if (!this.verifiedCache) return false;
        return this.verifiedCache.fingerprint === this.#fileFingerprint();
    }
}

function recoverRunState(events, runId) {
    const runEvents = events.filter((event) => event.runId === runId);
    if (!runEvents.length) throw new ContractError('WAL_RUN_NOT_FOUND');
    let state = {
        runId,
        status: 'UNKNOWN',
        route: null,
        checkoutArtifact: null,
        paymentState: 'NOT_STARTED',
        controlState: 'AUTOMATION',
        mayCreateCheckout: true,
        maySubmitPayment: false,
        recoveryAction: 'RESUME_PRECHECK',
        lastSequence: 0
    };
    const unknownEvents = [];
    const pendingOperations = new Map();

    for (const event of runEvents) {
        state.lastSequence = event.sequence;
        if (event.eventType === 'OPERATION_PREPARED') {
            pendingOperations.set(event.payload.operationId, event.payload.operationType);
        } else if (event.eventType === 'OPERATION_ABORTED') {
            pendingOperations.delete(event.payload.operationId);
        } else if (event.eventType === 'RUN_STARTED') {
            state.status = 'RUNNING';
        } else if (event.eventType === 'ROUTE_SELECTED') {
            state.route = event.payload.route;
        } else if (event.eventType === 'CHECKOUT_ATTACHED') {
            state.checkoutArtifact = event.payload.checkoutArtifact;
            state.mayCreateCheckout = false;
            state.maySubmitPayment = true;
            state.recoveryAction = 'RESUME_SAME_ARTIFACT';
        } else if (event.eventType === 'PAYMENT_STATE_CHANGED') {
            state.paymentState = event.payload.paymentState;
            if (['PAYMENT_SUBMITTING', 'PAYMENT_UNKNOWN'].includes(state.paymentState)) {
                state.mayCreateCheckout = false;
                state.maySubmitPayment = false;
                state.recoveryAction = 'RECONCILE_ONLY';
            }
            if (['ENTITLEMENT_CONFIRMED', 'CANCELLATION_PENDING', 'DELIVERY_COMPLETE'].includes(state.paymentState)) {
                state.mayCreateCheckout = false;
                state.maySubmitPayment = false;
                state.recoveryAction = state.paymentState === 'DELIVERY_COMPLETE'
                    ? 'NONE'
                    : 'CANCELLATION_ONLY';
            }
            if (state.paymentState === 'REQUIRES_3DS') {
                state.mayCreateCheckout = false;
                state.maySubmitPayment = false;
                state.recoveryAction = 'SAME_AUTHORIZATION_3DS_ONLY';
            }
            if (state.paymentState === 'DECLINED_SAFE') {
                state.mayCreateCheckout = false;
                state.maySubmitPayment = false;
                state.recoveryAction = 'PAYMENT_DECLINE_REVIEW_REQUIRED';
            }
        } else if (event.eventType === 'CONTROL_STATE_CHANGED') {
            state.controlState = event.payload.controlState;
            if (state.controlState !== 'AUTOMATION') {
                state.mayCreateCheckout = false;
                state.maySubmitPayment = false;
                state.recoveryAction = 'TAKEOVER_RECOVERY_REQUIRED';
            }
        } else if (event.eventType === 'RUN_COMPLETED') {
            state.status = 'COMPLETED';
            state.recoveryAction = 'NONE';
            state.mayCreateCheckout = false;
            state.maySubmitPayment = false;
        } else {
            unknownEvents.push(event.eventType);
        }
        if (event.payload?.operationCompleted === true) {
            pendingOperations.delete(event.payload.operationId);
        }
    }

    if (pendingOperations.size) {
        const pending = [...pendingOperations.entries()].map(([operationId, operationType]) => ({
            operationId,
            operationType
        }));
        const hasPaymentSubmit = pending.some((operation) => operation.operationType === 'PAYMENT_SUBMIT');
        const hasCheckoutAttach = pending.some((operation) => operation.operationType === 'CHECKOUT_ATTACH');
        state = {
            ...state,
            status: 'REVIEW_REQUIRED',
            paymentState: hasPaymentSubmit ? 'PAYMENT_UNKNOWN' : state.paymentState,
            mayCreateCheckout: false,
            maySubmitPayment: false,
            recoveryAction: hasPaymentSubmit
                ? 'RECONCILE_ONLY'
                : hasCheckoutAttach
                    ? 'CHECKOUT_REVIEW_REQUIRED'
                    : 'INCOMPLETE_OPERATION_REVIEW_REQUIRED',
            pendingOperations: Object.freeze(pending.map(Object.freeze))
        };
    }

    if (unknownEvents.length) {
        state = {
            ...state,
            status: 'REVIEW_REQUIRED',
            mayCreateCheckout: false,
            maySubmitPayment: false,
            recoveryAction: 'UNKNOWN_EVENT_REVIEW_REQUIRED',
            unknownEvents: Object.freeze([...new Set(unknownEvents)])
        };
    }
    return Object.freeze(state);
}

module.exports = {
    AppendOnlyWal,
    canonicalJson,
    assertNoSensitiveData,
    recoverRunState,
    deepFreeze,
    GENESIS_HASH
};
