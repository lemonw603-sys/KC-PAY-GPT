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

async function uniqueVisibleButton(scope, labels, label, { optional = false } = {}) {
  const matches = [];
  for (const name of labels || []) {
    const locator = scope.getByRole('button', { name, exact: true });
    for (let index = 0; index < await locator.count(); index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) matches.push(candidate);
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
  await assertSafeNavigationControl(locator, label);
  try {
    await locator.click({ timeout: Math.min(timeoutMs, 5_000) });
  } catch (error) {
    throw new ContractError(`${label} click failed: ${String(error.message || error).split('\n')[0]}`);
  }
}

async function waitForState(page, predicate, { timeoutMs, label }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await predicate();
    if (state) return state;
    await page.waitForTimeout(100);
  }
  throw new ContractError(`${label} timed out`);
}

async function checkoutReady(page, contract) {
  if (!page.url().startsWith(contract.checkoutUrlPrefix)) return false;
  const marker = page.locator(contract.checkoutReadySelector);
  return (await marker.count()) === 1 && await marker.isVisible();
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
  questionnaireSkipLabels: Object.freeze(['跳过', 'Skip']),
  checkoutReadySelector: '[data-testid="checkout-page-content"]',
  maxUpgradeAttempts: 2,
});

/**
 * Opens a Plus Checkout Session and stops before payment material or submit.
 * Every allowed click is checked to ensure it cannot submit a form.
 */
export async function navigateToChatGPTPlusCheckout(page, contract = CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, {
  timeoutMs = 20_000,
  assertContinue = async () => undefined,
} = {}) {
  if (!page || typeof page.url !== 'function') throw new TypeError('page is required');
  if (!contract || typeof contract !== 'object') throw new ContractError('checkout navigation contract is required');
  if (typeof contract.homeUrlPrefix !== 'string' || !contract.homeUrlPrefix) throw new ContractError('homeUrlPrefix is required');
  if (typeof contract.checkoutUrlPrefix !== 'string' || !contract.checkoutUrlPrefix) throw new ContractError('checkoutUrlPrefix is required');
  if (!Number.isInteger(contract.maxUpgradeAttempts) || contract.maxUpgradeAttempts < 1 || contract.maxUpgradeAttempts > 3) {
    throw new ContractError('maxUpgradeAttempts must be between 1 and 3');
  }
  if (!page.url().startsWith(contract.homeUrlPrefix)) throw new ContractError('checkout navigation start URL drift');

  const actions = [];
  if (!await checkoutReady(page, contract)) {
    let openPricing = await lastVisibleNavigationSelector(
      page,
      contract.openPricingSelectors,
      'open pricing control',
      { optional: true },
    );
    if (!openPricing) {
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
    await safeClick(openPricing, 'open pricing control', assertContinue, timeoutMs);
    actions.push('pricing-opened');
    await waitForState(page, async () => {
      if (await checkoutReady(page, contract)) return 'checkout';
      const dialog = page.locator(contract.pricingDialogSelector);
      return (await visibleCount(dialog)) === 1 ? 'pricing' : null;
    }, { timeoutMs, label: 'pricing dialog' });

    let questionnaireRaceRecoveries = 0;
    for (let attempt = 1; attempt <= contract.maxUpgradeAttempts; attempt += 1) {
      if (await checkoutReady(page, contract)) break;
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
          const currentDialog = page.locator(contract.pricingDialogSelector);
          return (await visibleCount(currentDialog)) === 1 ? 'pricing' : null;
        }, { timeoutMs, label: 'pre-existing questionnaire dismissal' });
      }
      const dialog = page.locator(contract.pricingDialogSelector);
      if (await visibleCount(dialog) !== 1) throw new ContractError('pricing dialog drift');
      const upgrade = await uniqueVisibleButton(dialog, contract.upgradeLabels, 'Plus upgrade control');
      try {
        await safeClick(upgrade, 'Plus upgrade control', assertContinue, timeoutMs);
      } catch (error) {
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
          if (await checkoutReady(page, contract)) return 'checkout';
          const skip = await uniqueVisibleButton(page, contract.questionnaireSkipLabels, 'questionnaire skip control', { optional: true });
          return skip ? 'questionnaire' : null;
        }, { timeoutMs, label: 'checkout or questionnaire transition' });
      } catch (error) {
        // The live pricing dialog can render its text before the React action
        // is fully hydrated. A click may then be accepted by the DOM without
        // producing a transition. Retrying the non-form plan entry is safe and
        // bounded; never retry after the URL has entered Checkout.
        if (attempt < contract.maxUpgradeAttempts
          && page.url().startsWith(contract.homeUrlPrefix)
          && await visibleCount(page.locator(contract.pricingDialogSelector)) === 1) {
          continue;
        }
        throw error;
      }
      if (state === 'checkout') break;

      const skip = await uniqueVisibleButton(page, contract.questionnaireSkipLabels, 'questionnaire skip control');
      await safeClick(skip, 'questionnaire skip control', assertContinue, timeoutMs);
      actions.push('questionnaire-skipped');
      await waitForState(page, async () => {
        const remaining = await uniqueVisibleButton(page, contract.questionnaireSkipLabels, 'questionnaire skip control', { optional: true });
        if (remaining) return null;
        const currentDialog = page.locator(contract.pricingDialogSelector);
        return (await visibleCount(currentDialog)) === 1 ? 'pricing' : null;
      }, { timeoutMs, label: 'questionnaire dismissal' });
    }
  }

  await waitForState(page, () => checkoutReady(page, contract), { timeoutMs, label: 'Checkout readiness' });
  await assertContinue();
  return {
    plusEntryPresent: true,
    checkoutCreated: actions.includes('upgrade-requested'),
    questionnaireSkipped: actions.includes('questionnaire-skipped'),
    actions,
    checkoutUrlDigest: digest(page.url()),
    submitCalls: 0,
  };
}
