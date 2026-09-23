/**
 * 补款判定（D-354，2026-09-23）：卡台同步回来的余额比库里记的高，多出来的那部分就是
 * 有人往卡里补了钱（highvcc 上手动充、hnskj 上手动充都走这里）。
 *
 * 为什么必须把它记进 funded_amount：分卡资格（card-inventory-eligibility.js，D-217）取
 * 「同步余额」与「funded_amount − 账本消费」两者较小值。补钱只抬同步余额、不抬
 * funded_amount，于是一张真有 $31.99 的卡按 $3.27 算，永远不合格（2026-09-23 卡 0601 实例）。
 *
 * 边界：
 * - 只认「涨」。余额降了是消费/拒付，由账本与 D-217 的较小值兜住，这里不碰。
 * - 一分钱以内的浮动不算补款（避免两边四舍五入把 funded 抬来抬去）。
 * - 任一侧不是有限数（首次入库、余额 NULL）→ 不算补款。
 */
const MONEY = /^-?\d+(?:\.\d{1,6})?$/;

function toNumber(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!MONEY.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** 返回补款金额（六位小数的字符串），没有补款返回 null。 */
export function detectTopUp(previousBalance, nextBalance) {
  const previous = toNumber(previousBalance);
  const next = toNumber(nextBalance);
  if (previous == null || next == null) return null;
  const delta = Math.round((next - previous) * 1_000_000) / 1_000_000;
  if (delta < 0.01) return null;
  return delta.toFixed(6);
}

/** funded_amount 加上补款后的新值（六位小数的字符串）。funded 缺失时按 0 起算。 */
export function fundedAmountAfterTopUp(fundedAmount, topUp) {
  const funded = toNumber(fundedAmount) ?? 0;
  const delta = toNumber(topUp);
  if (delta == null || delta <= 0) return funded.toFixed(6);
  return (Math.round((funded + delta) * 1_000_000) / 1_000_000).toFixed(6);
}
