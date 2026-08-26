#!/usr/bin/env node
'use strict';

const { ExperimentOrchestrator } = require('./experiment-core');
const { MockPaymentGateway } = require('./mock-gateway');

function runOfflineExperiment({ scenario = 'SUBMIT_UNKNOWN' } = {}) {
    const orchestrator = new ExperimentOrchestrator();
    const gateway = new MockPaymentGateway();
    const runId = 'offline-run-001';
    const accountKeyHmac = 'synthetic-account-hmac';

    orchestrator.beginRun({
        experimentId: 'offline-control-plane-v1',
        runId,
        scope: 'CHECKOUT_MUTATING',
        laneId: 'HOSTED_SPLIT_CONTEXT',
        cohortId: 'synthetic-cohort-a',
        accountKeyHmac,
        automationOwnerId: 'offline-worker-1',
        manifest: {
            runtimeId: 'MOCK_RUNTIME',
            runtimeVersion: '1',
            adapterVersion: 'offline-control-plane-v1',
            networkLevel: 'OFFLINE',
            networkLeaseHmac: 'synthetic-network-lease-hmac',
            locale: 'en-US',
            timezone: 'Asia/Manila',
            sessionMaterialPolicy: 'SYNTHETIC'
        }
    });

    const route = orchestrator.selectRoute({
        runId,
        champion: 'HOSTED_SPLIT_CONTEXT',
        fallback: 'LOADER_SAME_CONTEXT_UI',
        championEligible: true,
        fallbackEligible: true
    });
    const checkout = gateway.createCheckout({ accountKeyHmac, scenario });
    orchestrator.attachCheckout({
        runId,
        actorId: 'offline-worker-1',
        navigationUrl: checkout.navigationUrl,
        kind: checkout.linkKind
    });
    const payment = gateway.submit({
        checkoutId: checkout.checkoutId,
        permitNonce: 'synthetic-single-use-permit'
    });
    orchestrator.markPaymentState({ runId, paymentState: payment.status });

    return Object.freeze({
        route,
        run: orchestrator.publicEvidence(runId),
        gateway: payment,
        externalIo: false,
        realSessionUsed: false,
        realPaymentSubmitted: false
    });
}

if (require.main === module) {
    const scenario = process.argv[2] || 'SUBMIT_UNKNOWN';
    process.stdout.write(`${JSON.stringify(runOfflineExperiment({ scenario }), null, 2)}\n`);
}

module.exports = { runOfflineExperiment };
