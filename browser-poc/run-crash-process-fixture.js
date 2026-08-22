#!/usr/bin/env node
'use strict';

const { AppendOnlyWal } = require('./experiment-wal');
const { WalBackedExperimentCoordinator } = require('./wal-backed-experiment');
const { MockPaymentGateway } = require('./mock-gateway');

const walPath = process.argv[2];
if (!walPath) process.exit(64);

const wal = new AppendOnlyWal({ filePath: walPath });
const coordinator = new WalBackedExperimentCoordinator({
    wal,
    faultInjector: ({ point, operationType }) => {
        if (operationType === 'PAYMENT_SUBMIT' && point === 'BEFORE_EXTERNAL_ACTION') {
            process.exit(77);
        }
    }
});
const gateway = new MockPaymentGateway();
const runId = 'process-crash-run';
coordinator.beginRun({
    experimentId: 'process-crash-exp',
    runId,
    scope: 'CHECKOUT_MUTATING',
    laneId: 'HOSTED_SPLIT_CONTEXT',
    cohortId: 'process-crash-cohort',
    accountKeyHmac: 'process-crash-account',
    automationOwnerId: 'process-crash-worker',
    manifest: {
        runtimeId: 'MOCK_RUNTIME',
        runtimeVersion: '1',
        adapterVersion: 'process-crash-fixture',
        networkLevel: 'OFFLINE',
        networkLeaseHmac: 'process-crash-network',
        locale: 'en-US',
        timezone: 'Asia/Manila',
        sessionMaterialPolicy: 'SYNTHETIC'
    }
});
const checkout = gateway.createCheckout({ accountKeyHmac: 'process-crash-account', scenario: 'SUCCESS' });
coordinator.attachCheckout({
    runId,
    actorId: 'process-crash-worker',
    navigationUrl: checkout.navigationUrl,
    kind: checkout.linkKind
});
coordinator.submitPayment({
    runId,
    submit: () => gateway.submit({ checkoutId: checkout.checkoutId, permitNonce: 'synthetic-permit' })
}, { operationId: 'process-crash-payment' });
