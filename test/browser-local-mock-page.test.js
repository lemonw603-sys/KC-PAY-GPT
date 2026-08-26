'use strict';

const { chromium } = require('playwright');
const { createMockBrowserServer } = require('../browser-poc/mock-browser-server');
const { inspectSyntheticCheckout } = require('../browser-poc/local-mock-page-adapter');

let browser;
let mock;
let baseUrl;

beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
});

beforeEach(async () => {
    mock = createMockBrowserServer();
    baseUrl = await mock.start();
});

afterEach(async () => {
    await mock.stop();
});

afterAll(async () => {
    await browser.close();
});

async function openCheckout(page, { runId, scenario }) {
    await page.goto(`${baseUrl}/account?runId=${encodeURIComponent(runId)}&scenario=${scenario}`);
    await page.getByRole('link', { name: 'Start synthetic checkout' }).click();
    await page.getByRole('heading', { name: 'Synthetic Plus checkout' }).waitFor();
    return page.frameLocator('iframe[title="Synthetic payment frame"]');
}

async function fillSyntheticPayment(frame) {
    await frame.getByLabel('Name on synthetic card').fill('Synthetic User');
    await frame.getByLabel('Synthetic card number').fill('4242424242424242');
    await frame.getByLabel('Expiry').fill('12/34');
    await frame.getByLabel('Security code').fill('123');
}

describe('local Playwright checkout mock', () => {
    it('keeps BrowserContext storage isolated', async () => {
        const first = await browser.newContext();
        const second = await browser.newContext();
        try {
            const firstPage = await first.newPage();
            const secondPage = await second.newPage();
            await firstPage.goto(`${baseUrl}/account`);
            await secondPage.goto(`${baseUrl}/account`);
            await firstPage.evaluate(() => localStorage.setItem('synthetic-account-state', 'context-one'));
            expect(await secondPage.evaluate(() => localStorage.getItem('synthetic-account-state'))).toBeNull();
        } finally {
            await first.close();
            await second.close();
        }
    });

    it('turns a lost submit response into PAYMENT_UNKNOWN and disables replay', async () => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            const frame = await openCheckout(page, { runId: 'run-unknown', scenario: 'SUBMIT_UNKNOWN' });
            await fillSyntheticPayment(frame);
            await frame.getByRole('button', { name: 'Submit synthetic payment' }).click();
            await frame.getByTestId('payment-status').getByText('PAYMENT_UNKNOWN').waitFor();
            await page.getByTestId('checkout-status').getByText('PAYMENT_UNKNOWN').waitFor();
            expect(await frame.getByRole('button', { name: 'Submit synthetic payment' }).isDisabled()).toBe(true);
            expect(mock.gateway.submitCalls).toBe(1);
            expect(mock.runToCheckout.size).toBe(1);
            expect(page.url().startsWith(baseUrl)).toBe(true);
        } finally {
            await context.close();
        }
    });

    it('keeps activation and cancellation as separate states', async () => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            const frame = await openCheckout(page, { runId: 'run-success', scenario: 'SUCCESS' });
            await fillSyntheticPayment(frame);
            await frame.getByRole('button', { name: 'Submit synthetic payment' }).click();
            await page.getByTestId('checkout-status').getByText('ENTITLEMENT_CONFIRMED').waitFor();
            const cancel = page.getByRole('button', { name: 'Cancel synthetic renewal' });
            expect(await cancel.isVisible()).toBe(true);
            await cancel.click();
            await page.getByTestId('checkout-status').getByText('DELIVERY_COMPLETE').waitFor();
            expect(mock.gateway.submitCalls).toBe(1);
        } finally {
            await context.close();
        }
    });

    it('resumes 3DS under the same synthetic authorization', async () => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            const frame = await openCheckout(page, { runId: 'run-3ds', scenario: 'REQUIRES_3DS' });
            await fillSyntheticPayment(frame);
            await frame.getByRole('button', { name: 'Submit synthetic payment' }).click();
            await frame.getByTestId('payment-status').getByText('REQUIRES_3DS').waitFor();
            await frame.getByRole('button', { name: 'Complete synthetic 3DS' }).click();
            await page.getByTestId('checkout-status').getByText('ENTITLEMENT_CONFIRMED').waitFor();
            expect(mock.gateway.submitCalls).toBe(1);
        } finally {
            await context.close();
        }
    });

    it('opens a popup checkout and validates it before locating the payment iframe', async () => {
        const context = await browser.newContext();
        try {
            const accountPage = await context.newPage();
            await accountPage.goto(`${baseUrl}/account?runId=run-popup&scenario=SUCCESS&popup=1`);
            const popupPromise = accountPage.waitForEvent('popup');
            await accountPage.getByRole('link', { name: 'Start synthetic checkout' }).click();
            const checkoutPage = await popupPromise;
            await checkoutPage.getByRole('heading', { name: 'Synthetic Plus checkout' }).waitFor();
            expect(await inspectSyntheticCheckout(checkoutPage)).toMatchObject({
                ready: true,
                status: 'CHECKOUT_SIGNATURE_VALID'
            });
            expect(checkoutPage.url().startsWith(baseUrl)).toBe(true);
        } finally {
            await context.close();
        }
    });

    it('fails closed on page signature drift without submitting payment', async () => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await page.goto(`${baseUrl}/account?runId=run-drift&scenario=SUCCESS&variant=DRIFTED`);
            await page.getByRole('link', { name: 'Start synthetic checkout' }).click();
            await page.getByRole('heading', { name: 'Synthetic Plus checkout' }).waitFor();
            expect(await inspectSyntheticCheckout(page)).toEqual({
                ready: false,
                status: 'PAGE_SIGNATURE_MISMATCH',
                checks: { product: false, amount: false, paymentFrame: false }
            });
            expect(mock.gateway.submitCalls).toBe(0);
        } finally {
            await context.close();
        }
    });
});
