'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveStickyProxy } = require('./session-ab-core');

function isPathInside(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function validateSensitiveSessionFile(sessionFile, workspaceRoot) {
    if (!sessionFile) throw new Error('缺少 BROWSER_POC_SESSION_FILE');
    const [realFile, realWorkspace] = await Promise.all([
        fs.realpath(sessionFile),
        fs.realpath(workspaceRoot)
    ]);
    if (isPathInside(realWorkspace, realFile)) {
        throw new Error('Session 文件必须位于仓库外，禁止进入工作区或 Git 状态');
    }
    const stat = await fs.stat(realFile);
    if (!stat.isFile()) throw new Error('BROWSER_POC_SESSION_FILE 必须是普通文件');
    if ((stat.mode & 0o077) !== 0) {
        throw new Error('Session 文件权限过宽；必须 chmod 600 后再运行');
    }
    return realFile;
}

function validateLiveExperimentConfig(env, expectedIdentity) {
    const required = [
        'BROWSER_POC_PROXY_URL',
        'BROWSER_POC_PROXY_SESSION_ID',
        'BROWSER_POC_RUN_GROUP_ID',
        'BROWSER_POC_SESSION_ACQUISITION_COUNTRY',
        'BROWSER_POC_SESSION_ACQUISITION_CLASS',
        'BROWSER_POC_SESSION_AGE_BUCKET',
        'BROWSER_POC_ACCOUNT_HABITUAL_COUNTRY'
    ];
    const missing = required.filter((name) => !String(env[name] || '').trim());
    if (missing.length) throw new Error(`真实实验缺少必填环境变量: ${missing.join(', ')}`);
    if (!/^[A-Za-z0-9_-]{6,120}$/.test(String(env.BROWSER_POC_RUN_GROUP_ID))) {
        throw new Error('BROWSER_POC_RUN_GROUP_ID 格式无效');
    }
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(String(env.BROWSER_POC_PROXY_SESSION_ID))) {
        throw new Error('BROWSER_POC_PROXY_SESSION_ID 格式无效');
    }
    const allowedClass = new Set(['PH', 'NON_PH_NEAR', 'NON_PH_FAR', 'UNKNOWN']);
    const allowedAge = new Set(['LT_1H', 'H1_6', 'H6_24', 'D1_3', 'GT_3D', 'UNKNOWN']);
    const validCountry = (value) => value === 'UNKNOWN' || /^[A-Z]{2}$/.test(value);
    if (!validCountry(String(env.BROWSER_POC_SESSION_ACQUISITION_COUNTRY).toUpperCase())) {
        throw new Error('BROWSER_POC_SESSION_ACQUISITION_COUNTRY 格式无效');
    }
    if (!validCountry(String(env.BROWSER_POC_ACCOUNT_HABITUAL_COUNTRY).toUpperCase())) {
        throw new Error('BROWSER_POC_ACCOUNT_HABITUAL_COUNTRY 格式无效');
    }
    if (!allowedClass.has(String(env.BROWSER_POC_SESSION_ACQUISITION_CLASS).toUpperCase())) {
        throw new Error('BROWSER_POC_SESSION_ACQUISITION_CLASS 格式无效');
    }
    if (!allowedAge.has(String(env.BROWSER_POC_SESSION_AGE_BUCKET).toUpperCase())) {
        throw new Error('BROWSER_POC_SESSION_AGE_BUCKET 格式无效');
    }
    resolveStickyProxy(env.BROWSER_POC_PROXY_URL, env.BROWSER_POC_PROXY_SESSION_ID);
    if (!expectedIdentity?.fingerprint) {
        throw new Error('真实实验必须通过 Session JSON user 或 BROWSER_POC_EXPECTED_IDENTITY_SHA256 声明预期账号');
    }
}

module.exports = {
    isPathInside,
    validateSensitiveSessionFile,
    validateLiveExperimentConfig
};
