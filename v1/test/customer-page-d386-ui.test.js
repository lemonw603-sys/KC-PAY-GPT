import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// D-386 / D-387：客户页批 A，用真浏览器跑前端（接口全部用假的，不连任何服务）。
const PUBLIC_NO = 'PJV1-12345678901234567890';
const CDK = 'PLUS-AAAAA-BBBBB-CCCCC-DDDDD';

function order(status, extra = {}) {
  const stage = status === 'ACTIVATING'
    ? { index: 5, total: 9, code: 'CHECKOUT_LOADING', label: '正在获取支付信息', floor: 37, ceiling: 61, typicalMs: 60000, since: new Date().toISOString() }
    : { index: 4, total: 9, code: 'ACCOUNT_VERIFYING', label: '正在验证账号', floor: 15, ceiling: 37, typicalMs: 20000, since: new Date().toISOString() };
  return { publicNo: PUBLIC_NO, status, updatedAt: new Date().toISOString(), stage, product: { planType: 'plus', label: 'ChatGPT Plus' }, ...extra };
}

async function withPage(handlers, fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 730 } });
    const calls = [];
    await page.route('http://customer.test/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/')) {
        const body = route.request().postDataJSON?.() ?? null;
        calls.push({ path, body });
        const handler = handlers[path];
        if (!handler) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"unexpected"}' });
        const { status = 200, json } = await handler(body, calls);
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
      }
      const files = { '/': 'index.html', '/assets/customer.js': 'assets/customer.js', '/assets/customer.css': 'assets/customer.css' };
      if (!files[path]) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({
        contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html',
        body: await readFile(new URL(`../public/${files[path]}`, import.meta.url), 'utf8'),
      });
    });
    await page.goto('http://customer.test/');
    await fn(page, calls);
  } finally { await browser.close(); }
}

const visible = (page, selector) => page.locator(selector).isVisible();

test('refreshing while an order is processing resumes its progress instead of dropping back to step 1', async () => {
  await withPage({ '/api/v1/orders/status': () => ({ json: { order: order('ACTIVATING') } }) }, async (page) => {
    await page.evaluate(([p, c]) => { sessionStorage.setItem('pojia:lastPublicNo', p); sessionStorage.setItem('pojia:lastCdk', c); }, [PUBLIC_NO, CDK]);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#stage-name').textContent === '正在获取支付信息');
    assert.equal(await visible(page, '#view-run'), true);
    assert.match(await page.locator('#run-rows').innerText(), new RegExp(CDK), 'the order row shows the customer\'s own code');
    assert.doesNotMatch(await page.locator('#stage-hint').innerText(), /保持本页打开/);
  });
});

test('a finished order is not re-opened on refresh; the code waits in the query box', async () => {
  await withPage({ '/api/v1/orders/status': () => ({ json: { order: order('FAILED', { canRetry: true, stage: undefined }) } }) }, async (page) => {
    await page.evaluate(([p, c]) => { sessionStorage.setItem('pojia:lastPublicNo', p); sessionStorage.setItem('pojia:lastCdk', c); }, [PUBLIC_NO, CDK]);
    await page.reload();
    await page.waitForTimeout(400);
    assert.equal(await visible(page, '#view-cdk'), true);
    assert.equal(await page.locator('#query-input').inputValue(), CDK);
  });
});

test('failed and needs-new-account screens say the conclusion, without a percentage; the specific reason is not overwritten', async () => {
  let mode = 'FAILED';
  await withPage({
    '/api/v1/orders/status': () => ({ json: { order: mode === 'FAILED'
      ? order('FAILED', { canRetry: false })
      : order('ACTION_REQUIRED', { actionRequired: { code: 'ACCOUNT_ALREADY_PLUS', message: '当前账号已是 Plus，请更换一个免费账号的 Session。' }, sessionReplacement: { used: 0, remaining: null, expiresAt: null } }) } }),
  }, async (page) => {
    await page.locator('#nav-query').click();
    await page.locator('#query-input').fill(PUBLIC_NO);
    await page.locator('#query-submit').click();
    // non-retryable failure answers in place on the query screen, in warning style
    await page.waitForFunction(() => !document.querySelector('#query-result').hidden);
    assert.equal(await page.locator('#query-result').getAttribute('data-kind'), 'warn');
    assert.match(await page.locator('#query-result-sub').innerText(), /联系商家/);

    mode = 'ACTION_REQUIRED';
    await page.locator('#query-submit').click();
    await page.waitForFunction(() => !document.querySelector('#view-run').hidden);
    await page.waitForTimeout(800); // longer than the 170 ms title swap that used to overwrite the reason
    assert.equal(await page.locator('#stage-name').textContent(), '需要换一个账号');
    assert.equal(await page.locator('#stage-hint').textContent(), '当前账号已是 Plus，请更换一个免费账号的 Session。');
    assert.equal(await page.locator('#ring-num').isHidden(), true);
    assert.equal(await page.locator('.ring').isHidden(), true, 'D-389: no frozen amber ring on a conclusion screen');
  });
});

test('a retryable failure shows its conclusion title on the progress screen with the retry button', async () => {
  await withPage({ '/api/v1/orders/status': () => ({ json: { order: order('FAILED', { canRetry: true }) } }) }, async (page) => {
    await page.evaluate(() => sessionStorage.clear());
    await page.locator('#nav-query').click();
    await page.locator('#query-input').fill(CDK);
    await page.locator('#query-submit').click();
    await page.waitForFunction(() => !document.querySelector('#view-run').hidden);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#stage-name').textContent(), '这一单没有完成');
    assert.equal(await page.locator('#ring-num').isHidden(), true);
    assert.equal(await page.locator('.ring').isHidden(), true);
    assert.equal(await visible(page, '#retry-order'), true);
  });
});

test('after a successful account change the page shows processing, not the orange "something went wrong"', async () => {
  let replaced = false;
  const statusOf = () => (replaced ? order('ACTIVATING') : order('ACTION_REQUIRED', {
    actionRequired: { code: 'SESSION_INVALID', message: '当前 Session 无效，请重新获取完整 Session。' },
    sessionReplacement: { used: 0, remaining: null, expiresAt: null } }));
  const future = Math.floor(Date.now() / 1000) + 7200;
  const token = `x.${Buffer.from(JSON.stringify({ exp: future })).toString('base64url')}.y`;
  const session = { user: { id: 'u', email: 'new@example.test' }, account: { id: 'a' }, accessToken: token,
    sessionToken: 'a..b.c.d', expires: new Date(Date.now() + 86400000).toISOString() };
  await withPage({
    '/api/v1/orders/status': () => ({ json: { order: statusOf() } }),
    '/api/v1/orders/session': () => { replaced = true; return { json: { order: { publicNo: PUBLIC_NO, status: 'PROCESSING', replacementCount: 1, replacementsRemaining: null } } }; },
  }, async (page) => {
    await page.locator('#nav-query').click();
    await page.locator('#query-input').fill(PUBLIC_NO);
    await page.locator('#query-submit').click();
    await page.waitForFunction(() => !document.querySelector('#form-replace').hidden);
    await page.locator('#replace-session').fill(JSON.stringify(session));
    await page.locator('#replace-check').check();
    await page.locator('#replace-submit').click();
    await page.waitForFunction(() => document.querySelector('#stage-name').textContent === '正在获取支付信息');
    assert.equal(await page.locator('#view-run').getAttribute('data-tone'), 'ok');
    assert.equal(await page.locator('.ring').isVisible(), true, 'the ring comes back once the order is processing again');
    assert.doesNotMatch(await page.locator('#stage-hint').innerText(), /遇到点问题/);
  });
});

test('the replacement form pre-checks the new Session like step 2 does', async () => {
  await withPage({ '/api/v1/orders/status': () => ({ json: { order: order('ACTION_REQUIRED', {
    actionRequired: { code: 'SESSION_INVALID', message: '当前 Session 无效，请重新获取完整 Session。' },
    sessionReplacement: { used: 0, remaining: null, expiresAt: null } }) } }) }, async (page, calls) => {
    await page.locator('#nav-query').click();
    await page.locator('#query-input').fill(PUBLIC_NO);
    await page.locator('#query-submit').click();
    await page.waitForFunction(() => !document.querySelector('#form-replace').hidden);
    await page.locator('#replace-session').fill('{"user":{"email":"a@b.test"}}');
    await page.locator('#replace-check').check();
    await page.locator('#replace-submit').click();
    assert.match(await page.locator('#field-replace [data-error]').textContent(), /内容不完整/);
    assert.equal(calls.filter((c) => c.path === '/api/v1/orders/session').length, 0, 'nothing is sent for a Session that fails the local check');
  });
});

test('step 1 says a closed or paused product up front, instead of after the Session step', async () => {
  const cases = [
    ['ORDER_ROUTE_UNAVAILABLE', /这个套餐暂未开放,请联系商家/],
    ['EXECUTOR_UNAVAILABLE', /系统正在维护/],
    ['ORDERING_PAUSED', /暂停接收新订单/],
  ];
  for (const [code, text] of cases) {
    await withPage({ '/api/v1/cdks/verify': () => ({ json: { cdk: { state: 'VALID', product: { planType: 'pro_5x', label: 'ChatGPT Pro 5X' }, orderable: { ok: false, code } } } }) }, async (page) => {
      await page.locator('#cdk').fill(CDK);
      await page.locator('#cdk-submit').click();
      await page.waitForFunction(() => document.querySelector('#field-cdk [data-error]').textContent.length > 0);
      assert.match(await page.locator('#field-cdk [data-error]').textContent(), text);
      assert.equal(await visible(page, '#view-cdk'), true);
    });
  }
  await withPage({ '/api/v1/cdks/verify': () => ({ json: { cdk: { state: 'VALID', product: { planType: 'plus', label: 'ChatGPT Plus' }, orderable: { ok: true } } } }) }, async (page) => {
    await page.locator('#cdk').fill(CDK);
    await page.locator('#cdk-submit').click();
    await page.waitForFunction(() => !document.querySelector('#view-session').hidden);
    assert.match(await page.locator('#session-sub').innerText(), /没有付费订阅/);
  });
});

test('an empty {} from a logged-out browser is explained as "not logged in", not "copy the whole page"', async () => {
  await withPage({ '/api/v1/cdks/verify': () => ({ json: { cdk: { state: 'VALID', product: { planType: 'plus', label: 'ChatGPT Plus' }, orderable: { ok: true } } } }) }, async (page) => {
    await page.locator('#cdk').fill(CDK);
    await page.locator('#cdk-submit').click();
    await page.waitForFunction(() => !document.querySelector('#view-session').hidden);
    await page.locator('#session').fill('{}');
    await page.locator('#session-submit').evaluate((b) => { b.disabled = false; });
    await page.locator('#session-submit').click();
    assert.match(await page.locator('#field-session [data-error]').textContent(), /还没有登录 ChatGPT/);
  });
});

test('waiting for a card says it may take a few minutes, and says "few minutes" only once (D-250 / D-390)', async () => {
  const waiting = order('PREPARING', { stage: { index: 2, total: 9, code: 'CARD_PREPARING', label: '正在准备支付卡', floor: 2, ceiling: 6, typicalMs: 15000, since: new Date().toISOString() } });
  await withPage({ '/api/v1/orders/status': () => ({ json: { order: waiting } }) }, async (page) => {
    await page.locator('#nav-query').click();
    await page.locator('#query-input').fill(PUBLIC_NO);
    await page.locator('#query-submit').click();
    await page.waitForFunction(() => document.querySelector('#stage-name').textContent === '正在准备支付卡');
    await page.waitForTimeout(800);
    const hint = await page.locator('#stage-hint').textContent();
    assert.equal(hint, '正在准备专用卡,可能需要几分钟。关掉本页也不影响,随时可以用卡密回来查。');
    assert.equal(hint.split('几分钟').length - 1, 1);
    assert.equal(await page.locator('#view-run').getAttribute('data-tone'), 'ok');
    assert.equal(await page.locator('.ring').isVisible(), true, 'still processing: the ring stays');
  });
});

test('a review in progress looks like processing and says a person is confirming (D-250 / D-391)', async () => {
  await withPage({ '/api/v1/orders/status': () => ({ json: { order: order('REVIEWING') } }) }, async (page) => {
    await page.locator('#nav-query').click();
    await page.locator('#query-input').fill(PUBLIC_NO);
    await page.locator('#query-submit').click();
    await page.waitForFunction(() => !document.querySelector('#view-run').hidden);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#view-run').getAttribute('data-tone'), 'ok', 'green, not the orange "something went wrong"');
    assert.equal(await page.locator('#stage-name').textContent(), '正在验证账号', 'the title is still the stage');
    assert.equal(await page.locator('#stage-hint').textContent(), '正在人工确认,完成后这里会更新。关掉本页也不影响,随时可以用卡密回来查。');
    assert.equal(await page.locator('.ring').isVisible(), true);
    assert.equal(await page.locator('#ring-num').isVisible(), true, 'still processing: the percentage stays');
  });
});

test('a payment confirmation that drags on is still flagged in amber, unchanged by D-391', async () => {
  const slow = order('VERIFYING', { stage: { index: 7, total: 9, code: 'PAYMENT_AWAITING', label: '正在等待支付结果', floor: 94, ceiling: 98, typicalMs: 9500, since: new Date(Date.now() - 4 * 60_000).toISOString() } });
  await withPage({ '/api/v1/orders/status': () => ({ json: { order: slow } }) }, async (page) => {
    await page.locator('#nav-query').click();
    await page.locator('#query-input').fill(PUBLIC_NO);
    await page.locator('#query-submit').click();
    await page.waitForFunction(() => !document.querySelector('#view-run').hidden);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#view-run').getAttribute('data-tone'), 'warn');
    assert.match(await page.locator('#stage-hint').textContent(), /支付结果确认得比平时久/);
  });
});
