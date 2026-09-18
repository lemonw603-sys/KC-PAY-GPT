/**
 * 第⑤步（面四③，D-257）：**什么算「卡台侧的一次成功扣款」**。
 *
 * 这是日对账「次数」那一半的判据。上一版写在 `card-consumption-audit.js:33`：
 * `LOWER(transaction_type)='purchase' AND LOWER(status)='success'`。它对着真实数据是这样的
 * （2026-09-18 生产实查 `card_transactions` 全量分组）：
 *
 *   101 purchase   success   3 笔（其中一笔 amount = -15.97）   ← 只有这 3 笔被算进去
 *   101 PURCHASE   SETTLED   3 笔                                ← 漏
 *   101 purchase   failed    1 笔 -78.24                          （本就不该算）
 *   103 PURCHASE   COMPLETE  20 笔                                ← 漏（highvcc 全部）
 *   103 PURCHASE   PENDING   3 笔                                 ← 漏（PENDING 也是真实扣款）
 *
 * 所以 D-257 的结论是对的：**这不是「放宽白名单」能修的**，得把四件事分开定义。
 *
 * ① 类型：两台都写 `purchase`，只是大小写不一（hnskj 同一张表里两种都有）。归一化后比较。
 * ② 状态：归一化后成功态是三个词 —— hnskj `success`/`SUCCESS`/`SETTLED`，highvcc `COMPLETE`。
 *    highvcc 还有 `PENDING`：它是**授权已发生、尚未清算**，钱已经被扣住了（3336 那笔 142.54 就是
 *    PENDING，而 Lemon 确认他真的用那张卡付过款）。所以 PENDING **算扣款**，但单独计数，
 *    让看板能区分「已清算」与「还挂着」。`failed` 不算。
 * ③ 符号：hnskj 的 amount 有负数（8590 的 -15.97 与 -78.24）。**符号不统一是卡台的事实，不是错误**，
 *    对账比的是「笔数」和「绝对金额」，所以一律取绝对值，并把负数行标出来给人看。
 * ④ 金额为 0 的授权（highvcc 两笔 `PENDING 0.00`）：是占位授权，不是扣款，**不计数**。
 *
 * 判据只认这四条，**不认商户名**：把 `OPENAI` 写进判据等于假设卡只用来买 ChatGPT，而 0237 卡上
 * 就有一笔 `ANTHROPIC* CLAUDE SUB` 100.00。商户名只用来在报告里解释差异，不参与计数。
 */

// 只写**在生产真实数据里见过的**状态值（2026-09-18 全量分组）。多写一个就是替卡台下结论：
// 这条判据上一版失效，起因正是拿「自己觉得应该叫 success」当真。没见过的状态不猜，
// 走 UNKNOWN_STATUS 进报告让人看（CLAUDE.md：未知状态进人工，不默认映射成功或失败）。
const PURCHASE_TYPES = new Set(['PURCHASE']);
const SETTLED_STATUSES = new Set(['SUCCESS', 'SETTLED', 'COMPLETE']);
const PENDING_STATUSES = new Set(['PENDING']);
const NOT_CHARGED_STATUSES = new Set(['FAILED', 'FAIL', 'DECLINED', 'CANCELLED', 'CANCELED']);

export const ChargeKind = Object.freeze({
  SETTLED: 'SETTLED',             // 已清算的扣款
  PENDING: 'PENDING',             // 授权已发生、未清算——钱已被扣住
  ZERO_AUTH: 'ZERO_AUTH',         // 0 元占位授权，不是扣款
  UNKNOWN_STATUS: 'UNKNOWN_STATUS', // purchase，但状态是没见过的词——报出来，不替它决定
  NOT_A_CHARGE: 'NOT_A_CHARGE'
});

function normalize(value) {
  return String(value ?? '').trim().toUpperCase();
}

/** 金额取绝对值的整数分；读不出来返回 null（读不出就不猜，进报告的 unreadable 组）。 */
export function absoluteAmountCents(amount) {
  const text = String(amount ?? '').trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.abs(value) * 100);
}

export function classifyCharge(row) {
  if (!PURCHASE_TYPES.has(normalize(row?.transaction_type ?? row?.type))) return ChargeKind.NOT_A_CHARGE;
  const status = normalize(row?.status);
  if (NOT_CHARGED_STATUSES.has(status)) return ChargeKind.NOT_A_CHARGE;
  const isSettled = SETTLED_STATUSES.has(status);
  const isPending = PENDING_STATUSES.has(status);
  if (!isSettled && !isPending) return ChargeKind.UNKNOWN_STATUS;
  const cents = absoluteAmountCents(row?.amount);
  if (cents === null) return ChargeKind.UNKNOWN_STATUS;
  if (cents === 0) return ChargeKind.ZERO_AUTH;
  return isSettled ? ChargeKind.SETTLED : ChargeKind.PENDING;
}

/** 算进「这张卡被扣了几次」的那些（已清算 + 挂着的授权）。 */
export function countsAsCharge(row) {
  const kind = classifyCharge(row);
  return kind === ChargeKind.SETTLED || kind === ChargeKind.PENDING;
}

/** 拒付与拒付手续费：算的是「钱出去了多少」，不算购买次数。 */
const CHARGEBACK_TYPES = new Set(['CHARGEBACK', 'CHARGE_BACK', 'DISPUTE']);
const CHARGEBACK_FEE_TYPES = new Set(['CHARGEBACK_FEE']);

export function isChargeback(row) {
  return CHARGEBACK_TYPES.has(normalize(row?.transaction_type ?? row?.type));
}

export function isChargebackFee(row) {
  return CHARGEBACK_FEE_TYPES.has(normalize(row?.transaction_type ?? row?.type));
}

/** SQL 片段：在数据库侧用同一套判据筛「算作扣款」的流水，免得两边各写一份跑偏。 */
export function chargeRowSql(alias = 't') {
  const settled = [...SETTLED_STATUSES].map((s) => `'${s}'`).join(', ');
  const pending = [...PENDING_STATUSES].map((s) => `'${s}'`).join(', ');
  return `UPPER(TRIM(${alias}.transaction_type)) = 'PURCHASE'
    AND UPPER(TRIM(${alias}.status)) IN (${settled}, ${pending})
    AND ABS(${alias}.amount) > 0`;
}

export function settledStatusSql(alias = 't') {
  return `UPPER(TRIM(${alias}.status)) IN (${[...SETTLED_STATUSES].map((s) => `'${s}'`).join(', ')})`;
}
