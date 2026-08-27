'use strict';

const { runOfflineExperiment } = require('../browser-poc/run-offline-experiment');

describe('offline browser experiment runner', () => {
    it('produces a redacted unknown-payment evidence bundle without external I/O', () => {
        const result = runOfflineExperiment({ scenario: 'SUBMIT_UNKNOWN' });
        expect(result.route.selected).toBe('HOSTED_SPLIT_CONTEXT');
        expect(result.run.paymentState).toBe('PAYMENT_UNKNOWN');
        expect(result.run.simulatedPaymentActionConsumed).toBe(true);
        expect(result.gateway.submitConsumed).toBe(true);
        expect(result.externalIo).toBe(false);
        expect(result.realSessionUsed).toBe(false);
        expect(result.realPaymentSubmitted).toBe(false);
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('pay.openai.com');
        expect(serialized).not.toContain('synthetic-authority');
        expect(serialized).not.toMatch(/cs_test_[A-Za-z0-9_-]+/);
    });
});
