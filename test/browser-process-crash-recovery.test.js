'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AppendOnlyWal } = require('../browser-poc/experiment-wal');
const { WalBackedExperimentCoordinator } = require('../browser-poc/wal-backed-experiment');
const { ContractError } = require('../browser-poc/experiment-core');

describe('browser process crash recovery', () => {
    it('recovers a real child-process exit before the external action as reconcile-only', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-process-crash-'));
        try {
            const walPath = path.join(directory, 'runs.wal.jsonl');
            const child = spawnSync(process.execPath, [
                path.resolve(__dirname, '../browser-poc/run-crash-process-fixture.js'),
                walPath
            ], { encoding: 'utf8' });
            expect(child.status).toBe(77);
            const wal = new AppendOnlyWal({ filePath: walPath });
            const restarted = new WalBackedExperimentCoordinator({ wal });
            expect(restarted.recover('process-crash-run')).toMatchObject({
                status: 'REVIEW_REQUIRED',
                paymentState: 'PAYMENT_UNKNOWN',
                mayCreateCheckout: false,
                maySubmitPayment: false,
                recoveryAction: 'RECONCILE_ONLY'
            });
            expect(() => restarted.submitPayment({
                runId: 'process-crash-run',
                submit: () => {
                    throw new Error('must not submit after restart');
                }
            }, { operationId: 'process-crash-payment' })).toThrowError(expect.objectContaining({
                code: 'OPERATION_OUTCOME_UNKNOWN'
            }));
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
