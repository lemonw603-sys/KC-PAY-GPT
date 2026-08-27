'use strict';

const { runOfflineWalRecovery } = require('../browser-poc/run-offline-wal-recovery');

describe('offline WAL recovery demo', () => {
    it('recovers an unknown payment as reconciliation-only without leaking checkout authority', () => {
        const result = runOfflineWalRecovery();
        expect(result.eventCount).toBe(4);
        expect(result.wal.sequence).toBe(4);
        expect(result.recovered).toMatchObject({
            paymentState: 'PAYMENT_UNKNOWN',
            mayCreateCheckout: false,
            maySubmitPayment: false,
            recoveryAction: 'RECONCILE_ONLY'
        });
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('pay.openai.com');
        expect(serialized).not.toContain('synthetic-authority');
        expect(serialized).not.toMatch(/cs_test_[A-Za-z0-9_-]+/);
        expect(result.externalIo).toBe(false);
        expect(result.realPaymentSubmitted).toBe(false);
    });
});
