'use strict';

const {
    CHATGPT_ORIGIN,
    isSupportedSessionCookieName
} = require('./session-ab-core');

const SESSION_COOKIE_PATTERN = /^__Secure-(?:next-auth|authjs)\.session-token(?:\.\d+)?$/;
const CHATGPT_DOMAIN_PATTERN = /(?:^|\.)chatgpt\.com$/i;

async function loadSessionIntoContext(context, appliedCookies) {
    if (!context || typeof context.cookies !== 'function' || typeof context.clearCookies !== 'function') {
        throw new Error('Session Loader 需要 Playwright BrowserContext');
    }
    const cookies = Array.isArray(appliedCookies) ? appliedCookies : [];
    const requestedSessionNames = cookies
        .filter((item) => isSupportedSessionCookieName(item.name))
        .map((item) => item.name)
        .sort();
    if (cookies.length && requestedSessionNames.length === 0) {
        throw new Error('Session Loader 输入没有受支持的 Session Cookie');
    }

    const before = await context.cookies(CHATGPT_ORIGIN);
    const removedSessionNames = before
        .filter((item) => isSupportedSessionCookieName(item.name))
        .map((item) => item.name)
        .sort();

    await context.clearCookies({
        name: SESSION_COOKIE_PATTERN,
        domain: CHATGPT_DOMAIN_PATTERN
    });
    if (cookies.length) await context.addCookies(cookies);

    const after = await context.cookies(CHATGPT_ORIGIN);
    const finalSessionNames = after
        .filter((item) => isSupportedSessionCookieName(item.name))
        .map((item) => item.name)
        .sort();
    const expected = [...new Set(requestedSessionNames)];
    const actual = [...new Set(finalSessionNames)];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error('Session Cookie 替换后仍存在冲突或缺失');
    }

    return {
        isolationMode: 'EPHEMERAL_BROWSER_CONTEXT',
        preexistingChatgptCookieCount: before.length,
        preexistingSessionCookieCount: removedSessionNames.length,
        removedSessionNames,
        appliedSessionNames: requestedSessionNames,
        finalSessionNames,
        conflictFree: true
    };
}

module.exports = {
    SESSION_COOKIE_PATTERN,
    CHATGPT_DOMAIN_PATTERN,
    loadSessionIntoContext
};
