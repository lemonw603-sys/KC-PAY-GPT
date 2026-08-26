#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { preparePlaywrightProxy } = require('../playwright-proxy');
const { hasVisibleLoginChrome, hasLoggedInChatUi } = require('../auth-page-detect');
const { loadSessionIntoContext } = require('./session-loader');
const {
    validateSensitiveSessionFile,
    validateLiveExperimentConfig
} = require('./live-preflight');
const {
    CHATGPT_ORIGIN,
    parseSessionArtifact,
    applyCookiePolicy,
    resolveStickyProxy,
    sanitizeUrl,
    isPaymentMutation,
    classifySessionResponse,
    resolveExpectedIdentity,
    verifyExpectedIdentity,
    classifyOutcome,
    sha256
} = require('./session-ab-core');

const MODES = new Set(['cookie-only', 'minimal-compat', 'legacy-overlay']);

function parseArgs(argv) {
    const args = { mode: 'cookie-only', publicControl: false, headful: false, output: '' };
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--mode') args.mode = argv[++index];
        else if (value === '--output') args.output = argv[++index];
        else if (value === '--public-control') args.publicControl = true;
        else if (value === '--headful') args.headful = true;
        else throw new Error(`未知参数: ${value}`);
    }
    if (!MODES.has(args.mode)) throw new Error(`不支持的模式: ${args.mode}`);
    return args;
}

function normalizeCountry(raw) {
    const value = String(raw || 'UNKNOWN').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(value) ? value : 'UNKNOWN';
}

function normalizeChoice(raw, allowed) {
    const value = String(raw || 'UNKNOWN').trim().toUpperCase();
    return allowed.includes(value) ? value : 'UNKNOWN';
}

async function probeRealSession(context) {
    try {
        const response = await context.request.get(`${CHATGPT_ORIGIN}/api/auth/session`, {
            timeout: 60000,
            failOnStatusCode: false
        });
        return classifySessionResponse({
            status: response.status(),
            headers: response.headers(),
            bodyText: await response.text()
        });
    } catch (error) {
        return { status: 0, challenge: false, serverIdentityAccepted: false, errorClass: error.name || 'Error' };
    }
}

async function probeEgress(context) {
    const result = {
        ipFingerprint: null,
        country: null,
        countryVerifiedAsPhilippines: false,
        errors: []
    };
    try {
        const response = await context.request.get('https://www.cloudflare.com/cdn-cgi/trace', {
            timeout: 30000,
            failOnStatusCode: false
        });
        const trace = Object.fromEntries(String(await response.text()).split(/\r?\n/).flatMap((line) => {
            const separator = line.indexOf('=');
            return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
        }));
        if (response.ok() && trace.ip) result.ipFingerprint = sha256(trace.ip).slice(0, 16);
        if (response.ok() && /^[A-Z]{2}$/.test(String(trace.loc || ''))) result.country = trace.loc;
        if (!response.ok()) result.errors.push(`cloudflare-trace:${response.status()}`);
    } catch (error) {
        result.errors.push(`cloudflare-trace:${error.name || 'Error'}`);
    }
    if (!result.ipFingerprint) try {
        const response = await context.request.get('https://api.ipify.org/?format=json', {
            timeout: 30000,
            failOnStatusCode: false
        });
        const body = await response.json().catch(() => null);
        if (response.ok() && body?.ip) result.ipFingerprint = sha256(body.ip).slice(0, 16);
        else result.errors.push(`ip:${response.status()}`);
    } catch (error) {
        result.errors.push(`ip:${error.name || 'Error'}`);
    }
    if (!result.country) try {
        const response = await context.request.get('https://ipapi.co/country/', {
            timeout: 30000,
            failOnStatusCode: false
        });
        const country = String(await response.text()).trim().toUpperCase();
        if (response.ok() && /^[A-Z]{2}$/.test(country)) result.country = country;
        else result.errors.push(`country:${response.status()}`);
    } catch (error) {
        result.errors.push(`country:${error.name || 'Error'}`);
    }
    result.countryVerifiedAsPhilippines = result.country === 'PH';
    return result;
}

async function probePageSession(page) {
    try {
        const result = await page.evaluate(async () => {
            const response = await fetch('/api/auth/session', { credentials: 'include' });
            return { status: response.status, bodyText: await response.text() };
        });
        return classifySessionResponse(result);
    } catch (error) {
        return { status: 0, challenge: false, serverIdentityAccepted: false, errorClass: error.name || 'Error' };
    }
}

async function detectUpgradeEntry(page) {
    const labels = [
        /upgrade/i,
        /get plus/i,
        /view plans/i,
        /升级|订阅|套餐/
    ];
    for (const label of labels) {
        for (const role of ['button', 'link']) {
            const locator = page.getByRole(role, { name: label }).first();
            if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
                return { visible: true, role, labelPattern: String(label) };
            }
        }
    }
    return { visible: false };
}

async function installMode(context, mode, artifact, counters) {
    const payload = artifact?.sessionPayload || null;
    if (mode === 'minimal-compat' && payload) {
        await context.addInitScript((sessionPayload) => {
            window.__CHATGPT_BOOTSTRAP_SESSION__ = sessionPayload;
            try {
                localStorage.setItem('oai/apps/chat/bootstrap-session', JSON.stringify(sessionPayload));
            } catch { /* evidence mode only */ }
        }, payload);
    }

    if (mode === 'legacy-overlay') {
        if (!payload || !artifact.accessToken) {
            throw new Error('legacy-overlay 需要同时包含真实 Cookie 和 accessToken/user 的 Session JSON');
        }
        const sessionBody = JSON.stringify(payload);
        await context.addInitScript((sessionPayload) => {
            const body = JSON.stringify(sessionPayload);
            window.__CHATGPT_BOOTSTRAP_SESSION__ = sessionPayload;
            try {
                localStorage.setItem('oai/apps/chat/bootstrap-session', body);
            } catch { /* evidence mode only */ }
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === 'string' ? input : input?.url || '';
                if (url.includes('/api/auth/session')) {
                    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (url.includes('/api/auth/csrf')) {
                    return new Response('{"csrfToken":"bootstrap-csrf-token"}', {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return originalFetch(input, init);
            };
        }, payload);
        counters.legacyOverlayInstalled = true;
        counters.legacySessionBodyBytes = Buffer.byteLength(sessionBody, 'utf8');
    }

    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();
        if (isPaymentMutation(request.method(), url)) {
            counters.blockedPaymentMutations += 1;
            counters.blockedUrls.push(sanitizeUrl(url));
            await route.abort('blockedbyclient');
            return;
        }
        if (mode === 'legacy-overlay' && /\/api\/auth\/session(?:\?|$)/.test(url)) {
            counters.authNetworkPassthroughRequests += 1;
            await route.continue();
            return;
        }
        if (mode === 'legacy-overlay' && /\/api\/auth\/csrf(?:\?|$)/.test(url)) {
            counters.csrfNetworkPassthroughRequests += 1;
            await route.continue();
            return;
        }
        if (mode === 'legacy-overlay' && /(?:chatgpt\.com|openai\.com)/i.test(url)) {
            counters.bearerInjectedRequests += 1;
            await route.continue({ headers: { ...request.headers(), authorization: `Bearer ${artifact.accessToken}` } });
            return;
        }
        await route.continue();
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const startedAt = new Date();
    let artifact = null;
    if (!args.publicControl) {
        if (process.env.BROWSER_POC_LIVE !== '1') {
            throw new Error('真实 Session PoC 默认关闭；需要显式设置 BROWSER_POC_LIVE=1');
        }
        const sessionFile = await validateSensitiveSessionFile(
            process.env.BROWSER_POC_SESSION_FILE,
            process.cwd()
        );
        artifact = parseSessionArtifact(await fs.readFile(sessionFile, 'utf8'), {
            rawSessionCookieName: process.env.BROWSER_POC_SESSION_COOKIE_NAME
        });
    }
    const expectedIdentity = resolveExpectedIdentity(
        artifact,
        process.env.BROWSER_POC_EXPECTED_IDENTITY_SHA256,
        process.env.BROWSER_POC_EXPECTED_IDENTITY_KIND
    );
    if (!args.publicControl) validateLiveExperimentConfig(process.env, expectedIdentity);

    const stickyProxy = resolveStickyProxy(
        process.env.BROWSER_POC_PROXY_URL,
        process.env.BROWSER_POC_PROXY_SESSION_ID
    );
    const preparedProxy = await preparePlaywrightProxy(stickyProxy);
    const counters = {
        legacyOverlayInstalled: false,
        legacySessionBodyBytes: 0,
        authNetworkPassthroughRequests: 0,
        csrfNetworkPassthroughRequests: 0,
        bearerInjectedRequests: 0,
        blockedPaymentMutations: 0,
        blockedUrls: []
    };
    let browser;
    try {
        browser = await chromium.launch({ headless: !args.headful });
        const context = await browser.newContext({
            locale: 'en-PH',
            timezoneId: 'Asia/Manila',
            proxy: preparedProxy.proxyConfig || undefined
        });
        const cookiePolicy = String(process.env.BROWSER_POC_COOKIE_POLICY || 'SESSION_ONLY').toUpperCase();
        const appliedCookies = artifact ? applyCookiePolicy(artifact.cookies, cookiePolicy) : [];
        const sessionLoader = await loadSessionIntoContext(context, appliedCookies);

        const egress = await probeEgress(context);
        const realBefore = await probeRealSession(context);
        await installMode(context, args.mode, artifact, counters);

        const page = await context.newPage();
        const observedAuthResponses = [];
        page.on('response', (response) => {
            if (/\/api\/auth\/session(?:\?|$)/.test(response.url())) {
                observedAuthResponses.push({ status: response.status(), url: sanitizeUrl(response.url()) });
            }
        });
        const navigation = await page.goto(CHATGPT_ORIGIN, {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        }).catch((error) => ({ error }));
        await page.waitForTimeout(5000);

        const pageSession = await probePageSession(page);
        const realAfter = await probeRealSession(context);
        const visibleLogin = await hasVisibleLoginChrome(page);
        const loggedInUi = await hasLoggedInChatUi(page);
        const upgradeEntry = await detectUpgradeEntry(page);
        const outcome = args.publicControl
            ? 'PUBLIC_CONTROL'
            : classifyOutcome({ realBefore, realAfter, pageSession, loggedInUi, expectedIdentity });

        const evidence = {
            schemaVersion: 2,
            experiment: 'chatgpt-session-ab-non-payment',
            startedAt: startedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            mode: args.mode,
            publicControl: args.publicControl,
            safety: {
                cardDataSupplied: false,
                clickedUpgrade: false,
                clickedPayment: false,
                paymentMutationGuardEnabled: true,
                ...counters,
                blockedUrls: [...new Set(counters.blockedUrls)]
            },
            browserProfile: {
                locale: 'en-PH',
                timezoneId: 'Asia/Manila',
                proxyConfigured: Boolean(stickyProxy),
                proxyFingerprint: stickyProxy ? sha256(stickyProxy).slice(0, 16) : null,
                proxySessionFingerprint: process.env.BROWSER_POC_PROXY_SESSION_ID
                    ? sha256(process.env.BROWSER_POC_PROXY_SESSION_ID).slice(0, 16)
                    : null,
                runGroupFingerprint: process.env.BROWSER_POC_RUN_GROUP_ID
                    ? sha256(process.env.BROWSER_POC_RUN_GROUP_ID).slice(0, 16)
                    : null,
                egress
            },
            sessionContext: {
                acquisitionCountry: normalizeCountry(process.env.BROWSER_POC_SESSION_ACQUISITION_COUNTRY),
                acquisitionClass: normalizeChoice(process.env.BROWSER_POC_SESSION_ACQUISITION_CLASS, [
                    'PH', 'NON_PH_NEAR', 'NON_PH_FAR', 'UNKNOWN'
                ]),
                ageBucket: normalizeChoice(process.env.BROWSER_POC_SESSION_AGE_BUCKET, [
                    'LT_1H', 'H1_6', 'H6_24', 'D1_3', 'GT_3D', 'UNKNOWN'
                ]),
                accountHabitualCountry: normalizeCountry(process.env.BROWSER_POC_ACCOUNT_HABITUAL_COUNTRY),
                materialClass: artifact ? cookiePolicy : 'NONE',
                appliedCookieNames: appliedCookies.map((item) => item.name).sort(),
                appliedCookieCount: appliedCookies.length
            },
            sessionArtifact: artifact?.evidence || null,
            expectedIdentity: {
                ...expectedIdentity,
                verification: verifyExpectedIdentity(expectedIdentity, realBefore, realAfter)
            },
            sessionLoader,
            probes: {
                realBefore,
                pageSession,
                realAfter,
                visibleLogin,
                loggedInUi,
                upgradeEntry,
                finalUrl: sanitizeUrl(page.url()),
                navigationStatus: typeof navigation?.status === 'function' ? navigation.status() : 0,
                navigationErrorClass: navigation?.error?.name || null,
                observedAuthResponses
            },
            outcome
        };

        const defaultName = `${startedAt.toISOString().replace(/[:.]/g, '-')}-${args.mode}.json`;
        const output = path.resolve(args.output || path.join('artifacts', 'browser-poc', defaultName));
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
        console.log(JSON.stringify({ ok: true, output, outcome }));
        await context.close();
    } finally {
        await browser?.close().catch(() => {});
        await preparedProxy.cleanup();
    }
}

main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
});
