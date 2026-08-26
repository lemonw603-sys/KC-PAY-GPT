#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppendOnlyWal } = require('./experiment-wal');
const { ExperimentOrchestrator } = require('./experiment-core');
const { WalBackedExperimentCoordinator } = require('./wal-backed-experiment');
const { MockPaymentGateway } = require('./mock-gateway');

const SCENARIO_CYCLE = Object.freeze([
    'SUCCESS',
    'REQUIRES_3DS',
    'CANCELLATION_PENDING',
    'SAFE_DECLINE',
    'SUBMIT_UNKNOWN'
]);

function runCapacitySimulation({ orderCount = 350, workingDirectory } = {}) {
    if (!Number.isInteger(orderCount) || orderCount < 1) throw new Error('orderCount must be a positive integer');
    const ownedDirectory = !workingDirectory;
    const directory = workingDirectory || fs.mkdtempSync(path.join(os.tmpdir(), 'browser-capacity-'));
    const wal = new AppendOnlyWal({ filePath: path.join(directory, 'capacity.wal.jsonl') });
    const coordinator = new WalBackedExperimentCoordinator({
        wal,
        orchestrator: new ExperimentOrchestrator()
    });
    const gateway = new MockPaymentGateway();
    const counts = {};
    const startedAt = process.hrtime.bigint();

    try {
        for (let index = 0; index < orderCount; index += 1) {
            const ordinal = index + 1;
            const runId = `capacity-run-${String(ordinal).padStart(4, '0')}`;
            const accountKeyHmac = `capacity-account-${String(ordinal).padStart(4, '0')}`;
            const scenario = SCENARIO_CYCLE[index % SCENARIO_CYCLE.length];
            coordinator.beginRun({
                experimentId: 'capacity-24h-equivalent-v1',
                runId,
                scope: 'CHECKOUT_MUTATING',
                laneId: 'HOSTED_SPLIT_CONTEXT',
                cohortId: `capacity-cohort-${ordinal}`,
                accountKeyHmac,
                automationOwnerId: `capacity-worker-${ordinal % 8}`,
                manifest: {
                    runtimeId: 'MOCK_RUNTIME',
                    runtimeVersion: '1',
                    adapterVersion: 'capacity-simulation-v1',
                    networkLevel: 'OFFLINE',
                    networkLeaseHmac: `capacity-network-${ordinal}`,
                    locale: 'en-US',
                    timezone: 'Asia/Manila',
                    sessionMaterialPolicy: 'SYNTHETIC'
                }
            });
            coordinator.selectRoute({
                runId,
                champion: 'HOSTED_SPLIT_CONTEXT',
                fallback: 'LOADER_SAME_CONTEXT_UI',
                championEligible: true,
                fallbackEligible: true
            });
            const checkout = gateway.createCheckout({ accountKeyHmac, scenario });
            coordinator.attachCheckout({
                runId,
                actorId: `capacity-worker-${ordinal % 8}`,
                navigationUrl: checkout.navigationUrl,
                kind: checkout.linkKind
            });
            const submitted = coordinator.submitPayment({
                runId,
                submit: () => gateway.submit({
                    checkoutId: checkout.checkoutId,
                    permitNonce: `synthetic-permit-${ordinal}`
                })
            });
            let status = submitted.result.status;
            if (status === 'REQUIRES_3DS') {
                status = gateway.complete3ds({
                    checkoutId: checkout.checkoutId,
                    authorizationRef: submitted.result.authorizationRef
                }).status;
                coordinator.recordPaymentState({ runId, paymentState: status }, {
                    operationId: `${runId}:3ds-continuation`
                });
            }
            if (['ENTITLEMENT_CONFIRMED', 'CANCELLATION_PENDING'].includes(status)) {
                status = gateway.confirmCancellation(checkout.checkoutId).status;
                coordinator.recordPaymentState({ runId, paymentState: status }, {
                    operationId: `${runId}:cancellation`
                });
            }
            const recovered = coordinator.recover(runId);
            if (recovered.maySubmitPayment) throw new Error(`unsafe recovery for ${runId}`);
            counts[recovered.paymentState] = (counts[recovered.paymentState] || 0) + 1;
        }

        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const events = wal.readAll();
        return Object.freeze({
            simulatedWindowHours: 24,
            orderCount,
            completedRuns: orderCount,
            submitCalls: gateway.submitCalls,
            duplicateSubmitCalls: gateway.submitCalls - orderCount,
            walEventCount: events.length,
            walBytes: fs.statSync(wal.filePath).size,
            elapsedMs: Number(elapsedMs.toFixed(2)),
            ordersPerSecond: Number((orderCount / (elapsedMs / 1000)).toFixed(2)),
            finalPaymentStates: Object.freeze({ ...counts }),
            allRecoveriesBlockResubmit: true,
            externalIo: false,
            realSessionUsed: false,
            realPaymentSubmitted: false
        });
    } finally {
        if (ownedDirectory) fs.rmSync(directory, { recursive: true, force: true });
    }
}

if (require.main === module) {
    const orderCount = Number(process.argv[2] || 350);
    process.stdout.write(`${JSON.stringify(runCapacitySimulation({ orderCount }), null, 2)}\n`);
}

module.exports = { runCapacitySimulation };
