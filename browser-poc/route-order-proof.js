#!/usr/bin/env node
'use strict';

const http = require('node:http');
const { chromium } = require('playwright');

async function main() {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"source":"network"}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const target = `http://127.0.0.1:${address.port}/api/auth/session`;
    const counters = { exact: 0, catchAll: 0 };
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        await context.route(/\/api\/auth\/session$/, async (route) => {
            counters.exact += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"source":"exact-route"}' });
        });
        await context.route('**/*', async (route) => {
            counters.catchAll += 1;
            await route.continue();
        });
        const page = await context.newPage();
        const response = await page.goto(target, { waitUntil: 'domcontentloaded' });
        const body = await response.text();
        const result = {
            exactRouteCalls: counters.exact,
            catchAllRouteCalls: counters.catchAll,
            responseSource: JSON.parse(body).source,
            conclusion: counters.exact === 0 && JSON.parse(body).source === 'network'
                ? 'CATCH_ALL_CONTINUE_BYPASSES_EARLIER_EXACT_ROUTE'
                : 'UNEXPECTED_ROUTE_ORDER'
        };
        console.log(JSON.stringify(result, null, 2));
        await context.close();
        if (result.conclusion === 'UNEXPECTED_ROUTE_ORDER') process.exitCode = 1;
    } finally {
        await browser?.close().catch(() => {});
        await new Promise((resolve) => server.close(resolve));
    }
}

main().catch((error) => {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
});
