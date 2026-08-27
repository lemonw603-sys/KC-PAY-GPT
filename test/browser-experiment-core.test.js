'use strict';

const {
    ContractError,
    LeaseRegistry,
    EncryptedArtifactVault,
    ControlOwnership,
    ExperimentOrchestrator
} = require('../browser-poc/experiment-core');

function manifest(overrides = {}) {
    return {
        runtimeId: 'PLAYWRIGHT_CHROMIUM',
        runtimeVersion: '1.59.1',
        adapterVersion: 'test-build',
        networkLevel: 'OFFLINE',
        networkLeaseHmac: 'network-hmac',
        locale: 'en-US',
        timezone: 'Asia/Manila',
        sessionMaterialPolicy: 'SYNTHETIC',
        ...overrides
    };
}

function runInput(overrides = {}) {
    return {
        experimentId: 'exp-1',
        runId: 'run-1',
        scope: 'CHECKOUT_MUTATING',
        laneId: 'HOSTED_SPLIT_CONTEXT',
        cohortId: 'cohort-a',
        accountKeyHmac: 'account-hmac-a',
        automationOwnerId: 'worker-1',
        manifest: manifest(),
        ...overrides
    };
}

function expectCode(fn, code) {
    try {
        fn();
        throw new Error(`expected ${code}`);
    } catch (error) {
        expect(error).toBeInstanceOf(ContractError);
        expect(error.code).toBe(code);
    }
}

describe('browser experiment control contract', () => {
    it('rejects incomplete runtime manifests', () => {
        const orchestrator = new ExperimentOrchestrator();
        expectCode(() => orchestrator.beginRun(runInput({
            manifest: manifest({ timezone: '' })
        })), 'INVALID_INPUT');
    });

    it('forbids checkout creation in read-only experiments', () => {
        const orchestrator = new ExperimentOrchestrator();
        orchestrator.beginRun(runInput({
            scope: 'AUTH_READ_ONLY',
            cohortId: undefined
        }));
        expectCode(() => orchestrator.attachCheckout({
            runId: 'run-1',
            actorId: 'worker-1',
            navigationUrl: 'https://pay.openai.com/c/pay/cs_test_readonly#synthetic-secret'
        }), 'CHECKOUT_FORBIDDEN_IN_SCOPE');
    });

    it('prevents cross-lane contamination for a mutating account cohort', () => {
        const leases = new LeaseRegistry();
        const orchestrator = new ExperimentOrchestrator({ leases });
        orchestrator.beginRun(runInput());
        const first = orchestrator.runs.get('run-1');
        leases.release({
            resourceType: 'ACCOUNT',
            resourceKey: first.accountKeyHmac,
            ownerId: first.runId,
            leaseToken: first.accountLease.leaseToken
        });
        expectCode(() => orchestrator.beginRun(runInput({
            runId: 'run-2',
            laneId: 'LOADER_SAME_CONTEXT_UI',
            automationOwnerId: 'worker-2'
        })), 'MUTATING_COHORT_CONTAMINATION');
    });

    it('does not contaminate a cohort when run creation fails', () => {
        const orchestrator = new ExperimentOrchestrator();
        expectCode(() => orchestrator.beginRun(runInput({
            manifest: manifest({ runtimeVersion: '' })
        })), 'INVALID_INPUT');
        expect(orchestrator.beginRun(runInput({
            runId: 'run-2',
            laneId: 'LOADER_SAME_CONTEXT_UI',
            automationOwnerId: 'worker-2'
        }))).toMatchObject({ runId: 'run-2', laneId: 'LOADER_SAME_CONTEXT_UI' });
    });

    it('prevents concurrent runs for the same account across orders', () => {
        const orchestrator = new ExperimentOrchestrator();
        orchestrator.beginRun(runInput());
        expectCode(() => orchestrator.beginRun(runInput({
            experimentId: 'exp-2',
            runId: 'run-2',
            automationOwnerId: 'worker-2'
        })), 'RESOURCE_BUSY');
    });

    it('stores navigable checkout material encrypted and exports only fingerprints', () => {
        const secretUrl = 'https://pay.openai.com/c/pay/cs_test_secret123#synthetic-authority-secret';
        const vault = new EncryptedArtifactVault({ encryptionKey: Buffer.alloc(32, 7) });
        const artifact = vault.put({
            runId: 'run-secret',
            accountKeyHmac: 'account-secret',
            navigationUrl: secretUrl
        });
        expect(JSON.stringify(artifact)).not.toContain('cs_test_secret123');
        expect(JSON.stringify(artifact)).not.toContain('synthetic-authority-secret');
        expect(vault.reveal({ artifactId: artifact.artifactId, runId: 'run-secret' })).toBe(secretUrl);
        expectCode(() => vault.reveal({ artifactId: artifact.artifactId, runId: 'other-run' }), 'ARTIFACT_ACCESS_DENIED');
    });

    it('rejects a caller-provided link kind that disagrees with the parsed URL', () => {
        const vault = new EncryptedArtifactVault();
        expectCode(() => vault.put({
            runId: 'run-kind',
            accountKeyHmac: 'account-kind',
            kind: 'INTERNAL_SESSION_BOUND',
            navigationUrl: 'https://pay.openai.com/c/pay/cs_test_kind#synthetic-kind'
        }), 'CHECKOUT_KIND_MISMATCH');
    });

    it('allows only one active checkout artifact per run', () => {
        const orchestrator = new ExperimentOrchestrator();
        orchestrator.beginRun(runInput());
        const first = orchestrator.attachCheckout({
            runId: 'run-1',
            actorId: 'worker-1',
            navigationUrl: 'https://pay.openai.com/c/pay/cs_test_first#synthetic-first'
        });
        expect(first.secretRef).toMatch(/^vault:\/\//);
        expectCode(() => orchestrator.attachCheckout({
            runId: 'run-1',
            actorId: 'worker-1',
            navigationUrl: 'https://pay.openai.com/c/pay/cs_test_second#synthetic-second'
        }), 'ACTIVE_CHECKOUT_EXISTS');
    });

    it('selects fallback only before checkout creation', () => {
        const orchestrator = new ExperimentOrchestrator();
        orchestrator.beginRun(runInput());
        expect(orchestrator.selectRoute({
            runId: 'run-1',
            champion: 'HOSTED_SPLIT_CONTEXT',
            fallback: 'LOADER_SAME_CONTEXT_UI',
            championEligible: false,
            fallbackEligible: true
        })).toEqual({ selected: 'LOADER_SAME_CONTEXT_UI', reason: 'FALLBACK_PRECHECK_ELIGIBLE' });
        orchestrator.attachCheckout({
            runId: 'run-1',
            actorId: 'worker-1',
            navigationUrl: 'https://pay.openai.com/c/pay/cs_test_route#synthetic-route'
        });
        expectCode(() => orchestrator.selectRoute({
            runId: 'run-1',
            champion: 'HOSTED_SPLIT_CONTEXT',
            fallback: 'LOADER_SAME_CONTEXT_UI',
            championEligible: false,
            fallbackEligible: true
        }), 'ROUTE_FROZEN_AFTER_CHECKOUT');
    });

    it('requires an ordered control transfer before human actions', () => {
        const control = new ControlOwnership();
        control.initialize({ runId: 'run-takeover', automationOwnerId: 'worker-a' });
        control.requestTakeover({ runId: 'run-takeover', humanOwnerId: 'operator-a' });
        expectCode(() => control.assertActor({
            runId: 'run-takeover',
            actorType: 'HUMAN',
            actorId: 'operator-a'
        }), 'CONTROL_NOT_OWNED');
        control.freeze({ runId: 'run-takeover', automationOwnerId: 'worker-a' });
        control.transfer({ runId: 'run-takeover', humanOwnerId: 'operator-a' });
        expect(control.assertActor({
            runId: 'run-takeover',
            actorType: 'HUMAN',
            actorId: 'operator-a'
        }).state).toBe('TRANSFERRED');
        expectCode(() => control.assertActor({
            runId: 'run-takeover',
            actorType: 'AUTOMATION',
            actorId: 'worker-a'
        }), 'CONTROL_NOT_OWNED');
    });

    it('rejects a stale lease token after expiry and takeover', () => {
        const leases = new LeaseRegistry();
        const first = leases.acquire({
            resourceType: 'ACCOUNT',
            resourceKey: 'account-lease',
            ownerId: 'run-old',
            now: 1_000,
            ttlMs: 100
        });
        const second = leases.acquire({
            resourceType: 'ACCOUNT',
            resourceKey: 'account-lease',
            ownerId: 'run-new',
            now: 1_101,
            ttlMs: 100
        });
        expect(second.ownerId).toBe('run-new');
        expectCode(() => leases.assertOwner({
            resourceType: 'ACCOUNT',
            resourceKey: 'account-lease',
            ownerId: 'run-old',
            leaseToken: first.leaseToken,
            now: 1_102
        }), 'LEASE_NOT_OWNED');
    });
});
