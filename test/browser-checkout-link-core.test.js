'use strict';

const {
    parseCheckoutLink,
    selectCheckoutLink,
    decideCheckoutResume
} = require('../browser-poc/checkout-link-core');

describe('browser hosted checkout link contract', () => {
    it('accepts only complete hosted links as independently navigable candidates', () => {
        const result = parseCheckoutLink('https://pay.openai.com/c/pay/cs_live_abc123#fid-authority');
        expect(result.kind).toBe('HOSTED_COMPLETE');
        expect(result.urlFingerprint).toHaveLength(16);
        expect(JSON.stringify(result)).not.toContain('cs_live_abc123');
    });

    it('does not guess the authority fragment for an incomplete hosted link', () => {
        expect(parseCheckoutLink('https://pay.openai.com/c/pay/cs_live_abc123').kind)
            .toBe('HOSTED_INCOMPLETE');
    });

    it('classifies ChatGPT checkout URLs as session-bound fallbacks', () => {
        const result = parseCheckoutLink('https://chatgpt.com/checkout/openai_ie/oaics_example123');
        expect(result.kind).toBe('INTERNAL_SESSION_BOUND');
        expect(result.processorEntity).toBe('openai_ie');
    });

    it('rejects lookalike and credential-bearing URLs', () => {
        expect(parseCheckoutLink('https://pay.openai.com.evil.test/c/pay/cs_live_abc#x').kind).toBe('INVALID');
        expect(parseCheckoutLink('https://user:pass@pay.openai.com/c/pay/cs_live_abc#x').kind).toBe('INVALID');
    });

    it('prefers a Stripe-init hosted URL over an internal checkout fallback', () => {
        const selected = selectCheckoutLink({
            checkout: { checkout_url: 'https://chatgpt.com/checkout/openai_llc/cs_live_internal' },
            stripeInit: { stripe_hosted_url: 'https://checkout.stripe.com/c/pay/cs_live_hosted#fid' }
        });
        expect(selected.outcome).toBe('HOSTED_LINK_READY');
        expect(selected.source).toBe('stripe_init.stripe_hosted_url');
        expect(selected.navigationUrl).toContain('checkout.stripe.com');
        expect(JSON.stringify(selected)).not.toContain('cs_live_hosted');
    });

    it('does not report an internal short link as hosted extraction success', () => {
        const selected = selectCheckoutLink({
            checkout: { checkout_url: 'https://chatgpt.com/checkout/openai_llc/cs_live_internal' }
        });
        expect(selected.outcome).toBe('SAME_CONTEXT_FALLBACK');
    });

    it('requires reconciliation after payment may have been submitted', () => {
        expect(decideCheckoutResume({
            paymentState: 'PAYMENT_UNKNOWN',
            createdAt: new Date().toISOString()
        })).toEqual({ action: 'RECONCILE_ONLY', mayCreateCheckout: false, mayOpenLink: false });
    });

    it('requires review on expiry and allows repeated pre-payment opens without creating a second checkout', () => {
        const now = Date.now();
        expect(decideCheckoutResume({
            paymentState: 'CHECKOUT_READY',
            createdAt: new Date(now - 30 * 60 * 1000).toISOString(),
            now
        })).toEqual({
            action: 'CHECKOUT_REVIEW_REQUIRED',
            reason: 'EXPIRY_IS_NOT_INVALIDATION_PROOF',
            mayCreateCheckout: false,
            mayOpenLink: false
        });
        expect(decideCheckoutResume({
            paymentState: 'CHECKOUT_READY',
            createdAt: new Date(now).toISOString(),
            now,
            openCount: 1
        }).action).toBe('REOPEN_WITH_FRESH_OBSERVATION');
    });
});
