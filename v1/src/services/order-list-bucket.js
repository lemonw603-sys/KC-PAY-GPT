// 订单页 v3（D-356/D-357）的两个派生量：一行落在哪个「桶」、此刻唯一可做的动作是什么。
// 只从列表查询已经投影出来的字段推，不另查库；真正的守卫在各动作端点里（取消 / 收口 /
// 取消续费确认 / 手工标成功），这里只决定列表上摆哪个按钮。
//
// 桶（与筛选四选一一致，也是 summary 的口径）：
//   action     = needs_person（REVIEW_REQUIRED 谓词：等 Session / 付款不明 / 续费待确认 / 已付款未交付 / 卡失败 / 卡台调用卡住）
//   success    = RECHARGE_SUCCESS 且不需要人
//   failed     = RECHARGE_FAILED / CLOSED / CARD_FAILED 且不需要人
//   processing = 其余（CREATED / 等卡 / 分卡中 / 已分卡 / 处理中 / 付款中 / 取消续费中）

export const FAILED_BUCKET_STATUSES = Object.freeze(['RECHARGE_FAILED', 'CLOSED', 'CARD_FAILED']);
const PAYMENT_UNKNOWN_STATUSES = new Set(['SUBMIT_UNKNOWN', 'RECONCILIATION_REQUIRED']);
const CANCELLABLE_STATUSES = new Set(['CREATED', 'WAITING_FOR_CARD', 'CARD_READY', 'WAITING_FOR_SESSION']);

export function orderBucket({ status, needsPerson }) {
  if (needsPerson) return 'action';
  if (status === 'RECHARGE_SUCCESS') return 'success';
  if (FAILED_BUCKET_STATUSES.includes(status)) return 'failed';
  return 'processing';
}

/**
 * 此刻唯一可做的动作。返回 null 表示这一单现在没有需要人做的。
 * 顺序即优先级：付款不明先于一切（钱的事），其次放卡，其次续费确认，最后手工标成功。
 */
export function primaryOrderAction({ status, needsPerson, cancellationReviewRequired, failedAfterPayment, run }) {
  const unknownRun = run && ['RECONCILE_ONLY', 'HUMAN_REQUIRED'].includes(run.status)
    && ['PAYMENT_UNKNOWN', 'PAYMENT_CONFIRMED'].includes(run.paymentState);
  if (PAYMENT_UNKNOWN_STATUSES.has(status) || (needsPerson && unknownRun)) {
    return { key: 'verify', label: '去核实' };
  }
  if (CANCELLABLE_STATUSES.has(status)) return { key: 'cancel', label: '取消并放卡' };
  if (status === 'CANCELLATION_REVIEW_REQUIRED' || (status === 'RECHARGE_SUCCESS' && cancellationReviewRequired)) {
    return { key: 'renewal', label: '已在账号里取消续费' };
  }
  if (status === 'RECHARGE_FAILED' && !failedAfterPayment) return { key: 'manual', label: '标为已手工充值' };
  return null;
}
