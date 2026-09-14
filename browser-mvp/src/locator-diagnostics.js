/**
 * 「找到的不是一个」这类失败，必须把**找到了几个、它们长什么样**写进错误消息本身。
 *
 * 2026-09-13 的代价：一个真实客户单连着 8 次 `CHECKOUT_DRIFT`，日志里只有
 * `must resolve to one visible input` 这一句，查了一整天说不出卡在哪。而代码当时
 * 手里就攥着 `matches.length`——它知道答案，只是没说。更糟的是
 * `chatgpt-checkout-navigator.js` 把这个数字藏在 `DEBUG_BROWSER_ERRORS` 后面，
 * 生产环境永远不会开，等于没有。
 *
 * 只取结构特征，**绝不取值**：邮箱、卡号、姓名都可能出现在 value 里，
 * 而这条消息会进日志和数据库。
 */

/** 单个候选元素的可辨识特征（无值）。失败不抛，诊断本身不能反过来弄坏流程。 */
async function describeOne(locator, index) {
  const shape = await locator.evaluate((el) => ({
    tag: el.tagName?.toLowerCase() || null,
    type: el.getAttribute?.('type') || null,
    name: el.getAttribute?.('name') || null,
    id: el.id || null,
    ac: el.getAttribute?.('autocomplete') || null,
    filled: Boolean(el.value),          // 只说有没有值，不说值是什么
  })).catch(() => null);
  if (!shape) return `#${index + 1} <读不到>`;
  const bits = [shape.tag, shape.type && `type=${shape.type}`, shape.name && `name=${shape.name}`,
    shape.id && `id=${shape.id}`, shape.ac && `autocomplete=${shape.ac}`,
    shape.filled ? '已有值' : '空'].filter(Boolean);
  return `#${index + 1} ${bits.join(' ')}`;
}

/** 候选所在的 frame（用 host 区分主文档 / Stripe / Link / hCaptcha）。 */
function describeFrame(frame) {
  if (!frame || typeof frame.url !== 'function') return '?';
  const url = frame.url();
  if (!url || url === 'about:blank') return 'srcdoc';
  try { return new URL(url).host || 'srcdoc'; } catch { return url.slice(0, 24); }
}

/**
 * 给「期望恰好一个」的失败生成一句可直接读懂的补充说明。
 * @param {Array<{locator: any, frame?: any}>} candidates
 * @returns {Promise<string>} 形如 `找到 2 个: [chatgpt.com] #1 input name=email 空; [js.stripe.com] #2 ...`
 */
export async function describeCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return '找到 0 个';
  const parts = [];
  for (let i = 0; i < list.length && i < 6; i += 1) {
    const item = list[i];
    const locator = item?.locator ?? item;
    const where = item?.frame ? `[${describeFrame(item.frame)}] ` : '';
    parts.push(`${where}${await describeOne(locator, i)}`);
  }
  const more = list.length > 6 ? ` …另有 ${list.length - 6} 个` : '';
  return `找到 ${list.length} 个: ${parts.join('; ')}${more}`;
}
