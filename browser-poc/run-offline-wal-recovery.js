#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runOfflineExperiment } = require('./run-offline-experiment');
const { AppendOnlyWal, recoverRunState } = require('./experiment-wal');

function runOfflineWalRecovery({ workingDirectory } = {}) {
    const ownedDirectory = !workingDirectory;
    const directory = workingDirectory || fs.mkdtempSync(path.join(os.tmpdir(), 'browser-wal-demo-'));
    const walPath = path.join(directory, 'browser-runs.wal.jsonl');
    try {
        const result = runOfflineExperiment({ scenario: 'SUBMIT_UNKNOWN' });
        const wal = new AppendOnlyWal({ filePath: walPath });
        const runId = result.run.runId;
        wal.append({
            runId,
            eventType: 'RUN_STARTED',
            payload: {
                scope: result.run.scope,
                laneId: result.run.laneId,
                manifestHash: result.run.manifest.manifestSha256
            }
        });
        wal.append({
            runId,
            eventType: 'ROUTE_SELECTED',
            payload: { route: result.route.selected }
        });
        wal.append({
            runId,
            eventType: 'CHECKOUT_ATTACHED',
            payload: {
                checkoutArtifact: {
                    artifactId: result.run.checkoutArtifact.artifactId,
                    secretRef: result.run.checkoutArtifact.secretRef,
                    kind: result.run.checkoutArtifact.kind,
                    urlHash: result.run.checkoutArtifact.urlHash,
                    checkoutHash: result.run.checkoutArtifact.checkoutHash
                }
            }
        });
        wal.append({
            runId,
            eventType: 'PAYMENT_STATE_CHANGED',
            payload: { paymentState: result.run.paymentState }
        });

        const restartedProcess = new AppendOnlyWal({ filePath: walPath });
        const events = restartedProcess.readAll();
        return Object.freeze({
            wal: restartedProcess.head(),
            eventCount: events.length,
            recovered: recoverRunState(events, runId),
            externalIo: false,
            realSessionUsed: false,
            realPaymentSubmitted: false
        });
    } finally {
        if (ownedDirectory) fs.rmSync(directory, { recursive: true, force: true });
    }
}

if (require.main === module) {
    process.stdout.write(`${JSON.stringify(runOfflineWalRecovery(), null, 2)}\n`);
}

module.exports = { runOfflineWalRecovery };
