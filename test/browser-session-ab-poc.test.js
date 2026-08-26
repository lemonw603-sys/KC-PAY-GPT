'use strict';

const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadSessionIntoContext } = require('../browser-poc/session-loader');
const {
    validateSensitiveSessionFile,
    validateLiveExperimentConfig
} = require('../browser-poc/live-preflight');

const {
    parseSessionArtifact,
    applyCookiePolicy,
    resolveStickyProxy,
    sanitizeUrl,
    isPaymentMutation,
    classifySessionResponse,
    resolveExpectedIdentity,
    verifyExpectedIdentity,
    classifyOutcome,
    summarizeExperiments
} = require('../browser-poc/session-ab-core');

function sha256ForTest(value) {
    return require('node:crypto').createHash('sha256').update(value).digest('hex');
}

describe('browser session A/B PoC core', () => {
    it('parses both supported session cookie generations without exposing values', () => {
        const next = parseSessionArtifact('__Secure-next-auth.session-token=abcdefghijklmnopqrstuvwxyz123456');
        const authjs = parseSessionArtifact(JSON.stringify({
            cookies: [{
                name: '__Secure-authjs.session-token',
                value: 'zyxwvutsrqponmlkjihgfedcba654321',
                domain: '.chatgpt.com'
            }]
        }));

        expect(next.cookies[0].name).toBe('__Secure-next-auth.session-token');
        expect(authjs.cookies[0].name).toBe('__Secure-authjs.session-token');
        expect(JSON.stringify(next.evidence)).not.toContain('abcdefghijklmnopqrstuvwxyz');
    });

    it('rejects access tokens used as session cookies', () => {
        expect(() => parseSessionArtifact('Bearer eyJ.fake.token')).toThrow(/Bearer/);
    });

    it('does not guess the cookie family for a raw token or unnamed JSON token', () => {
        const raw = 'abcdefghijklmnopqrstuvwxyz123456';
        expect(() => parseSessionArtifact(raw)).toThrow(/无法自动判断/);
        expect(() => parseSessionArtifact(JSON.stringify({ sessionToken: raw }))).toThrow(/显式提供/);
        expect(parseSessionArtifact(raw, {
            rawSessionCookieName: '__Secure-authjs.session-token'
        }).cookies[0].name).toBe('__Secure-authjs.session-token');
    });

    it('rejects artifacts containing both session cookie families', () => {
        expect(() => parseSessionArtifact(JSON.stringify({
            cookies: [
                { name: '__Secure-next-auth.session-token', value: 'abcdefghijklmnopqrstuvwxyz123456' },
                { name: '__Secure-authjs.session-token', value: 'zyxwvutsrqponmlkjihgfedcba654321' }
            ]
        }))).toThrow(/同时包含/);
    });

    it('separates session-only, curated and full cookie material policies', () => {
        const cookies = [
            { name: '__Secure-next-auth.session-token', value: 'session' },
            { name: 'oai-did', value: 'device' },
            { name: '__cf_bm', value: 'cloudflare' },
            { name: 'oai-chat-web-route', value: 'stale-route' },
            { name: '_puid', value: 'user' }
        ];
        expect(applyCookiePolicy(cookies, 'SESSION_ONLY').map((item) => item.name))
            .toEqual(['__Secure-next-auth.session-token']);
        expect(applyCookiePolicy(cookies, 'CURATED').map((item) => item.name))
            .toEqual(['__Secure-next-auth.session-token', 'oai-did', '_puid']);
        expect(applyCookiePolicy(cookies, 'FULL_EXPORT')).toHaveLength(5);
    });

    it('requires an explicit sticky id when the proxy template has a session placeholder', () => {
        expect(() => resolveStickyProxy('http://user-{session}:pass@proxy.example:8000', '')).toThrow(/稳定/);
        expect(resolveStickyProxy('http://user-{session}:pass@proxy.example:8000', 'order_abc123'))
            .toContain('user-order_abc123');
    });

    it('removes query parameters from recorded URLs', () => {
        expect(sanitizeUrl('https://chatgpt.com/api/auth/session?secret=value'))
            .toBe('https://chatgpt.com/api/auth/session');
    });

    it('blocks payment mutations but permits read-only observations', () => {
        expect(isPaymentMutation('POST', 'https://chatgpt.com/backend-api/payments/checkout')).toBe(true);
        expect(isPaymentMutation('POST', 'https://api.stripe.com/v1/payment_intents/x/confirm')).toBe(true);
        expect(isPaymentMutation('GET', 'https://chatgpt.com/api/auth/session')).toBe(false);
    });

    it('separates server truth from UI-only evidence', () => {
        const rejected = classifySessionResponse({ status: 200, bodyText: '{}' });
        const accepted = classifySessionResponse({
            status: 200,
            bodyText: JSON.stringify({ user: { email: 'test@example.com' }, accessToken: 'redacted' })
        });
        expect(rejected.serverIdentityAccepted).toBe(false);
        expect(accepted.serverIdentityAccepted).toBe(true);
        expect(classifyOutcome({
            realBefore: rejected,
            realAfter: rejected,
            pageSession: accepted,
            loggedInUi: true
        })).toBe('UI_ONLY_SESSION');
    });

    it('rejects a valid server session whose identity differs from the expected account', () => {
        const expected = resolveExpectedIdentity({
            sessionPayload: { user: { email: 'expected@example.com' } }
        });
        const observed = classifySessionResponse({
            status: 200,
            bodyText: JSON.stringify({ user: { email: 'other@example.com' }, accessToken: 'redacted' })
        });
        expect(verifyExpectedIdentity(expected, observed, observed)).toBe('MISMATCH');
        expect(classifyOutcome({
            realBefore: observed,
            realAfter: observed,
            pageSession: observed,
            loggedInUi: true,
            expectedIdentity: expected
        })).toBe('SESSION_IDENTITY_MISMATCH');
    });

    it('compares the explicitly selected identity kind instead of guessing between email and id', () => {
        const observed = classifySessionResponse({
            status: 200,
            bodyText: JSON.stringify({
                user: { email: 'test@example.com', id: 'account-123' },
                accessToken: 'redacted'
            })
        });
        const expectedId = resolveExpectedIdentity(null, sha256ForTest('account-123'), 'id');
        expect(expectedId.kind).toBe('id');
        expect(verifyExpectedIdentity(expectedId, observed, observed)).toBe('MATCH');
        expect(() => resolveExpectedIdentity(null, sha256ForTest('account-123'), '')).toThrow(/identity kind/);
    });

    it('removes conflicting session cookie families in a real isolated Chromium context', async () => {
        const browser = await chromium.launch({ headless: true });
        try {
            const context = await browser.newContext();
            await context.addCookies([
                {
                    name: '__Secure-next-auth.session-token',
                    value: 'old-next-session',
                    url: 'https://chatgpt.com',
                    secure: true,
                    httpOnly: true,
                    sameSite: 'Lax'
                },
                {
                    name: '__Secure-authjs.session-token',
                    value: 'old-authjs-session',
                    url: 'https://chatgpt.com',
                    secure: true,
                    httpOnly: true,
                    sameSite: 'Lax'
                }
            ]);
            const evidence = await loadSessionIntoContext(context, [{
                name: '__Secure-authjs.session-token',
                value: 'new-authjs-session',
                url: 'https://chatgpt.com',
                secure: true,
                httpOnly: true,
                sameSite: 'Lax'
            }]);
            const cookies = await context.cookies('https://chatgpt.com');
            expect(evidence.removedSessionNames).toEqual([
                '__Secure-authjs.session-token',
                '__Secure-next-auth.session-token'
            ]);
            expect(evidence.preexistingSessionCookieCount).toBe(2);
            expect(evidence.finalSessionNames).toEqual(['__Secure-authjs.session-token']);
            expect(cookies.find((item) => item.name === '__Secure-authjs.session-token')?.value)
                .toBe('new-authjs-session');
            await context.close();
        } finally {
            await browser.close();
        }
    }, 30000);

    it('requires a repository-external chmod 600 Session file for live experiments', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-session-input-'));
        const sessionFile = path.join(directory, 'session.json');
        await fs.writeFile(sessionFile, '{}', { mode: 0o600 });
        try {
            expect(await validateSensitiveSessionFile(sessionFile, process.cwd())).toBe(await fs.realpath(sessionFile));
            await fs.chmod(sessionFile, 0o644);
            await expect(validateSensitiveSessionFile(sessionFile, process.cwd())).rejects.toThrow(/chmod 600/);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('fails closed when a live experiment lacks sticky proxy metadata or expected identity', () => {
        const complete = {
            BROWSER_POC_PROXY_URL: 'http://user-{session}:pass@proxy.example:8000',
            BROWSER_POC_PROXY_SESSION_ID: 'poc_order_001',
            BROWSER_POC_RUN_GROUP_ID: 'account_001_round_001',
            BROWSER_POC_SESSION_ACQUISITION_COUNTRY: 'US',
            BROWSER_POC_SESSION_ACQUISITION_CLASS: 'NON_PH_FAR',
            BROWSER_POC_SESSION_AGE_BUCKET: 'LT_1H',
            BROWSER_POC_ACCOUNT_HABITUAL_COUNTRY: 'US'
        };
        expect(() => validateLiveExperimentConfig(complete, { fingerprint: null })).toThrow(/预期账号/);
        expect(() => validateLiveExperimentConfig({ ...complete, BROWSER_POC_PROXY_URL: '' }, {
            fingerprint: '0123456789abcdef'
        })).toThrow(/PROXY_URL/);
        expect(() => validateLiveExperimentConfig(complete, {
            fingerprint: '0123456789abcdef'
        })).not.toThrow();
    });

    it('does not treat HTTP 200 without identity as a valid session and separates access denial', () => {
        const empty200 = classifySessionResponse({ status: 200, bodyText: '{"WARNING_BANNER":"ignored"}' });
        const denied = classifySessionResponse({ status: 403, bodyText: '<html>Access denied</html>' });
        expect(empty200.serverIdentityAccepted).toBe(false);
        expect(empty200.accessDenied).toBe(false);
        expect(denied.accessDenied).toBe(true);
        expect(classifyOutcome({
            realBefore: denied,
            realAfter: denied,
            pageSession: denied,
            loggedInUi: false
        })).toBe('SESSION_ACCESS_DENIED');
    });

    it('refuses to compare runs whose sticky proxy identity changed', () => {
        const make = (mode, proxySessionFingerprint) => ({
            mode,
            browserProfile: {
                runGroupFingerprint: 'same-run',
                proxySessionFingerprint,
                egress: { ipFingerprint: 'same-ip', countryVerifiedAsPhilippines: true }
            },
            sessionArtifact: { cookieValueFingerprints: ['same-session'] },
            probes: {}
        });
        const result = summarizeExperiments([
            make('cookie-only', 'proxy-a'),
            make('minimal-compat', 'proxy-a'),
            make('legacy-overlay', 'proxy-b')
        ]);
        expect(result.comparable).toBe(false);
        expect(result.reasons).toContain('proxy-session-mismatch');
    });

    it('detects a legacy overlay that only changes the page-visible session', () => {
        const rejected = { serverIdentityAccepted: false };
        const accepted = { serverIdentityAccepted: true };
        const make = (mode) => ({
            mode,
            browserProfile: {
                runGroupFingerprint: 'same-run',
                proxySessionFingerprint: 'same-proxy',
                egress: { ipFingerprint: 'same-ip', countryVerifiedAsPhilippines: true }
            },
            sessionArtifact: { cookieValueFingerprints: ['same-session'] },
            probes: { realBefore: rejected, realAfter: rejected, pageSession: rejected, loggedInUi: false }
        });
        const rows = [make('cookie-only'), make('minimal-compat'), make('legacy-overlay')];
        rows[2].probes.pageSession = accepted;
        rows[2].probes.loggedInUi = true;
        expect(summarizeExperiments(rows).conclusion).toBe('OVERLAY_UI_ONLY');
    });

    it('refuses to compare runs with different Session acquisition context', () => {
        const make = (mode, acquisitionClass) => ({
            mode,
            browserProfile: {
                runGroupFingerprint: 'same-run',
                proxySessionFingerprint: 'same-proxy',
                egress: { ipFingerprint: 'same-ip', countryVerifiedAsPhilippines: true }
            },
            sessionContext: {
                acquisitionCountry: 'US',
                acquisitionClass,
                ageBucket: 'LT_1H',
                accountHabitualCountry: 'US',
                materialClass: 'SESSION_COOKIE_ONLY'
            },
            sessionArtifact: { cookieValueFingerprints: ['same-session'] },
            probes: {}
        });
        const result = summarizeExperiments([
            make('cookie-only', 'NON_PH_FAR'),
            make('minimal-compat', 'NON_PH_FAR'),
            make('legacy-overlay', 'UNKNOWN')
        ]);
        expect(result.comparable).toBe(false);
        expect(result.reasons).toContain('session-context-mismatch');
    });
});
