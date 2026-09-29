// 「这张卡被运营手动用过」的标记，唯一口径（欠账 36，D-412 补记三）。
//
// 日对账只认停用原因里这个英文标识，把卡台多出来的扣款算作「已登记手动用卡」而不是
// 「无主扣款」（daily-reconciliation-service 的 loadCards）。而改写停用原因的地方不止一处——
// 后台「已销卡」（card-retirement-service.confirmRetired）和「停用」（card-operational-override-service.set）
// 都会整句覆盖。覆盖时新原因没带标记，这张卡的历史扣款第二天就变成「无主扣款」。
// 「手动用过」是已经发生的事实，不会因为后来又停用 / 销卡而失效，所以覆盖时要把它带过去。

export const MANUAL_USE_REASON_REGEXP = 'manual[-_ ]used|manually';
const MANUAL_USE_RE = new RegExp(MANUAL_USE_REASON_REGEXP);

/** 和日对账的 `LOWER(o.reason) REGEXP ...` 同一判据。 */
export function hasManualUseMarker(reason) {
  return MANUAL_USE_RE.test(String(reason ?? '').toLowerCase());
}

const MARKER_SUFFIX = '｜manual-used';

/**
 * 要写入的新原因。原原因带手动用卡标记、新原因没带时，在新原因**末尾**补上标记——
 * 末尾而不是开头，是因为后台按第一个冒号前那段解析原因码（`MANUAL_USED: …` / `OTHER: …`）。
 * 超长时截新原因的正文，保证标记本身不会被截掉。
 */
export function reasonKeepingManualUse(previousReason, nextReason, maxLength = 500) {
  const next = String(nextReason ?? '');
  if (!hasManualUseMarker(previousReason) || hasManualUseMarker(next)) return next.slice(0, maxLength);
  return next.slice(0, maxLength - MARKER_SUFFIX.length) + MARKER_SUFFIX;
}
