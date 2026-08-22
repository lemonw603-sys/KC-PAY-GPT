'use strict';

const crypto = require('node:crypto');
const { ContractError } = require('./experiment-core');

const SCENARIOS = new Set([
    'SAFE_DECLINE',
    'SUBMIT_UNKNOWN',
    'SUCCESS',
    'REQUIRES_3DS',
    'CANCELLATION_PENDING'
]);

class MockPaymentGateway {
    constructor() {
        this.checkouts = new Map();
        this.submitCalls = 0;
    }

    createCheckout({ accountKeyHmac, scenario = 'SUCCESS', linkKind = 'HOSTED_COMPLETE' }) {
        if (!SCENARIOS.has(scenario)) throw new ContractError('INVALID_MOCK_SCENARIO');
        const checkoutId = `cs_test_${crypto.randomBytes(10).toString('hex')}`;
        const navigationUrl = linkKind === 'INTERNAL_SESSION_BOUND'
            ? `https://chatgpt.com/checkout/openai_mock/${checkoutId}`
            : `https://pay.openai.com/c/pay/${checkoutId}#synthetic-authority-${crypto.randomBytes(6).toString('hex')}`;
        const record = {
            checkoutId,
            accountKeyHmac,
            scenario,
            linkKind,
            navigationUrl,
            status: 'CREATED',
            submitConsumed: false,
            authorizationRef: null,
            pollCount: 0
        };
        this.checkouts.set(checkoutId, record);
        return Object.freeze({ checkoutId, navigationUrl, linkKind });
    }

    submit({ checkoutId, permitNonce }) {
        const record = this.#record(checkoutId);
        if (!permitNonce) throw new ContractError('MOCK_PERMIT_REQUIRED');
        if (record.submitConsumed) throw new ContractError('MOCK_SUBMIT_ALREADY_CONSUMED');
        record.submitConsumed = true;
        record.authorizationRef = `authorization_${crypto.randomBytes(12).toString('hex')}`;
        this.submitCalls += 1;

        if (record.scenario === 'SAFE_DECLINE') record.status = 'DECLINED_SAFE';
        if (record.scenario === 'SUBMIT_UNKNOWN') record.status = 'PAYMENT_UNKNOWN';
        if (record.scenario === 'SUCCESS') record.status = 'ENTITLEMENT_CONFIRMED';
        if (record.scenario === 'REQUIRES_3DS') record.status = 'REQUIRES_3DS';
        if (record.scenario === 'CANCELLATION_PENDING') record.status = 'CANCELLATION_PENDING';

        return this.observe(checkoutId);
    }

    complete3ds({ checkoutId, authorizationRef }) {
        const record = this.#record(checkoutId);
        if (!authorizationRef || authorizationRef !== record.authorizationRef) {
            throw new ContractError('MOCK_AUTHORIZATION_MISMATCH');
        }
        if (record.status !== 'REQUIRES_3DS') throw new ContractError('MOCK_3DS_NOT_REQUIRED');
        record.status = 'ENTITLEMENT_CONFIRMED';
        return this.observe(checkoutId);
    }

    confirmCancellation(checkoutId) {
        const record = this.#record(checkoutId);
        if (!['ENTITLEMENT_CONFIRMED', 'CANCELLATION_PENDING'].includes(record.status)) {
            throw new ContractError('MOCK_CANCELLATION_NOT_ALLOWED');
        }
        record.status = 'DELIVERY_COMPLETE';
        return this.observe(checkoutId);
    }

    poll(checkoutId) {
        const record = this.#record(checkoutId);
        record.pollCount += 1;
        return this.observe(checkoutId);
    }

    observe(checkoutId) {
        const record = this.#record(checkoutId);
        return Object.freeze({
            checkoutIdHash: crypto.createHash('sha256').update(record.checkoutId).digest('hex'),
            status: record.status,
            submitConsumed: record.submitConsumed,
            authorizationRef: record.authorizationRef,
            pollCount: record.pollCount
        });
    }

    #record(checkoutId) {
        const record = this.checkouts.get(checkoutId);
        if (!record) throw new ContractError('MOCK_CHECKOUT_NOT_FOUND');
        return record;
    }
}

module.exports = { MockPaymentGateway };
