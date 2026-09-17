// 开卡真实成本 = 开卡前后账户余额之差 − 开进卡里的金额（D-249 面四② T2）。
//
// 为什么不按费率表算（原方案 A）：费率表算出来的永远是「一个数」，卡台哪天改价、
// 或者某张卡段费率不同，库里就一直安安静静地记错，没有任何人会发现。余额差是观察，
// 算不准的时候它会承认算不准。
//
// 为什么这个差值可信：开卡是串行的（openStockCards 的循环，卡与卡之间还隔 10 秒），
// 前后两次读余额之间只夹着一次 purchaseCard，窗口是秒级。相比之下定时快照是 5 分钟
// 一条，2026-09-14 那次开卡就因为窗口内 Lemon 往账户充了钱，差值被污染到算不出来。
//
// 生产实测（两个干净样本，相邻两次动账之间只有这一笔）：
//   开卡 $16：106.06 → 89.48，差 16.58 → 成本 $0.58
//   补值 $50：121.77 → 71.52，差 50.25 → 成本 $0.25（= 0.5%）
// 对上 D-229 记的「hnskj 开卡 $0.5 / 支付 0.5%」：0.50 + 16×0.5% = 0.58。
// 但费率是**对照**，不是**依据**——本模块只信余额差，不拿费率去校正观察。

/** 定点美元字符串 → 整数分。不走浮点（CLAUDE.md：金额不用 JS 浮点结算）。 */
export function toCents(value) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  // 超过两位小数的尾数直接拒绝，不四舍五入：余额本来就是两位，出现第三位说明
  // 读到的不是我以为的那个东西，宁可算不出也不要悄悄抹掉它。
  if (/[^0]/.test(fraction.slice(2))) return null;
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** 整数分 → 定点美元字符串。 */
export function fromCents(cents) {
  if (!Number.isInteger(cents)) return null;
  const digits = String(Math.abs(cents)).padStart(3, '0');
  return `${cents < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/**
 * 差值可信的上限：开卡金额的 10% 再加 $1。
 *
 * 这道闸门是用来认出「窗口里混进了别的动账」的，不是用来验证费率对不对。
 * 污染通常是几十美元级（另一笔充值、另一张卡），这个宽度足够抓住，同时不会
 * 把小额卡的正常成本误判掉：$5 卡的成本约 $0.53，单算 10% 只有 $0.50 会误伤，
 * 加上那 $1 的底就安全了。
 */
export function maxPlausibleFeeCents(openCardAmountCents) {
  return Math.floor(openCardAmountCents / 10) + 100;
}

/**
 * 算一次开卡的真实成本。
 *
 * 返回 { ok: true, feeCents, fee } 或 { ok: false, reason, ... }。
 * 算不出来一律返回 ok:false 并说明原因，绝不退化成 0 或退化成费率推算值——
 * 一个假的 0 会让「这张卡花了多少钱」永远差一截，而且没人看得出来。
 */
export function computeIssueFee({ balanceBefore, balanceAfter, openCardAmount } = {}) {
  const before = toCents(balanceBefore);
  const after = toCents(balanceAfter);
  const amount = toCents(openCardAmount);
  if (before === null || after === null || amount === null) {
    return { ok: false, reason: 'UNREADABLE_AMOUNTS' };
  }
  if (amount <= 0) return { ok: false, reason: 'INVALID_OPEN_CARD_AMOUNT' };

  const spentCents = before - after;
  const feeCents = spentCents - amount;

  if (spentCents <= 0) {
    // 余额没少反而没变或变多：这一趟里必定还有别的动账（有人充了钱），差值没有意义。
    return { ok: false, reason: 'BALANCE_DID_NOT_DROP', spent: fromCents(spentCents) };
  }
  if (feeCents < 0) {
    // 扣的钱比开卡金额还少，不可能。多半是前后两次读数中间账上进了钱。
    return { ok: false, reason: 'SPENT_LESS_THAN_CARD_AMOUNT', spent: fromCents(spentCents), fee: fromCents(feeCents) };
  }
  const limit = maxPlausibleFeeCents(amount);
  if (feeCents > limit) {
    return {
      ok: false, reason: 'FEE_ABOVE_PLAUSIBLE_RANGE',
      spent: fromCents(spentCents), fee: fromCents(feeCents), limit: fromCents(limit),
    };
  }
  return { ok: true, feeCents, fee: fromCents(feeCents), spent: fromCents(spentCents) };
}

/** 本地观察出来的开卡费用行，前缀写死 LOCAL_，一眼能看出不是卡台流水。 */
export const CARD_ISSUE_FEE_TYPE = 'CARD_ISSUE_FEE';
export const CARD_ISSUE_FEE_STATUS = 'OBSERVED';

export function issueFeeTransactionId(providerCardId) {
  const id = String(providerCardId ?? '').trim();
  return id ? `LOCAL_ISSUE_FEE_${id}` : null;
}
