// Read-only rehearsal of the second stage (Plus -> Pro upgrade) on an account
// that already subscribes: open the plan picker inside a BitBrowser identity,
// select the Pro tier, press Upgrade, and STOP on the "Confirm plan changes"
// dialog. Pay now is never clicked. Amounts and the card's last four digits are
// the only values recorded.
//
//   BITBROWSER_PROFILE_ID=<id> node browser-mvp/scripts/poc-plan-change-dialog-readonly.mjs [pro_20x|pro_5x] [--cancel] [--probe-recovery]
//   --cancel          close the dialog with its Cancel control after reading it
//   --probe-recovery  before navigating, run the post-payment session ladder step
//                     "clear login cookies + reload" on this healthy session to prove
//                     it does not break a valid session (no payment involved)
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, navigateToChatGPTCheckout, cancelPlanChangeDialog } from '../src/chatgpt-checkout-navigator.js';
import { recoverSessionAfterPayment, checkSessionHealth } from '../src/post-payment-session-recovery.js';

const EVIDENCE_DIR = fileURLToPath(new URL('../../artifacts/poc-plan-change-20260908/', import.meta.url));
const API = process.env.BITBROWSER_API_BASE_URL || 'http://127.0.0.1:54345';
const PROFILE = process.env.BITBROWSER_PROFILE_ID;
if (!PROFILE) { console.error('BITBROWSER_PROFILE_ID is required'); process.exit(2); }
const args = process.argv.slice(2);
const plan = args.find((value) => /^pro_(5x|20x)$/.test(value)) || 'pro_20x';
const CANCEL = args.includes('--cancel');
const PROBE_RECOVERY = args.includes('--probe-recovery');
const digest = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);
const bit = async (path, body) => {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.success) throw new Error(`BitBrowser ${path} failed: ${JSON.stringify(j).slice(0, 200)}`); return j.data;
};
const evidence = { startedAt: new Date().toISOString(), profileIdDigest: digest(PROFILE), plan, cancel: CANCEL, probeRecovery: PROBE_RECOVERY, steps: [] };
const note = (step, data) => { evidence.steps.push({ step, at: new Date().toISOString(), ...data }); console.log(`[${step}]`, JSON.stringify(data)); };

const opened = await bit('/browser/open', { id: PROFILE });
const browser = await chromium.connectOverCDP(`http://${opened.http}`);
try {
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);
  note('page', { url: page.url().split('?')[0].split('#')[0], title: await page.title() });
  note('session-before', await checkSessionHealth(page));
  if (PROBE_RECOVERY) {
    const ladder = await recoverSessionAfterPayment(page, { forceLadder: true, navigationTimeoutMs: 60_000 });
    note('recovery-ladder', { recovered: ladder.recovered, recoveryStep: ladder.recoveryStep, steps: ladder.steps });
    await page.waitForTimeout(2000);
  }
  const result = await navigateToChatGPTCheckout(page, CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, {
    plan, expect: 'plan-change', timeoutMs: 45_000,
  });
  note('plan-change-dialog', { state: result.state, actions: result.actions, planChange: result.planChange });
  if (CANCEL) {
    note('cancel', await cancelPlanChangeDialog(page, CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT));
  } else {
    note('left-open', { message: 'dialog left open; Pay now was not clicked' });
  }
  note('session-after', await checkSessionHealth(page));
} catch (error) {
  note('error', { code: error?.code || null, message: String(error?.message || error).slice(0, 300) });
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = `${EVIDENCE_DIR}plan-change-${plan}-${evidence.startedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify(evidence, null, 2));
  console.log(`evidence: ${file}`);
  await browser.close().catch(() => undefined);
}
