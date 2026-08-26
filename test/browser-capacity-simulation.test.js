'use strict';

const { runCapacitySimulation } = require('../browser-poc/run-capacity-simulation');

describe('browser synthetic capacity simulation', () => {
    it('processes at least 350 synthetic orders without a duplicate payment submission', () => {
        const result = runCapacitySimulation({ orderCount: 350 });
        expect(result.orderCount).toBeGreaterThanOrEqual(350);
        expect(result.completedRuns).toBe(result.orderCount);
        expect(result.submitCalls).toBe(result.orderCount);
        expect(result.duplicateSubmitCalls).toBe(0);
        expect(result.allRecoveriesBlockResubmit).toBe(true);
        expect(result.externalIo).toBe(false);
        expect(result.realSessionUsed).toBe(false);
        expect(result.realPaymentSubmitted).toBe(false);
        expect(Object.values(result.finalPaymentStates).reduce((sum, count) => sum + count, 0)).toBe(350);
    }, 120_000);
});
