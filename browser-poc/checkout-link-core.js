'use strict';

const crypto = require('node:crypto');

const HOSTED_HOSTS = new Set(['pay.openai.com', 'checkout.stripe.com']);
const INTERNAL_HOST = 'chatgpt.com';
const CHECKOUT_ID_PATTERN = /^(?:cs_(?:live|test)_[A-Za-z0-9_-]+|oaics_[A-Za-z0-9_-]+)$/;
const PAYMENT_UNCERTAIN_STATES = new Set([
    'PAYMENT_SUBMITTING',
    'PAYMENT_UNKNOWN',
    'ACTIVATION_CONFIRMED',
    'CANCELLATION_PENDING',
    'COMPLETED'
]);

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseCheckoutLink(rawUrl) {
    let url;
    try {
        url = new URL(String(rawUrl || ''));
    } catch {
        return Object.freeze({ kind: 'INVALID', reason: 'MALFORMED_URL' });
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
        return Object.freeze({ kind: 'INVALID', reason: 'UNSAFE_URL' });
    }

    const host = url.hostname.toLowerCase();
    if (HOSTED_HOSTS.has(host)) {
        const match = url.pathname.match(/^\/c\/pay\/(cs_(?:live|test)_[A-Za-z0-9_-]+)\/?$/);
        if (!match) return Object.freeze({ kind: 'INVALID', reason: 'INVALID_HOSTED_PATH' });
        if (!url.hash || url.hash.length < 2) {
            return Object.freeze({
                kind: 'HOSTED_INCOMPLETE',
                reason: 'MISSING_AUTHORITY_FRAGMENT',
                checkoutIdFingerprint: sha256(match[1]).slice(0, 16)
            });
        }
        return Object.freeze({
            kind: 'HOSTED_COMPLETE',
            host,
            checkoutIdFingerprint: sha256(match[1]).slice(0, 16),
            urlFingerprint: sha256(url.href).slice(0, 16)
        });
    }

    if (host === INTERNAL_HOST) {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] !== 'checkout' || ![2, 3].includes(parts.length)) {
            return Object.freeze({ kind: 'INVALID', reason: 'INVALID_INTERNAL_PATH' });
        }
        const checkoutId = parts.at(-1);
        if (!CHECKOUT_ID_PATTERN.test(checkoutId)) {
            return Object.freeze({ kind: 'INVALID', reason: 'INVALID_CHECKOUT_ID' });
        }
        return Object.freeze({
            kind: 'INTERNAL_SESSION_BOUND',
            host,
            processorEntity: parts.length === 3 ? parts[1] : null,
            checkoutIdFingerprint: sha256(checkoutId).slice(0, 16),
            urlFingerprint: sha256(url.href).slice(0, 16)
        });
    }

    return Object.freeze({ kind: 'INVALID', reason: 'UNAPPROVED_HOST' });
}

function selectCheckoutLink(payload = {}) {
    const candidates = [
        ['stripe_init.stripe_hosted_url', payload.stripeInit?.stripe_hosted_url],
        ['stripe_init.hosted_url', payload.stripeInit?.hosted_url],
        ['stripe_init.url', payload.stripeInit?.url],
        ['checkout.stripe_hosted_url', payload.checkout?.stripe_hosted_url],
        ['checkout.hosted_url', payload.checkout?.hosted_url],
        ['checkout.url', payload.checkout?.url],
        ['checkout.checkout_url', payload.checkout?.checkout_url]
    ].filter(([, value]) => typeof value === 'string' && value.trim());

    const classified = candidates.map(([source, value]) => ({
        source,
        rawUrl: value.trim(),
        classification: parseCheckoutLink(value)
    }));
    const selected = classified.find((item) => item.classification.kind === 'HOSTED_COMPLETE')
        || classified.find((item) => item.classification.kind === 'INTERNAL_SESSION_BOUND')
        || classified.find((item) => item.classification.kind === 'HOSTED_INCOMPLETE');

    if (!selected) {
        return Object.freeze({
            outcome: 'NO_NAVIGABLE_LINK',
            candidateCount: classified.length,
            reasons: classified.map((item) => item.classification.reason).filter(Boolean)
        });
    }
    const result = {
        outcome: selected.classification.kind === 'HOSTED_COMPLETE'
            ? 'HOSTED_LINK_READY'
            : selected.classification.kind === 'INTERNAL_SESSION_BOUND'
                ? 'SAME_CONTEXT_FALLBACK'
                : 'HOSTED_LINK_INCOMPLETE',
        source: selected.source,
        evidence: selected.classification,
        candidateCount: classified.length
    };
    Object.defineProperty(result, 'navigationUrl', {
        value: selected.rawUrl,
        enumerable: false,
        writable: false
    });
    return Object.freeze(result);
}

function decideCheckoutResume({ paymentState, createdAt, now = Date.now(), maxAgeMs = 20 * 60 * 1000, openCount = 0 } = {}) {
    if (PAYMENT_UNCERTAIN_STATES.has(String(paymentState || ''))) {
        return Object.freeze({ action: 'RECONCILE_ONLY', mayCreateCheckout: false, mayOpenLink: false });
    }
    const createdTime = Date.parse(String(createdAt || ''));
    if (!Number.isFinite(createdTime)) {
        return Object.freeze({ action: 'REJECT_MISSING_CREATION_TIME', mayCreateCheckout: false, mayOpenLink: false });
    }
    if (now - createdTime > maxAgeMs || now < createdTime - 60_000) {
        return Object.freeze({
            action: 'CHECKOUT_REVIEW_REQUIRED',
            reason: 'EXPIRY_IS_NOT_INVALIDATION_PROOF',
            mayCreateCheckout: false,
            mayOpenLink: false
        });
    }
    if (Number(openCount) > 0) {
        return Object.freeze({ action: 'REOPEN_WITH_FRESH_OBSERVATION', mayCreateCheckout: false, mayOpenLink: true });
    }
    return Object.freeze({ action: 'OPEN_ONCE_AND_OBSERVE', mayCreateCheckout: false, mayOpenLink: true });
}

module.exports = {
    parseCheckoutLink,
    selectCheckoutLink,
    decideCheckoutResume
};
