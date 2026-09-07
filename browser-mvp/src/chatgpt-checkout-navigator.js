import { createHash } from 'node:crypto';

import { ContractError } from './contracts.js';

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

async function visibleCount(locator) {
  let count = 0;
  for (let index = 0; index < await locator.count(); index += 1) {
    if (await locator.nth(index).isVisible()) count += 1;
  }
  return count;
}

async function visibleSelectorMatches(page, selectors) {
  const matches = [];
  for (const selector of selectors || []) {
    const locator = page.locator(selector);
    for (let index = 0; index < await locator.count(); index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) matches.push(candidate);
    }
  }
  return matches;
}

async function uniqueVisibleSelector(page, selectors, label, { allowEquivalentMultiple = false } = {}) {
  const matches = await visibleSelectorMatches(page, selectors);
  if (matches.length === 0) throw new ContractError(`${label} must resolve to one visible control`);
  if (matches.length > 1 && !allowEquivalentMultiple) throw new ContractError(`${label} must resolve to one visible control`);
  if (matches.length > 1 && allowEquivalentMultiple) {
    // ChatGPT may render the same upgrade action in both header/sidebar.
    // Every candidate is still checked as a non-form navigation control.
    for (const candidate of matches) await assertSafeNavigationControl(candidate, label);
  }
  return matches[0];
}

async function lastVisibleNavigationSelector(page, selectors, label, { optional = false } = {}) {
  const matches = await visibleSelectorMatches(page, selectors);
  if (optional && matches.length === 0) return null;
  if (matches.length === 0) throw new ContractError(`${label} must resolve to a visible control`);
  // ChatGPT currently renders two overlapping profile controls. The last
  // visible control is the one that receives pointer events in the live DOM.
  // Validate every duplicate before selecting it so selector drift cannot
  // turn this fallback into an arbitrary click.
  for (const candidate of matches) await assertSafeNavigationControl(candidate, label);
  return matches.at(-1);
}

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// The live pricing modal's accessible names do not match getByRole(exact)
// reliably (nested dialogs, decorated labels), while the visible text does.
// Match the trimmed visible text exactly and hand back a resolved element so
// a re-render between lookup and click cannot turn into a 30 s locator wait.
async function uniqueVisibleButton(scope, labels, label, { optional = false } = {}) {
  const matches = [];
  for (const name of labels || []) {
    const locator = scope.locator('button, [role="button"]', { hasText: new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`) });
    for (let index = 0; index < await locator.count(); index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) matches.push(candidate);
    }
  }
  if (optional && matches.length === 0) return null;
  if (matches.length !== 1) {
    if (process.env.DEBUG_BROWSER_ERRORS === 'true') console.error('button mismatch', label, matches.length, labels);
    throw new ContractError(`${label} must resolve to one visible button`);
  }
  return matches[0];
}

async function uniqueVisibleMenuItem(scope, labels, label, { optional = false } = {}) {
  const matches = [];
  for (const name of labels || []) {
    const locator = scope.getByRole('menuitem', { name, exact: true });
    for (let index = 0; index < await locator.count(); index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) matches.push(candidate);
    }
  }
  if (optional && matches.length === 0) return null;
  if (matches.length !== 1) throw new ContractError(`${label} must resolve to one visible menu item`);
  return matches[0];
}

async function assertSafeNavigationControl(locator, label) {
  const shape = await locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role')?.toLowerCase() || null,
    tabIndex: element.tabIndex,
    type: element.getAttribute('type')?.toLowerCase() || null,
    disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true',
    insideForm: Boolean(element.closest('form')),
  }));
  const nativeControl = ['button', 'a'].includes(shape.tag);
  const accessibleButton = shape.role === 'button' && Number.isInteger(shape.tabIndex) && shape.tabIndex >= 0;
  const menuItem = shape.role === 'menuitem';
  if (!nativeControl && !accessibleButton && !menuItem) throw new ContractError(`${label} is not a navigation control`);
  if (shape.disabled) throw new ContractError(`${label} is disabled`);
  // ChatGPT's plan picker renders the non-payment "升级至 Plus" action as a
  // standalone button with type=submit but no enclosing form. It only opens
  // Checkout; a submit control inside a form remains forbidden.
  if (shape.insideForm) throw new ContractError(`${label} may submit a form`);
}

async function safeClick(locator, label, assertContinue, timeoutMs) {
  await assertContinue();
  let handle;
  try {
    handle = await locator.elementHandle({ timeout: Math.min(timeoutMs, 5_000) });
  } catch (error) {
    throw new ContractError(`${label} disappeared before it could be clicked`);
  }
  if (!handle) throw new ContractError(`${label} disappeared before it could be clicked`);
  await assertSafeNavigationControl(handle, label);
  try {
    await handle.click({ timeout: Math.min(timeoutMs, 5_000) });
  } catch (error) {
    throw new ContractError(`${label} click failed: ${String(error.message || error).split('\n')[0]}`);
  } finally {
    await handle.dispose().catch(() => undefined);
  }
}

export class SessionExpiredOnPageError extends ContractError {
  constructor(message = 'ChatGPT reports the session has expired') { super(message); this.name = 'SessionExpiredOnPageError'; this.code = 'SESSION_INVALID'; }
}

const SESSION_EXPIRED_PATTERN = /session has expired|log in again|会话已过期|请重新登录|登录已过期/i;

// ChatGPT overlays "Your session has expired. Please log in again" as a
// dialog above the plan picker; every control underneath stops being
// clickable. That is a customer Session problem and must abort as such.
async function assertNoSessionExpiredDialog(page) {
  let texts = [];
  try { texts = await page.locator('[role="dialog"]').allInnerTexts(); } catch { return; }
  if (texts.some((text) => SESSION_EXPIRED_PATTERN.test(text))) throw new SessionExpiredOnPageError();
}

async function waitForState(page, predicate, { timeoutMs, label }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let state = null;
    try { state = await predicate(); } catch { state = null; } // navigating: keep waiting
    if (state) return state;
    await page.waitForTimeout(100);
  }
  throw new ContractError(`${label} timed out`);
}

async function checkoutReady(page, contract) {
  try {
    if (!page.url().startsWith(contract.checkoutUrlPrefix)) return false;
    const marker = page.locator(contract.checkoutReadySelector);
    return (await marker.count()) === 1 && await marker.isVisible();
  } catch {
    // Mid-navigation (execution context replaced) is "not ready yet", not drift.
    return false;
  }
}

// ChatGPT stacks an announcement dialog on top of the plan picker; both are
// role=dialog and visible. The plan picker is the one holding a plan button.
function pricingDialog(page, contract) {
  const anyPlanButton = page.locator('button, [role="button"]', {
    hasText: new RegExp(`^\\s*(${[...(contract.upgradeLabels || []), ...(contract.planMarkerLabels || [])].map(escapeRegExp).join('|')})\\s*$`),
  });
  return page.locator(contract.pricingDialogSelector).filter({ has: anyPlanButton });
}

async function pricingDialogVisible(page, contract) {
  try { return (await visibleCount(pricingDialog(page, contract))) >= 1; } catch { return false; }
}

export const CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT = Object.freeze({
  homeUrlPrefix: 'https://chatgpt.com/',
  checkoutUrlPrefix: 'https://chatgpt.com/checkout/',
  openPricingSelectors: Object.freeze(['button[aria-label="升级"]', 'button[aria-label="Upgrade"]']),
  profileMenuSelectors: Object.freeze(['[data-testid="accounts-profile-button"]']),
  profileUpgradeSelectors: Object.freeze(['button[aria-label="升级"]', 'button[aria-label="Upgrade"]']),
  profileUpgradeLabels: Object.freeze(['升级套餐', 'Upgrade plan']),
  pricingDialogSelector: '[role="dialog"]',
  upgradeLabels: Object.freeze(['升级至 Plus', 'Upgrade to Plus', '重新订阅 Plus', 'Rejoin Plus']),
  // Any of these identifies the plan picker dialog even when the Plus button is absent.
  planMarkerLabels: Object.freeze(['Upgrade to Pro', 'Upgrade to Go', 'Your current plan', '升级至 Pro', '当前套餐']),
  // Per-plan controls inside the picker. Pro shares one "Upgrade to Pro"
  // button and selects its tier (5x / 20x) with a toggle first.
  plans: Object.freeze({
    plus: Object.freeze({ tierLabels: Object.freeze([]), upgradeLabels: Object.freeze(['升级至 Plus', 'Upgrade to Plus', '重新订阅 Plus', 'Rejoin Plus']) }),
    pro_5x: Object.freeze({ tierLabels: Object.freeze(['5x']), upgradeLabels: Object.freeze(['升级至 Pro', 'Upgrade to Pro', '重新订阅 Pro', 'Rejoin Pro']) }),
    pro_20x: Object.freeze({ tierLabels: Object.freeze(['20x']), upgradeLabels: Object.freeze(['升级至 Pro', 'Upgrade to Pro', '重新订阅 Pro', 'Rejoin Pro']) }),
  }),
  questionnaireSkipLabels: Object.freeze(['跳过', 'Skip']),
  checkoutReadySelector: '[data-testid="checkout-page-content"]',
  // An account that already subscribes does not get a Checkout page: the
  // picker opens a "Confirm plan changes" dialog whose Pay button charges the
  // card on file immediately. The navigator can stop on that dialog.
  planChangeDialogLabels: Object.freeze(['Confirm plan changes', '确认套餐变更', '确认方案变更', '确认计划变更']),
  planChangePayLabels: Object.freeze(['Pay now', '立即支付', '立即付款', '现在支付']),
  planChangeCancelLabels: Object.freeze(['Cancel', '取消']),
  maxUpgradeAttempts: 2,
});

function planChangeDialog(page, contract) {
  const labels = contract.planChangeDialogLabels || [];
  if (!labels.length) throw new ContractError('planChangeDialogLabels is required for plan-change navigation');
  return page.locator(contract.pricingDialogSelector).filter({
    hasText: new RegExp(`(${labels.map(escapeRegExp).join('|')})`),
  });
}

async function planChangeDialogVisible(page, contract) {
  try { return (await visibleCount(planChangeDialog(page, contract))) >= 1; } catch { return false; }
}

async function targetReady(page, contract, expect, popups = null) {
  if (expect === 'plan-change') {
    if (await planChangeDialogVisible(page, contract)) return true;
    // An account without an active subscription gets a fresh Pro Checkout (often
    // in a new tab) instead of the plan-change dialog. That is a stop point too.
    if (popups && popups.some((popup) => popup.url().startsWith(contract.checkoutUrlPrefix))) return true;
    return page.url().startsWith(contract.checkoutUrlPrefix);
  }
  return checkoutReady(page, contract);
}

/** Read-only facts about a Pro Checkout that opened instead of the plan-change dialog. */
async function readCheckoutInsteadOfDialog(target, contract) {
  await target.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
  const labels = await target.locator('button:visible').allInnerTexts().catch(() => []);
  const cleaned = labels.map((label) => label.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return {
    urlDigest: digest(target.url()),
    tierLabels: cleaned.filter((label) => AMOUNT_PATTERN.test(label)).slice(0, 4),
    subscribePresent: cleaned.some((label) => /^(subscribe|订阅|立即订阅)$/i.test(label)),
    payButtonPresent: cleaned.some((label) => /^(pay now|立即支付|立即付款)$/i.test(label)),
  };
}

const AMOUNT_PATTERN = /[-−]?\s?(?:₱|PHP|\$|USD|€|£)\s?[\d,]+(?:\.\d{2})?/;

function amountIn(line) {
  const match = String(line || '').match(AMOUNT_PATTERN);
  return match ? match[0].replace(/\s+/g, '').replace('−', '-') : null;
}

/**
 * Reads the visible "Confirm plan changes" dialog without touching it. Amounts,
 * the card brand and last four digits are the only values kept; nothing else on
 * the dialog (and never anything outside it) is returned.
 */
export async function readPlanChangeDialog(page, contract = CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT) {
  const dialog = planChangeDialog(page, contract);
  if (await visibleCount(dialog) !== 1) throw new ContractError('plan change dialog drift');
  const text = String(await dialog.first().innerText());
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const find = (patterns) => lines.findIndex((line) => patterns.some((pattern) => pattern.test(line)));
  const amountAt = (index) => {
    if (index < 0) return null;
    return amountIn(lines[index]) || amountIn(lines[index + 1]) || null;
  };
  const subscriptionIndex = find([/subscription/i, /订阅/]);
  const adjustmentIndex = find([/adjustment/i, /抵扣|调整|折抵/]);
  const totalIndex = find([/total due/i, /今日应付|应付|合计/]);
  const paymentIndex = find([/payment method/i, /支付方式|付款方式/]);
  const paymentLine = paymentIndex >= 0 ? `${lines[paymentIndex]} ${lines[paymentIndex + 1] || ''}` : '';
  const card = paymentLine.match(/([A-Za-z]{2,20})\s*\*+\s?(\d{4})/);
  const pay = await uniqueVisibleButton(dialog.first(), contract.planChangePayLabels || [], 'plan change pay control', { optional: true });
  const cancel = await uniqueVisibleButton(dialog.first(), contract.planChangeCancelLabels || [], 'plan change cancel control', { optional: true });
  return {
    title: lines.find((line) => (contract.planChangeDialogLabels || []).some((label) => line.includes(label))) || null,
    subscriptionLine: subscriptionIndex >= 0 ? lines[subscriptionIndex] : null,
    subscriptionAmount: amountAt(subscriptionIndex),
    adjustmentAmount: amountAt(adjustmentIndex),
    totalDueToday: amountAt(totalIndex),
    paymentMethod: card ? { brand: card[1].toUpperCase(), last4: card[2] } : null,
    payButtonPresent: Boolean(pay),
    cancelButtonPresent: Boolean(cancel),
    lineCount: lines.length,
  };
}

/** Closes the plan-change dialog with its own Cancel control. Never touches Pay. */
export async function cancelPlanChangeDialog(page, contract = CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, {
  timeoutMs = 10_000, assertContinue = async () => undefined,
} = {}) {
  const dialog = planChangeDialog(page, contract);
  if (await visibleCount(dialog) !== 1) throw new ContractError('plan change dialog drift');
  const cancel = await uniqueVisibleButton(dialog.first(), contract.planChangeCancelLabels || [], 'plan change cancel control');
  await safeClick(cancel, 'plan change cancel control', assertContinue, timeoutMs);
  await waitForState(page, async () => ((await planChangeDialogVisible(page, contract)) ? null : 'closed'),
    { timeoutMs, label: 'plan change dialog dismissal' });
  return { cancelled: true };
}

/**
 * Opens a Plus Checkout Session and stops before payment material or submit.
 * Every allowed click is checked to ensure it cannot submit a form.
 */
export function resolvePlanSpec(contract, plan = 'plus') {
  const key = String(plan || 'plus').trim().toLowerCase();
  const spec = contract?.plans?.[key];
  if (spec) return { plan: key, tierLabels: [...(spec.tierLabels || [])], upgradeLabels: [...(spec.upgradeLabels || [])] };
  if (key === 'plus') return { plan: 'plus', tierLabels: [], upgradeLabels: [...(contract?.upgradeLabels || [])] };
  throw new ContractError(`checkout navigation has no plan spec for ${key}`);
}

export async function navigateToChatGPTCheckout(page, contract = CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, {
  timeoutMs = 20_000,
  assertContinue = async () => undefined,
  plan = 'plus',
  expect = 'checkout',
} = {}) {
  if (!page || typeof page.url !== 'function') throw new TypeError('page is required');
  if (!['checkout', 'plan-change'].includes(expect)) throw new ContractError('expect must be checkout or plan-change');
  const planSpec = resolvePlanSpec(contract, plan);
  if (!contract || typeof contract !== 'object') throw new ContractError('checkout navigation contract is required');
  if (typeof contract.homeUrlPrefix !== 'string' || !contract.homeUrlPrefix) throw new ContractError('homeUrlPrefix is required');
  if (typeof contract.checkoutUrlPrefix !== 'string' || !contract.checkoutUrlPrefix) throw new ContractError('checkoutUrlPrefix is required');
  if (!Number.isInteger(contract.maxUpgradeAttempts) || contract.maxUpgradeAttempts < 1 || contract.maxUpgradeAttempts > 3) {
    throw new ContractError('maxUpgradeAttempts must be between 1 and 3');
  }
  if (!page.url().startsWith(contract.homeUrlPrefix)) throw new ContractError('checkout navigation start URL drift');

  const actions = [];
  // plan-change mode: a fresh Checkout may open in a new tab on the upgrade click.
  const popups = [];
  const context = expect === 'plan-change' && typeof page.context === 'function' ? page.context() : null;
  const onPopup = (popup) => popups.push(popup);
  if (context?.on) context.on('page', onPopup);
  try {
  await assertNoSessionExpiredDialog(page);
  if (!await targetReady(page, contract, expect, popups)) {
    // A resumed run may already sit on the open plan picker; the header
    // control behind the modal is then covered and must not be clicked.
    const pickerAlreadyOpen = await pricingDialogVisible(page, contract);
    let openPricing = pickerAlreadyOpen ? null : await lastVisibleNavigationSelector(
      page,
      contract.openPricingSelectors,
      'open pricing control',
      { optional: true },
    );
    if (!openPricing && !pickerAlreadyOpen) {
      const profileMenu = await lastVisibleNavigationSelector(
        page,
        contract.profileMenuSelectors,
        'profile menu control',
      );
      await safeClick(profileMenu, 'profile menu control', assertContinue, timeoutMs);
      actions.push('profile-menu-opened');
      openPricing = await waitForState(page, async () => {
        const bySelector = await lastVisibleNavigationSelector(page, contract.profileUpgradeSelectors, 'profile upgrade control', { optional: true });
        if (bySelector) return bySelector;
        return uniqueVisibleMenuItem(page, contract.profileUpgradeLabels, 'profile upgrade control', { optional: true });
      }, { timeoutMs, label: 'profile upgrade control' });
    }
    if (pickerAlreadyOpen) {
      actions.push('pricing-already-open');
    } else {
      await safeClick(openPricing, 'open pricing control', assertContinue, timeoutMs);
      actions.push('pricing-opened');
      await waitForState(page, async () => {
        if (await targetReady(page, contract, expect, popups)) return 'target';
        return (await pricingDialogVisible(page, contract)) ? 'pricing' : null;
      }, { timeoutMs, label: 'pricing dialog' });
    }

    let questionnaireRaceRecoveries = 0;
    for (let attempt = 1; attempt <= contract.maxUpgradeAttempts; attempt += 1) {
      if (await targetReady(page, contract, expect, popups)) break;
      const preExistingQuestionnaire = await uniqueVisibleButton(
        page,
        contract.questionnaireSkipLabels,
        'questionnaire skip control',
        { optional: true },
      );
      if (preExistingQuestionnaire) {
        await safeClick(preExistingQuestionnaire, 'questionnaire skip control', assertContinue, timeoutMs);
        actions.push('questionnaire-skipped');
        await waitForState(page, async () => {
          const remaining = await uniqueVisibleButton(page, contract.questionnaireSkipLabels, 'questionnaire skip control', { optional: true });
          if (remaining) return null;
          return (await pricingDialogVisible(page, contract)) ? 'pricing' : null;
        }, { timeoutMs, label: 'pre-existing questionnaire dismissal' });
      }
      await assertNoSessionExpiredDialog(page);
      const dialog = pricingDialog(page, contract);
      if (await visibleCount(dialog) !== 1) throw new ContractError('pricing dialog drift');
      if (planSpec.tierLabels.length) {
        // Pro tier toggle (5x / 20x). It only changes the picker's selection.
        const tier = await uniqueVisibleButton(dialog, planSpec.tierLabels, `${planSpec.plan} tier control`);
        await safeClick(tier, `${planSpec.plan} tier control`, assertContinue, timeoutMs);
        actions.push(`tier-selected:${planSpec.tierLabels[0]}`);
        await page.waitForTimeout(250);
      }
      const upgrade = await uniqueVisibleButton(dialog, planSpec.upgradeLabels, `${planSpec.plan} upgrade control`);
      try {
        await safeClick(upgrade, `${planSpec.plan} upgrade control`, assertContinue, timeoutMs);
      } catch (error) {
        await assertNoSessionExpiredDialog(page);
        // The recommendation questionnaire can hydrate after the pricing
        // button was located but before Playwright dispatches the click. If it
        // is now visibly blocking the page, dismiss it and retry the same
        // upgrade attempt; no upgrade click has occurred in this branch.
        const racedQuestionnaire = await uniqueVisibleButton(
          page,
          contract.questionnaireSkipLabels,
          'questionnaire skip control',
          { optional: true },
        );
        if (!racedQuestionnaire || ++questionnaireRaceRecoveries > 2) { if (process.env.DEBUG_BROWSER_ERRORS === 'true') console.error('upgrade failed', error?.message); throw error; }
        await safeClick(racedQuestionnaire, 'questionnaire skip control', assertContinue, timeoutMs);
        actions.push('questionnaire-skipped');
        await waitForState(page, async () => {
          const remaining = await uniqueVisibleButton(page, contract.questionnaireSkipLabels, 'questionnaire skip control', { optional: true });
          return remaining ? null : 'pricing';
        }, { timeoutMs, label: 'raced questionnaire dismissal' });
        attempt -= 1;
        continue;
      }
      actions.push('upgrade-requested');

      let state;
      try {
        state = await waitForState(page, async () => {
          if (await targetReady(page, contract, expect, popups)) return 'target';
          const skip = await uniqueVisibleButton(page, contract.questionnaireSkipLabels, 'questionnaire skip control', { optional: true });
          return skip ? 'questionnaire' : null;
        }, { timeoutMs, label: `${expect} or questionnaire transition` });
      } catch (error) {
        // The live pricing dialog can render its text before the React action
        // is fully hydrated. A click may then be accepted by the DOM without
        // producing a transition. Retrying the non-form plan entry is safe and
        // bounded; never retry after the URL has entered Checkout.
        if (attempt < contract.maxUpgradeAttempts
          && page.url().startsWith(contract.homeUrlPrefix)
          && await pricingDialogVisible(page, contract)) {
          continue;
        }
        throw error;
      }
      if (state === 'target') break;

      const skip = await uniqueVisibleButton(page, contract.questionnaireSkipLabels, 'questionnaire skip control');
      await safeClick(skip, 'questionnaire skip control', assertContinue, timeoutMs);
      actions.push('questionnaire-skipped');
      await waitForState(page, async () => {
        const remaining = await uniqueVisibleButton(page, contract.questionnaireSkipLabels, 'questionnaire skip control', { optional: true });
        if (remaining) return null;
        return (await pricingDialogVisible(page, contract)) ? 'pricing' : null;
      }, { timeoutMs, label: 'questionnaire dismissal' });
    }
  }

  await waitForState(page, () => targetReady(page, contract, expect, popups), { timeoutMs, label: `${expect} readiness` });
  await assertContinue();
  if (expect === 'plan-change') {
    if (await planChangeDialogVisible(page, contract)) {
      return {
        plan: planSpec.plan,
        state: 'plan-change',
        plusEntryPresent: true,
        checkoutCreated: false,
        questionnaireSkipped: actions.includes('questionnaire-skipped'),
        actions,
        planChange: await readPlanChangeDialog(page, contract),
        submitCalls: 0,
      };
    }
    const popup = popups.find((candidate) => candidate.url().startsWith(contract.checkoutUrlPrefix));
    const target = popup || page;
    return {
      plan: planSpec.plan,
      state: popup ? 'checkout-popup' : 'checkout-same-page',
      plusEntryPresent: true,
      checkoutCreated: true,
      questionnaireSkipped: actions.includes('questionnaire-skipped'),
      actions,
      checkoutInsteadOfDialog: await readCheckoutInsteadOfDialog(target, contract),
      submitCalls: 0,
    };
  }
  return {
    plan: planSpec.plan,
    state: 'checkout',
    plusEntryPresent: true,
    checkoutCreated: actions.includes('upgrade-requested'),
    questionnaireSkipped: actions.includes('questionnaire-skipped'),
    actions,
    checkoutUrlDigest: digest(page.url()),
    submitCalls: 0,
  };
  } finally {
    if (context?.off) context.off('page', onPopup);
  }
}

/** Plus-only entry kept for existing callers and tests. */
export function navigateToChatGPTPlusCheckout(page, contract, options = {}) {
  return navigateToChatGPTCheckout(page, contract, { ...options, plan: 'plus' });
}
