'use strict';

const { MockPaymentGateway } = require('../browser-poc/mock-gateway');
const { ContractError } = require('../browser-poc/experiment-core');

function expectCode(fn, code) {
    try {
        fn();
        throw new Error(`expected ${code}`);
    } catch (error) {
        expect(error).toBeInstanceOf(ContractError);
        expect(error.code).toBe(code);
    }
}

describe('offline payment mock gateway', () => {
    it.each([
        ['SAFE_DECLINE', 'DECLINED_SAFE'],
        ['SUBMIT_UNKNOWN', 'PAYMENT_UNKNOWN'],
        ['SUCCESS', 'ENTITLEMENT_CONFIRMED'],
        ['REQUIRES_3DS', 'REQUIRES_3DS'],
        ['CANCELLATION_PENDING', 'CANCELLATION_PENDING']
    ])('models %s as %s without external I/O', (scenario, expectedStatus) => {
        const gateway = new MockPaymentGateway();
        const checkout = gateway.createCheckout({ accountKeyHmac: 'account-a', scenario });
        const result = gateway.submit({ checkoutId: checkout.checkoutId, permitNonce: 'permit-a' });
        expect(result.status).toBe(expectedStatus);
        expect(result.checkoutIdHash).toHaveLength(64);
        expect(JSON.stringify(result)).not.toContain(checkout.checkoutId);
    });

    it('consumes the simulated payment submit only once', () => {
        const gateway = new MockPaymentGateway();
        const checkout = gateway.createCheckout({ accountKeyHmac: 'account-a', scenario: 'SUBMIT_UNKNOWN' });
        gateway.submit({ checkoutId: checkout.checkoutId, permitNonce: 'permit-a' });
        expectCode(() => gateway.submit({ checkoutId: checkout.checkoutId, permitNonce: 'permit-b' }), 'MOCK_SUBMIT_ALREADY_CONSUMED');
        expect(gateway.submitCalls).toBe(1);
    });

    it('keeps unknown results unknown across polling', () => {
        const gateway = new MockPaymentGateway();
        const checkout = gateway.createCheckout({ accountKeyHmac: 'account-a', scenario: 'SUBMIT_UNKNOWN' });
        gateway.submit({ checkoutId: checkout.checkoutId, permitNonce: 'permit-a' });
        expect(gateway.poll(checkout.checkoutId).status).toBe('PAYMENT_UNKNOWN');
        expect(gateway.poll(checkout.checkoutId).pollCount).toBe(2);
        expect(gateway.submitCalls).toBe(1);
    });

    it('models 3DS and cancellation as separate resumable phases', () => {
        const gateway = new MockPaymentGateway();
        const checkout = gateway.createCheckout({ accountKeyHmac: 'account-a', scenario: 'REQUIRES_3DS' });
        const submitted = gateway.submit({ checkoutId: checkout.checkoutId, permitNonce: 'permit-submit' });
        expect(gateway.complete3ds({
            checkoutId: checkout.checkoutId,
            authorizationRef: submitted.authorizationRef
        }).status)
            .toBe('ENTITLEMENT_CONFIRMED');
        expect(gateway.confirmCancellation(checkout.checkoutId).status).toBe('DELIVERY_COMPLETE');
        expect(gateway.submitCalls).toBe(1);
    });
});
