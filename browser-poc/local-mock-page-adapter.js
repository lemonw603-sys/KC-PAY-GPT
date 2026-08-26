'use strict';

async function inspectSyntheticCheckout(page) {
    const product = await page.getByTestId('product').textContent().catch(() => null);
    const amount = await page.getByTestId('amount').textContent().catch(() => null);
    const paymentFrames = await page.locator('iframe[title="Synthetic payment frame"]').count();
    const checks = Object.freeze({
        product: product === 'ChatGPT Plus (synthetic)',
        amount: amount === 'PHP 1,100.00 (synthetic)',
        paymentFrame: paymentFrames === 1
    });
    const ready = Object.values(checks).every(Boolean);
    return Object.freeze({
        ready,
        status: ready ? 'CHECKOUT_SIGNATURE_VALID' : 'PAGE_SIGNATURE_MISMATCH',
        checks
    });
}

module.exports = { inspectSyntheticCheckout };
