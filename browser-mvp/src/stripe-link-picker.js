/* =========================================================================
   Stripe Link 接管支付区时，切到「新的付款方式」（D-201）。

   为什么需要它：Stripe Link 的会话按设备（__stripe_mid）恢复，**清 cookie 拦不住**
   （D-200 试过，页面一加载就被重新发放）。运营手动付款一次之后，Link 就在这个窗口里
   记住了那次的邮箱和卡；之后任何客户的单跑到结账页，Link 都会占住「Pay with」的位置，
   **卡号/有效期/CVV 三个框根本不渲染**，于是连环报
   `secure card fields did not become ready` / `CHECKOUT_DRIFT`。
   2026-09-13 实测：当前订单的客户是 chenxing66623@gmail.com，而 Link 邮箱框里是
   上一个客户 qixuanyu03@gmail.com——这同时是一条跨客户的支付方式泄露路径。

   不跟 Stripe 的状态较劲，改在 UI 上选「用新卡」，两步点击：
     button.p-PickerAction          → 展开已保存方式列表（菲律宾语显示「Palitan」）
     [role=button].p-PickerItem--new → 新的付款方式（「Bagong paraan ng pagbabayad」）
   这两个 class 来自 Stripe 自己的设计系统前缀，**不随界面语言变**——当天的页面是
   菲律宾语（Stripe 按菲律宾出口 IP 定的 p-Locale-fil），靠文案匹配必然失效。

   **不点 `Alisin`（移除）**：那会删掉客户自己的支付方式。选「用新卡」达到同样效果，
   而且不动客户的数据，也不替客户承担删除责任。
   ========================================================================= */

import { SECURE_CARD_FIELD_SELECTORS } from './nonpayment-card-fill.js';

const CHANGE_BUTTON = 'button.p-PickerAction';
const NEW_METHOD_ITEM = '[role=button].p-PickerItem--new';

async function oneVisibleOrNull(page, selector) {
  const matches = [];
  for (const frame of page.frames()) {
    const locator = frame.locator(selector);
    for (let index = 0; index < await locator.count(); index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) matches.push(candidate);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * 若结账页被已保存的支付方式（Stripe Link）接管，就切换到「新的付款方式」。
 *
 * 没有被接管时**什么都不做**——绝大多数单走的是这条路径，不能因为多了这一步就改变
 * 正常流程的行为。返回值只用于留证与断言，不影响调用方的控制流。
 */
// 卡号框的选择器只用项目里那一份，不自己编（2026-09-13 我编了 input[name="number"]，
// 与既有的 cc-number 口径不符，于是等支付区时永远等不到卡字段）。
const CARD_NUMBER_FIELD = SECURE_CARD_FIELD_SELECTORS.cardNumber;

/**
 * 等到支付区**真正就绪**：要么卡号框出现（正常页面），要么「更改」按钮出现（Link 接管）。
 *
 * 为什么必须等（2026-09-13 教训）：第一版查一次找不到就返回 false，而结账页导航完
 * 4 秒时 Stripe 的 iframe 还没挂上——埋点记着 detected:false，现场页面上 Palitan
 * 按钮却明明在。判断做在页面就绪之前，等于没判断。
 *
 * 卡号框先出现就立刻返回，所以**正常单不会被这一步拖慢**。
 */
async function waitForPaymentArea(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const card = await oneVisibleOrNull(page, CARD_NUMBER_FIELD);
    if (card) return 'card-fields';
    const change = await oneVisibleOrNull(page, CHANGE_BUTTON);
    if (change) return 'saved-method';
    if (Date.now() >= deadline) return 'neither';
    await page.waitForTimeout(200);
  } while (true);
}

export async function dismissSavedPaymentMethod(page, { timeoutMs = 8000 } = {}) {
  if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
  const area = await waitForPaymentArea(page, timeoutMs);
  // 卡字段已经在了：支付区是干净的新卡表单，什么都不用做。
  if (area === 'card-fields') return { savedMethodDetected: false, switchedToNewMethod: false, area };
  const changeButton = await oneVisibleOrNull(page, CHANGE_BUTTON);
  if (!changeButton) return { savedMethodDetected: false, switchedToNewMethod: false, area };

  await changeButton.click({ timeout: timeoutMs });

  // 展开是异步的：轮询等「新的付款方式」这一项出现，不做一次性快照。
  const deadline = Date.now() + timeoutMs;
  let newMethod = null;
  do {
    newMethod = await oneVisibleOrNull(page, NEW_METHOD_ITEM);
    if (newMethod) break;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(100);
  } while (true);

  // 展开了却没有「新的付款方式」这一项：如实报告，让后续的卡字段检查按原样 fail closed，
  // 不在这里猜测页面形态、也不去点别的按钮。
  if (!newMethod) return { savedMethodDetected: true, switchedToNewMethod: false, area };

  await newMethod.click({ timeout: timeoutMs });
  return { savedMethodDetected: true, switchedToNewMethod: true, area };
}

export const STRIPE_LINK_SELECTORS = Object.freeze({ CHANGE_BUTTON, NEW_METHOD_ITEM });
