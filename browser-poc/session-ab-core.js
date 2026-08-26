'use strict';

const crypto = require('node:crypto');

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const SUPPORTED_SESSION_COOKIE_NAMES = Object.freeze([
    '__Secure-next-auth.session-token',
    '__Secure-authjs.session-token'
]);
const SESSION_COOKIE_CHUNK_SIZE = 3936;
const COOKIE_POLICIES = Object.freeze(['SESSION_ONLY', 'CURATED', 'FULL_EXPORT']);
const CURATED_COOKIE_EXCLUDES = new Set([
    '__Secure-next-auth.callback-url',
    'oai-chat-web-route',
    'oai-client-auth-info',
    '__cflb',
    '_dd_s',
    'g_state',
    'oai-gn'
]);

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function cleanCookieValue(value) {
    return String(value || '')
        .trim()
        .replace(/^"|"$/g, '')
        .replace(/[\r\n\0]/g, '')
        .trim();
}

function isSupportedSessionCookieName(name) {
    return SUPPORTED_SESSION_COOKIE_NAMES.some((base) => name === base || name.startsWith(`${base}.`));
}

function sessionCookieFamily(name) {
    return SUPPORTED_SESSION_COOKIE_NAMES.find((base) => name === base || name.startsWith(`${base}.`)) || null;
}

function splitSessionCookie(name, value) {
    const clean = cleanCookieValue(value);
    if (clean.length <= SESSION_COOKIE_CHUNK_SIZE || /\.\d+$/.test(name)) {
        return [{ name, value: clean }];
    }
    return Array.from({ length: Math.ceil(clean.length / SESSION_COOKIE_CHUNK_SIZE) }, (_, index) => ({
        name: `${name}.${index}`,
        value: clean.slice(index * SESSION_COOKIE_CHUNK_SIZE, (index + 1) * SESSION_COOKIE_CHUNK_SIZE)
    }));
}

function parseCookieHeader(header) {
    return String(header || '').split(';').flatMap((part) => {
        const separator = part.indexOf('=');
        if (separator < 1) return [];
        const name = part.slice(0, separator).trim();
        const value = cleanCookieValue(part.slice(separator + 1));
        return name && value ? [{ name, value }] : [];
    });
}

function normalizeCookie(item) {
    if (!item || typeof item !== 'object') return null;
    const name = String(item.name || '').trim();
    const value = cleanCookieValue(item.value);
    if (!name || !value || !/chatgpt\.com$/i.test(String(item.domain || 'chatgpt.com').replace(/^\./, ''))) {
        return null;
    }
    return {
        name,
        value,
        url: CHATGPT_ORIGIN,
        secure: true,
        httpOnly: item.httpOnly !== false,
        sameSite: ['Strict', 'None'].includes(item.sameSite) ? item.sameSite : 'Lax'
    };
}

function parseSessionArtifact(raw, { rawSessionCookieName = '' } = {}) {
    const text = String(raw || '').trim();
    if (!text) throw new Error('Session 输入为空');
    if (/^(bearer\s+|sk-[a-z0-9_-]+)/i.test(text)) {
        throw new Error('拒绝 Bearer/API Key：PoC 基线必须使用真实 Session Cookie');
    }

    let parsed = null;
    if (text.startsWith('{') || text.startsWith('[')) {
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error('Session JSON 无法解析');
        }
    }

    const source = Array.isArray(parsed) ? { cookies: parsed } : (parsed || {});
    const cookies = [];
    const append = (cookie) => {
        const normalized = normalizeCookie(cookie);
        if (!normalized) return;
        for (const chunk of splitSessionCookie(normalized.name, normalized.value)) {
            cookies.push({ ...normalized, ...chunk });
        }
    };

    for (const item of Array.isArray(source.cookies) ? source.cookies : []) append(item);
    for (const item of parseCookieHeader(source.cookieHeader || source.cookie_header)) append(item);

    if (typeof source.sessionToken === 'string' && source.sessionToken.trim()) {
        if (!SUPPORTED_SESSION_COOKIE_NAMES.includes(source.sessionCookieName)) {
            throw new Error('包含 sessionToken 的 JSON 必须显式提供受支持的 sessionCookieName');
        }
        append({
            name: source.sessionCookieName,
            value: source.sessionToken
        });
    }

    if (!parsed) {
        const named = parseCookieHeader(text).find((item) => isSupportedSessionCookieName(item.name));
        if (named) append(named);
        else if (!text.includes('=') && text.length >= 20) {
            if (!SUPPORTED_SESSION_COOKIE_NAMES.includes(rawSessionCookieName)) {
                throw new Error('原始 Session Token 无法自动判断 Cookie 家族，必须显式提供 session cookie name');
            }
            append({ name: rawSessionCookieName, value: text });
        }
    }

    const deduped = [...new Map(cookies.map((item) => [`${item.name}\0${item.value}`, item])).values()];
    if (!deduped.some((item) => isSupportedSessionCookieName(item.name))) {
        throw new Error('未找到支持的 ChatGPT Session Cookie');
    }
    const sessionFamilies = [...new Set(deduped.map((item) => sessionCookieFamily(item.name)).filter(Boolean))];
    if (sessionFamilies.length !== 1) {
        throw new Error('Session 材料同时包含 next-auth 与 authjs Cookie，拒绝猜测服务器采用哪一组');
    }

    const sessionPayload = !Array.isArray(parsed) && parsed && (parsed.user || parsed.accessToken || parsed.access_token)
        ? parsed
        : null;
    const accessToken = String(sessionPayload?.accessToken || sessionPayload?.access_token || '').trim();

    return {
        cookies: deduped,
        sessionPayload,
        accessToken,
        evidence: {
            cookieNames: deduped.map((item) => item.name).sort(),
            cookieValueFingerprints: deduped.map((item) => sha256(item.value).slice(0, 16)).sort(),
            sessionCookieFamily: sessionFamilies[0],
            hasSessionPayload: Boolean(sessionPayload),
            hasAccessToken: Boolean(accessToken)
        }
    };
}

function resolveStickyProxy(rawProxy, sessionId) {
    const raw = String(rawProxy || '').trim();
    if (!raw) return '';
    if (!/\{session\}/i.test(raw)) return raw;
    const id = String(sessionId || '').trim();
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) {
        throw new Error('代理包含 {session}，必须提供稳定的 BROWSER_POC_PROXY_SESSION_ID');
    }
    return raw.replace(/\{session\}/gi, id);
}

function applyCookiePolicy(cookies, rawPolicy = 'SESSION_ONLY') {
    const policy = String(rawPolicy || 'SESSION_ONLY').trim().toUpperCase();
    if (!COOKIE_POLICIES.includes(policy)) {
        throw new Error(`不支持的 Cookie policy: ${policy}`);
    }
    const source = Array.isArray(cookies) ? cookies : [];
    if (policy === 'FULL_EXPORT') return source.slice();
    if (policy === 'SESSION_ONLY') return source.filter((item) => isSupportedSessionCookieName(item.name));
    return source.filter((item) => {
        const name = String(item.name || '');
        return !name.startsWith('__cf') && !CURATED_COOKIE_EXCLUDES.has(name);
    });
}

function sanitizeUrl(raw) {
    try {
        const url = new URL(String(raw || ''));
        return `${url.origin}${url.pathname}`;
    } catch {
        return String(raw || '').split(/[?#]/)[0];
    }
}

function isPaymentMutation(method, rawUrl) {
    const verb = String(method || 'GET').toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(verb)) return false;
    const url = String(rawUrl || '').toLowerCase();
    return /stripe|pay\.openai\.com|payment|checkout|billing|subscription|invoice/.test(url);
}

function classifySessionResponse({ status = 0, headers = {}, bodyText = '' } = {}) {
    let body = null;
    try {
        body = JSON.parse(String(bodyText || ''));
    } catch {
        body = null;
    }
    const headerText = JSON.stringify(headers).toLowerCase();
    const challenge = headerText.includes('cf-mitigated')
        || /just a moment|verify you are human/i.test(String(bodyText || ''));
    const accessDenied = [401, 403, 429].includes(Number(status));
    const email = String(body?.user?.email || '').trim().toLowerCase();
    const userId = String(body?.user?.id || '').trim().toLowerCase();
    const identity = userId || email;
    const identityKind = userId ? 'id' : (email ? 'email' : null);
    return {
        status,
        challenge,
        accessDenied,
        serverIdentityAccepted: Boolean(body?.accessToken || identity),
        identityFingerprint: identity ? sha256(identity.toLowerCase()).slice(0, 16) : null,
        identityKind,
        identityFingerprints: {
            email: email ? sha256(email).slice(0, 16) : null,
            id: userId ? sha256(userId).slice(0, 16) : null
        },
        hasAccessToken: Boolean(body?.accessToken || body?.access_token),
        bodyShape: body && typeof body === 'object' ? Object.keys(body).sort() : [],
        bodyBytes: Buffer.byteLength(String(bodyText || ''), 'utf8')
    };
}

function resolveExpectedIdentity(artifact, rawExpectedSha256 = '', rawExpectedKind = '') {
    const declared = String(rawExpectedSha256 || '').trim().toLowerCase();
    if (declared && !/^[a-f0-9]{64}$/.test(declared)) {
        throw new Error('BROWSER_POC_EXPECTED_IDENTITY_SHA256 必须是 64 位 SHA-256 十六进制');
    }
    const declaredKind = String(rawExpectedKind || '').trim().toLowerCase();
    if (declared) {
        if (!['email', 'id'].includes(declaredKind)) {
            throw new Error('设置 BROWSER_POC_EXPECTED_IDENTITY_SHA256 时必须同时指定 identity kind=email|id');
        }
        return { fingerprint: declared.slice(0, 16), kind: declaredKind, source: 'ENV_SHA256' };
    }
    const email = artifact?.sessionPayload?.user?.email || '';
    const userId = artifact?.sessionPayload?.user?.id || '';
    const identity = userId || email;
    return identity
        ? {
            fingerprint: sha256(String(identity).toLowerCase()).slice(0, 16),
            kind: userId ? 'id' : 'email',
            source: 'SESSION_PAYLOAD'
        }
        : { fingerprint: null, kind: null, source: 'NOT_DECLARED' };
}

function verifyExpectedIdentity(expectedIdentity, realBefore, realAfter) {
    if (!expectedIdentity?.fingerprint) return 'NOT_DECLARED';
    const probes = [realBefore, realAfter].filter((item) => item?.serverIdentityAccepted);
    const observed = probes.map((item) => item.identityFingerprints?.[expectedIdentity.kind]
        || (item.identityKind === expectedIdentity.kind ? item.identityFingerprint : null));
    if (probes.length !== 2 || observed.some((item) => !item)) return 'UNAVAILABLE';
    return observed.every((item) => item === expectedIdentity.fingerprint)
        ? 'MATCH'
        : 'MISMATCH';
}

function classifyOutcome({ realBefore, realAfter, pageSession, loggedInUi, expectedIdentity }) {
    const serverAccepted = Boolean(realBefore?.serverIdentityAccepted && realAfter?.serverIdentityAccepted);
    if (serverAccepted
        && realBefore.identityFingerprint
        && realAfter.identityFingerprint
        && realBefore.identityFingerprint !== realAfter.identityFingerprint) {
        return 'SESSION_IDENTITY_CHANGED';
    }
    const expectedIdentityResult = verifyExpectedIdentity(expectedIdentity, realBefore, realAfter);
    if (serverAccepted && expectedIdentityResult === 'MISMATCH') return 'SESSION_IDENTITY_MISMATCH';
    if (serverAccepted && expectedIdentityResult === 'UNAVAILABLE') return 'SESSION_IDENTITY_UNVERIFIED';
    if (!serverAccepted && loggedInUi) return 'UI_ONLY_SESSION';
    if (serverAccepted && !loggedInUi) return 'SERVER_SESSION_UI_UNREADY';
    if (serverAccepted && pageSession?.serverIdentityAccepted) return 'SERVER_SESSION_VALID';
    if (realBefore?.challenge || realAfter?.challenge) return 'SESSION_CHALLENGED';
    if (realBefore?.accessDenied || realAfter?.accessDenied) return 'SESSION_ACCESS_DENIED';
    return 'SESSION_REJECTED';
}

function summarizeExperiments(experiments) {
    const rows = Array.isArray(experiments) ? experiments : [];
    const byMode = new Map(rows.map((row) => [row.mode, row]));
    const requiredModes = ['cookie-only', 'minimal-compat', 'legacy-overlay'];
    const reasons = [];
    for (const mode of requiredModes) {
        if (!byMode.has(mode)) reasons.push(`missing-mode:${mode}`);
    }
    const fingerprints = (selector) => new Set(rows.map(selector).filter(Boolean));
    if (fingerprints((row) => row.browserProfile?.runGroupFingerprint).size !== 1) reasons.push('run-group-mismatch');
    if (fingerprints((row) => row.browserProfile?.proxySessionFingerprint).size !== 1) reasons.push('proxy-session-mismatch');
    if (fingerprints((row) => row.browserProfile?.egress?.ipFingerprint).size !== 1) reasons.push('egress-ip-mismatch');
    if (fingerprints((row) => JSON.stringify(row.sessionArtifact?.cookieValueFingerprints || [])).size !== 1) {
        reasons.push('session-artifact-mismatch');
    }
    const sessionContexts = rows.map((row) => row.sessionContext).filter(Boolean);
    if (sessionContexts.length > 0
        && (sessionContexts.length !== rows.length || fingerprints((row) => JSON.stringify(row.sessionContext)).size !== 1)) {
        reasons.push('session-context-mismatch');
    }
    if (rows.some((row) => row.browserProfile?.egress?.countryVerifiedAsPhilippines !== true)) {
        reasons.push('egress-not-verified-ph');
    }
    if (reasons.length) return { comparable: false, conclusion: 'INCOMPARABLE', reasons };

    const cookie = byMode.get('cookie-only');
    const minimal = byMode.get('minimal-compat');
    const legacy = byMode.get('legacy-overlay');
    const realAccepted = (row) => Boolean(
        row?.probes?.realBefore?.serverIdentityAccepted && row?.probes?.realAfter?.serverIdentityAccepted
    );
    if (!realAccepted(legacy) && legacy?.probes?.pageSession?.serverIdentityAccepted) {
        return { comparable: true, conclusion: 'OVERLAY_UI_ONLY', reasons: [] };
    }
    if (realAccepted(cookie) && cookie?.probes?.loggedInUi) {
        return { comparable: true, conclusion: 'COOKIE_BASELINE_SUFFICIENT', reasons: [] };
    }
    if (realAccepted(cookie) && !cookie?.probes?.loggedInUi && realAccepted(minimal) && minimal?.probes?.loggedInUi) {
        return { comparable: true, conclusion: 'MINIMAL_COMPAT_IMPROVES_UI', reasons: [] };
    }
    if (rows.every(realAccepted)) {
        return { comparable: true, conclusion: 'SERVER_SESSION_VALID_UI_RESULT_MIXED', reasons: [] };
    }
    return { comparable: true, conclusion: 'NO_MODE_ESTABLISHED_SERVER_SESSION', reasons: [] };
}

module.exports = {
    CHATGPT_ORIGIN,
    SUPPORTED_SESSION_COOKIE_NAMES,
    COOKIE_POLICIES,
    isSupportedSessionCookieName,
    sessionCookieFamily,
    parseSessionArtifact,
    applyCookiePolicy,
    resolveStickyProxy,
    sanitizeUrl,
    isPaymentMutation,
    classifySessionResponse,
    resolveExpectedIdentity,
    verifyExpectedIdentity,
    classifyOutcome,
    summarizeExperiments,
    sha256
};
