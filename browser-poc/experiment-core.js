'use strict';

const crypto = require('node:crypto');
const { parseCheckoutLink } = require('./checkout-link-core');

const EXPERIMENT_SCOPES = new Set(['AUTH_READ_ONLY', 'CHECKOUT_MUTATING', 'PAYMENT_SIMULATED']);
const REQUIRED_MANIFEST_FIELDS = Object.freeze([
    'runtimeId',
    'runtimeVersion',
    'adapterVersion',
    'networkLevel',
    'networkLeaseHmac',
    'locale',
    'timezone',
    'sessionMaterialPolicy'
]);

class ContractError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'ContractError';
        this.code = code;
    }
}

function requireString(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ContractError('INVALID_INPUT', `${field} must be a non-empty string`);
    }
    return value.trim();
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function publicManifest(manifest) {
    const result = {};
    for (const field of REQUIRED_MANIFEST_FIELDS) {
        result[field] = requireString(manifest?.[field], `manifest.${field}`);
    }
    return Object.freeze({
        ...result,
        manifestSha256: sha256(JSON.stringify(result))
    });
}

class LeaseRegistry {
    constructor() {
        this.leases = new Map();
    }

    acquire({ resourceType, resourceKey, ownerId, now = Date.now(), ttlMs = 30_000 }) {
        const type = requireString(resourceType, 'resourceType');
        const key = requireString(resourceKey, 'resourceKey');
        const owner = requireString(ownerId, 'ownerId');
        if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
            throw new ContractError('INVALID_LEASE_TTL');
        }
        const leaseKey = `${type}:${key}`;
        const current = this.leases.get(leaseKey);
        if (current && current.leaseUntil > now && current.ownerId !== owner) {
            throw new ContractError('RESOURCE_BUSY', `${leaseKey} is held by another owner`);
        }
        const lease = Object.freeze({
            resourceType: type,
            resourceKey: key,
            ownerId: owner,
            leaseToken: crypto.randomBytes(24).toString('hex'),
            leaseUntil: now + ttlMs
        });
        this.leases.set(leaseKey, lease);
        return lease;
    }

    heartbeat({ resourceType, resourceKey, ownerId, leaseToken, now = Date.now(), ttlMs = 30_000 }) {
        const current = this.assertOwner({ resourceType, resourceKey, ownerId, leaseToken, now });
        const renewed = Object.freeze({ ...current, leaseUntil: now + ttlMs });
        this.leases.set(`${current.resourceType}:${current.resourceKey}`, renewed);
        return renewed;
    }

    assertOwner({ resourceType, resourceKey, ownerId, leaseToken, now = Date.now() }) {
        const leaseKey = `${resourceType}:${resourceKey}`;
        const current = this.leases.get(leaseKey);
        if (!current || current.leaseUntil <= now) {
            throw new ContractError('LEASE_EXPIRED');
        }
        if (current.ownerId !== ownerId || current.leaseToken !== leaseToken) {
            throw new ContractError('LEASE_NOT_OWNED');
        }
        return current;
    }

    release({ resourceType, resourceKey, ownerId, leaseToken, now = Date.now() }) {
        const current = this.assertOwner({ resourceType, resourceKey, ownerId, leaseToken, now });
        this.leases.delete(`${current.resourceType}:${current.resourceKey}`);
        return true;
    }
}

class EncryptedArtifactVault {
    constructor({ encryptionKey = crypto.randomBytes(32) } = {}) {
        if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
            throw new ContractError('INVALID_VAULT_KEY');
        }
        this.encryptionKey = Buffer.from(encryptionKey);
        this.records = new Map();
    }

    put({ runId, accountKeyHmac, kind, navigationUrl, now = Date.now() }) {
        const run = requireString(runId, 'runId');
        const account = requireString(accountKeyHmac, 'accountKeyHmac');
        const url = requireString(navigationUrl, 'navigationUrl');
        const parsed = parseCheckoutLink(url);
        if (!['HOSTED_COMPLETE', 'INTERNAL_SESSION_BOUND'].includes(parsed.kind)) {
            throw new ContractError('INVALID_CHECKOUT_ARTIFACT', parsed.reason || parsed.kind);
        }
        if (kind && kind !== parsed.kind) {
            throw new ContractError('CHECKOUT_KIND_MISMATCH');
        }

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        const ciphertext = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        const artifactId = `artifact_${crypto.randomBytes(12).toString('hex')}`;
        const secretRef = `vault://${artifactId}`;
        const publicRecord = Object.freeze({
            artifactId,
            secretRef,
            runId: run,
            accountKeyHmac: account,
            kind: parsed.kind,
            urlHash: sha256(url),
            checkoutHash: parsed.checkoutIdFingerprint || null,
            createdAt: new Date(now).toISOString(),
            openedAt: null,
            invalidatedAt: null
        });
        this.records.set(artifactId, {
            publicRecord,
            iv,
            authTag,
            ciphertext
        });
        return publicRecord;
    }

    reveal({ artifactId, runId }) {
        const record = this.records.get(requireString(artifactId, 'artifactId'));
        if (!record || record.publicRecord.runId !== runId) {
            throw new ContractError('ARTIFACT_ACCESS_DENIED');
        }
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, record.iv);
        decipher.setAuthTag(record.authTag);
        return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString('utf8');
    }

    markOpened({ artifactId, runId, now = Date.now() }) {
        const record = this.records.get(requireString(artifactId, 'artifactId'));
        if (!record || record.publicRecord.runId !== runId) {
            throw new ContractError('ARTIFACT_ACCESS_DENIED');
        }
        record.publicRecord = Object.freeze({
            ...record.publicRecord,
            openedAt: record.publicRecord.openedAt || new Date(now).toISOString()
        });
        return record.publicRecord;
    }

    exportPublic(artifactId) {
        const record = this.records.get(requireString(artifactId, 'artifactId'));
        if (!record) throw new ContractError('ARTIFACT_NOT_FOUND');
        return record.publicRecord;
    }
}

class ControlOwnership {
    constructor() {
        this.runs = new Map();
    }

    initialize({ runId, automationOwnerId }) {
        const run = requireString(runId, 'runId');
        if (this.runs.has(run)) throw new ContractError('CONTROL_ALREADY_INITIALIZED');
        const state = Object.freeze({
            runId: run,
            state: 'AUTOMATION',
            automationOwnerId: requireString(automationOwnerId, 'automationOwnerId'),
            humanOwnerId: null,
            requestedBy: null
        });
        this.runs.set(run, state);
        return state;
    }

    requestTakeover({ runId, humanOwnerId }) {
        const current = this.#expect(runId, 'AUTOMATION');
        const next = Object.freeze({
            ...current,
            state: 'REQUESTED',
            requestedBy: requireString(humanOwnerId, 'humanOwnerId')
        });
        this.runs.set(runId, next);
        return next;
    }

    freeze({ runId, automationOwnerId }) {
        const current = this.#expect(runId, 'REQUESTED');
        if (current.automationOwnerId !== automationOwnerId) {
            throw new ContractError('CONTROL_NOT_OWNED');
        }
        const next = Object.freeze({ ...current, state: 'FROZEN' });
        this.runs.set(runId, next);
        return next;
    }

    transfer({ runId, humanOwnerId }) {
        const current = this.#expect(runId, 'FROZEN');
        if (current.requestedBy !== humanOwnerId) {
            throw new ContractError('TAKEOVER_REQUEST_MISMATCH');
        }
        const next = Object.freeze({
            ...current,
            state: 'TRANSFERRED',
            humanOwnerId,
            automationOwnerId: null
        });
        this.runs.set(runId, next);
        return next;
    }

    release({ runId, humanOwnerId }) {
        const current = this.#expect(runId, 'TRANSFERRED');
        if (current.humanOwnerId !== humanOwnerId) {
            throw new ContractError('CONTROL_NOT_OWNED');
        }
        const next = Object.freeze({ ...current, state: 'RELEASED' });
        this.runs.set(runId, next);
        return next;
    }

    assertActor({ runId, actorType, actorId }) {
        const current = this.runs.get(runId);
        if (!current) throw new ContractError('CONTROL_NOT_INITIALIZED');
        const allowed = (actorType === 'AUTOMATION'
            && current.state === 'AUTOMATION'
            && current.automationOwnerId === actorId)
            || (actorType === 'HUMAN'
                && current.state === 'TRANSFERRED'
                && current.humanOwnerId === actorId);
        if (!allowed) throw new ContractError('CONTROL_NOT_OWNED');
        return current;
    }

    #expect(runId, state) {
        const current = this.runs.get(requireString(runId, 'runId'));
        if (!current) throw new ContractError('CONTROL_NOT_INITIALIZED');
        if (current.state !== state) throw new ContractError('INVALID_CONTROL_TRANSITION');
        return current;
    }
}

class ExperimentOrchestrator {
    constructor({ leases = new LeaseRegistry(), vault = new EncryptedArtifactVault(), control = new ControlOwnership() } = {}) {
        this.leases = leases;
        this.vault = vault;
        this.control = control;
        this.runs = new Map();
        this.mutationAssignments = new Map();
    }

    beginRun(input, now = Date.now()) {
        const runId = requireString(input?.runId, 'runId');
        const experimentId = requireString(input?.experimentId, 'experimentId');
        const laneId = requireString(input?.laneId, 'laneId');
        const accountKeyHmac = requireString(input?.accountKeyHmac, 'accountKeyHmac');
        const scope = requireString(input?.scope, 'scope');
        if (!EXPERIMENT_SCOPES.has(scope)) throw new ContractError('INVALID_EXPERIMENT_SCOPE');
        if (this.runs.has(runId)) throw new ContractError('RUN_ALREADY_EXISTS');

        let mutationAssignmentKey = null;
        if (scope === 'CHECKOUT_MUTATING') {
            requireString(input?.cohortId, 'cohortId');
            const assignmentKey = `${experimentId}:${accountKeyHmac}`;
            const assignedLane = this.mutationAssignments.get(assignmentKey);
            if (assignedLane && assignedLane !== laneId) {
                throw new ContractError('MUTATING_COHORT_CONTAMINATION');
            }
            mutationAssignmentKey = assignmentKey;
        }

        const manifest = publicManifest(input.manifest);
        const accountLease = this.leases.acquire({
            resourceType: 'ACCOUNT',
            resourceKey: accountKeyHmac,
            ownerId: runId,
            now,
            ttlMs: input.leaseTtlMs || 30_000
        });
        this.control.initialize({ runId, automationOwnerId: input.automationOwnerId || runId });
        if (mutationAssignmentKey) {
            this.mutationAssignments.set(mutationAssignmentKey, laneId);
        }
        const run = {
            runId,
            experimentId,
            scope,
            laneId,
            cohortId: input.cohortId || null,
            accountKeyHmac,
            manifest,
            accountLease,
            checkoutArtifactId: null,
            checkoutCreated: false,
            paymentState: 'NOT_STARTED',
            attemptOrdinal: Number(input.attemptOrdinal || 1)
        };
        this.runs.set(runId, run);
        return this.publicEvidence(runId);
    }

    attachCheckout({ runId, navigationUrl, kind, actorType = 'AUTOMATION', actorId = runId, now = Date.now() }) {
        const run = this.#run(runId);
        if (run.scope !== 'CHECKOUT_MUTATING') throw new ContractError('CHECKOUT_FORBIDDEN_IN_SCOPE');
        if (run.checkoutCreated) throw new ContractError('ACTIVE_CHECKOUT_EXISTS');
        this.control.assertActor({ runId, actorType, actorId });
        this.leases.assertOwner({
            resourceType: 'ACCOUNT',
            resourceKey: run.accountKeyHmac,
            ownerId: runId,
            leaseToken: run.accountLease.leaseToken,
            now
        });
        const artifact = this.vault.put({
            runId,
            accountKeyHmac: run.accountKeyHmac,
            kind,
            navigationUrl,
            now
        });
        const artifactLease = this.leases.acquire({
            resourceType: 'CHECKOUT_ARTIFACT',
            resourceKey: artifact.artifactId,
            ownerId: runId,
            now,
            ttlMs: Math.max(30_000, run.accountLease.leaseUntil - now)
        });
        run.checkoutCreated = true;
        run.checkoutArtifactId = artifact.artifactId;
        run.artifactLease = artifactLease;
        return artifact;
    }

    selectRoute({ runId, champion, fallback, championEligible, fallbackEligible }) {
        const run = this.#run(runId);
        if (run.checkoutCreated || run.paymentState !== 'NOT_STARTED') {
            throw new ContractError('ROUTE_FROZEN_AFTER_CHECKOUT');
        }
        if (championEligible) return Object.freeze({ selected: requireString(champion, 'champion'), reason: 'CHAMPION_ELIGIBLE' });
        if (fallback && fallbackEligible) return Object.freeze({ selected: fallback, reason: 'FALLBACK_PRECHECK_ELIGIBLE' });
        throw new ContractError('NO_ELIGIBLE_ROUTE');
    }

    markPaymentState({ runId, paymentState }) {
        const run = this.#run(runId);
        run.paymentState = requireString(paymentState, 'paymentState');
        return this.publicEvidence(runId);
    }

    publicEvidence(runId) {
        const run = this.#run(runId);
        return Object.freeze({
            experimentId: run.experimentId,
            runId: run.runId,
            scope: run.scope,
            laneId: run.laneId,
            cohortId: run.cohortId,
            accountKeyHmac: run.accountKeyHmac,
            manifest: run.manifest,
            attemptOrdinal: run.attemptOrdinal,
            checkoutCreated: run.checkoutCreated,
            checkoutArtifact: run.checkoutArtifactId
                ? this.vault.exportPublic(run.checkoutArtifactId)
                : null,
            paymentState: run.paymentState,
            simulatedPaymentActionConsumed: run.paymentState !== 'NOT_STARTED',
            paymentSubmitted: false
        });
    }

    #run(runId) {
        const run = this.runs.get(requireString(runId, 'runId'));
        if (!run) throw new ContractError('RUN_NOT_FOUND');
        return run;
    }
}

module.exports = {
    ContractError,
    LeaseRegistry,
    EncryptedArtifactVault,
    ControlOwnership,
    ExperimentOrchestrator,
    publicManifest
};
