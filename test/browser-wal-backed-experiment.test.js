'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');
const { AppendOnlyWal } = require('../browser-poc/experiment-wal');
const { ExperimentOrchestrator, ContractError } = require('../browser-poc/experiment-core');
const { MockPaymentGateway } = require('../browser-poc/mock-gateway');
const { WalBackedExperimentCoordinator } = require('../browser-poc/wal-backed-experiment');

const tempDirs = [];

function fixture(faultInjector = null) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-durable-test-'));
    tempDirs.push(directory);
    const wal = new AppendOnlyWal({ filePath: path.join(directory, 'runs.wal.jsonl') });
    const orchestrator = new ExperimentOrchestrator();
    return {
        wal,
        orchestrator,
        coordinator: new WalBackedExperimentCoordinator({ wal, orchestrator, faultInjector })
    };
}

function runInput(runId = 'run-1', overrides = {}) {
    return {
        experimentId: 'durable-exp-1',
        runId,
        scope: 'CHECKOUT_MUTATING',
        laneId: 'HOSTED_SPLIT_CONTEXT',
        cohortId: `cohort-${runId}`,
        accountKeyHmac: `account-${runId}`,
        automationOwnerId: `worker-${runId}`,
        manifest: {
            runtimeId: 'MOCK_RUNTIME',
            runtimeVersion: '1',
            adapterVersion: 'durable-test',
            networkLevel: 'OFFLINE',
            networkLeaseHmac: `network-${runId}`,
            locale: 'en-US',
            timezone: 'Asia/Manila',
            sessionMaterialPolicy: 'SYNTHETIC'
        },
        ...overrides
    };
}

function prepareCheckout(coordinator, gateway, runId = 'run-1', now = Date.now()) {
    coordinator.beginRun(runInput(runId), { now });
    coordinator.selectRoute({
        runId,
        champion: 'HOSTED_SPLIT_CONTEXT',
        fallback: 'LOADER_SAME_CONTEXT_UI',
        championEligible: true,
        fallbackEligible: true
    });
    const checkout = gateway.createCheckout({ accountKeyHmac: `account-${runId}`, scenario: 'SUCCESS' });
    coordinator.attachCheckout({
        runId,
        actorId: `worker-${runId}`,
        navigationUrl: checkout.navigationUrl,
        kind: checkout.linkKind
    }, { now });
    return checkout;
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

afterEach(() => {
    while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe('WAL-backed browser experiment coordinator', () => {
    it('writes intent before every mutation and a completion event afterwards', () => {
        const { coordinator, wal } = fixture();
        const gateway = new MockPaymentGateway();
        const checkout = prepareCheckout(coordinator, gateway);
        coordinator.submitPayment({
            runId: 'run-1',
            submit: () => gateway.submit({ checkoutId: checkout.checkoutId, permitNonce: 'synthetic-permit' })
        });

        const events = wal.readAll();
        const prepared = events.filter((event) => event.eventType === 'OPERATION_PREPARED');
        expect(prepared.map((event) => event.payload.operationType)).toEqual([
            'RUN_BEGIN', 'ROUTE_SELECT', 'CHECKOUT_ATTACH', 'PAYMENT_SUBMIT'
        ]);
        expect(coordinator.recover('run-1')).toMatchObject({
            paymentState: 'ENTITLEMENT_CONFIRMED',
            mayCreateCheckout: false,
            maySubmitPayment: false,
            recoveryAction: 'CANCELLATION_ONLY'
        });
    });

    it('deduplicates a completed payment operation without calling the gateway twice', () => {
        const { coordinator } = fixture();
        const gateway = new MockPaymentGateway();
        const checkout = prepareCheckout(coordinator, gateway);
        const input = {
            runId: 'run-1',
            submit: () => gateway.submit({ checkoutId: checkout.checkoutId, permitNonce: 'synthetic-permit' })
        };
        coordinator.submitPayment(input, { operationId: 'stable-payment-operation' });
        const replay = coordinator.submitPayment(input, { operationId: 'stable-payment-operation' });
        expect(replay.idempotentReplay).toBe(true);
        expect(gateway.submitCalls).toBe(1);
    });

    it.each([
        ['BEFORE_EXTERNAL_ACTION', 0],
        ['AFTER_EXTERNAL_ACTION', 1]
    ])('fails closed after a %s crash and never replays payment', (crashPoint, expectedCalls) => {
        const crash = ({ point, operationType }) => {
            if (operationType === 'PAYMENT_SUBMIT' && point === crashPoint) {
                throw new ContractError('SIMULATED_CRASH');
            }
        };
        const { wal, coordinator } = fixture(crash);
        const gateway = new MockPaymentGateway();
        const checkout = prepareCheckout(coordinator, gateway);
        const operationId = 'crash-payment-operation';
        expectCode(() => coordinator.submitPayment({
            runId: 'run-1',
            submit: () => gateway.submit({ checkoutId: checkout.checkoutId, permitNonce: 'synthetic-permit' })
        }, { operationId }), 'SIMULATED_CRASH');

        const restarted = new WalBackedExperimentCoordinator({ wal });
        expect(restarted.recover('run-1')).toMatchObject({
            status: 'REVIEW_REQUIRED',
            paymentState: 'PAYMENT_UNKNOWN',
            maySubmitPayment: false,
            recoveryAction: 'RECONCILE_ONLY'
        });
        expectCode(() => restarted.submitPayment({
            runId: 'run-1',
            submit: () => {
                throw new Error('must not execute');
            }
        }, { operationId }), 'OPERATION_OUTCOME_UNKNOWN');
        expect(gateway.submitCalls).toBe(expectedCalls);
    });

    it('turns a crash after checkout mutation into review instead of creating another artifact', () => {
        const crash = ({ point, operationType }) => {
            if (operationType === 'CHECKOUT_ATTACH' && point === 'AFTER_APPLY') {
                throw new ContractError('SIMULATED_CRASH');
            }
        };
        const { wal, coordinator } = fixture(crash);
        const gateway = new MockPaymentGateway();
        coordinator.beginRun(runInput());
        const checkout = gateway.createCheckout({ accountKeyHmac: 'account-run-1', scenario: 'SUCCESS' });
        expectCode(() => coordinator.attachCheckout({
            runId: 'run-1',
            actorId: 'worker-run-1',
            navigationUrl: checkout.navigationUrl,
            kind: checkout.linkKind
        }, { operationId: 'checkout-crash' }), 'SIMULATED_CRASH');

        const restarted = new WalBackedExperimentCoordinator({ wal });
        expect(restarted.recover('run-1')).toMatchObject({
            status: 'REVIEW_REQUIRED',
            mayCreateCheckout: false,
            maySubmitPayment: false,
            recoveryAction: 'CHECKOUT_REVIEW_REQUIRED'
        });
        expectCode(() => restarted.attachCheckout({
            runId: 'run-1',
            navigationUrl: checkout.navigationUrl
        }, { operationId: 'checkout-crash' }), 'OPERATION_OUTCOME_UNKNOWN');
    });

    it('aborts an expired-lease operation without leaving a pending WAL intent', () => {
        const { coordinator } = fixture();
        const gateway = new MockPaymentGateway();
        coordinator.beginRun(runInput('run-expired', { leaseTtlMs: 100 }), { now: 1_000 });
        const checkout = gateway.createCheckout({ accountKeyHmac: 'account-run-expired', scenario: 'SUCCESS' });
        expectCode(() => coordinator.attachCheckout({
            runId: 'run-expired',
            actorId: 'worker-run-expired',
            navigationUrl: checkout.navigationUrl,
            kind: checkout.linkKind
        }, { operationId: 'expired-checkout', now: 1_101 }), 'LEASE_EXPIRED');
        expect(coordinator.recover('run-expired')).toMatchObject({
            status: 'RUNNING',
            mayCreateCheckout: true,
            paymentState: 'NOT_STARTED'
        });
    });

    it('blocks both actors when a takeover crashes after automation is frozen', () => {
        const crash = ({ point, operationType }) => {
            if (operationType === 'CONTROL_FREEZE' && point === 'AFTER_APPLY') {
                throw new ContractError('SIMULATED_CRASH');
            }
        };
        const { coordinator, orchestrator, wal } = fixture(crash);
        coordinator.beginRun(runInput());
        coordinator.requestTakeover({ runId: 'run-1', humanOwnerId: 'operator-1' });
        expectCode(() => coordinator.freezeControl({
            runId: 'run-1',
            automationOwnerId: 'worker-run-1'
        }), 'SIMULATED_CRASH');
        expectCode(() => orchestrator.control.assertActor({
            runId: 'run-1', actorType: 'AUTOMATION', actorId: 'worker-run-1'
        }), 'CONTROL_NOT_OWNED');
        expectCode(() => orchestrator.control.assertActor({
            runId: 'run-1', actorType: 'HUMAN', actorId: 'operator-1'
        }), 'CONTROL_NOT_OWNED');
        expect(new WalBackedExperimentCoordinator({ wal }).recover('run-1')).toMatchObject({
            status: 'REVIEW_REQUIRED',
            mayCreateCheckout: false,
            maySubmitPayment: false,
            recoveryAction: 'INCOMPLETE_OPERATION_REVIEW_REQUIRED'
        });
    });

    it('holds the at-most-once payment invariant across random crash and redelivery schedules', () => {
        fc.assert(fc.property(
            fc.constantFrom('NONE', 'BEFORE_EXTERNAL_ACTION', 'AFTER_EXTERNAL_ACTION'),
            fc.integer({ min: 1, max: 5 }),
            (crashPoint, redeliveries) => {
                const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-property-'));
                try {
                    const wal = new AppendOnlyWal({ filePath: path.join(directory, 'runs.wal.jsonl') });
                    const gateway = new MockPaymentGateway();
                    const faultInjector = crashPoint === 'NONE' ? null : ({ point, operationType }) => {
                        if (operationType === 'PAYMENT_SUBMIT' && point === crashPoint) {
                            throw new ContractError('SIMULATED_CRASH');
                        }
                    };
                    const coordinator = new WalBackedExperimentCoordinator({ wal, faultInjector });
                    const checkout = prepareCheckout(coordinator, gateway, 'property-run');
                    const operationId = 'property-payment';
                    try {
                        coordinator.submitPayment({
                            runId: 'property-run',
                            submit: () => gateway.submit({ checkoutId: checkout.checkoutId, permitNonce: 'permit' })
                        }, { operationId });
                    } catch (error) {
                        if (error.code !== 'SIMULATED_CRASH') throw error;
                    }
                    for (let index = 0; index < redeliveries; index += 1) {
                        const restarted = new WalBackedExperimentCoordinator({ wal });
                        try {
                            restarted.submitPayment({
                                runId: 'property-run',
                                submit: () => {
                                    throw new Error('redelivery must not invoke submit');
                                }
                            }, { operationId });
                        } catch (error) {
                            if (error.code !== 'OPERATION_OUTCOME_UNKNOWN') throw error;
                        }
                    }
                    expect(gateway.submitCalls).toBeLessThanOrEqual(1);
                    expect(new WalBackedExperimentCoordinator({ wal }).recover('property-run').maySubmitPayment).toBe(false);
                } finally {
                    fs.rmSync(directory, { recursive: true, force: true });
                }
            }
        ), { numRuns: 50 });
    });
});
