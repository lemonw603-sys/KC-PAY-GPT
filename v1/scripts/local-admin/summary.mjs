// 快照的一屏摘要（refresh / up / status 打印；也是 verify 比对的「关键数」）。
// 这里的数全部由快照各组相加得到（组里的「演练单 / 成功事件 / 库存口径」判定是生产规则当场算的），不另定口径。

const sum = (rows, pick = () => true) => (rows || []).filter(pick).reduce((n, row) => n + Number(row.count || 0), 0);
const FINISHED = new Set(['RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'CLOSED']);
const isSuccess = (row) => row.status === 'RECHARGE_SUCCESS' || (row.status === 'CLOSED' && row.closedLastStatus === 'RECHARGE_SUCCESS');
const PROCESSING = new Set(['CREATED', 'WAITING_FOR_CARD', 'CARD_PURCHASING', 'CARD_PROVISIONING', 'SUBMITTING',
  'RECHARGE_PROCESSING', 'CANCELLATION_PENDING']);

/** 关键数（与工作台上显示的同名格子一一对应）。 */
export function keyNumbers(shape) {
  const orders = shape.orders || [];
  const recent = (row) => FINISHED.has(row.status) && Number(row.dayOffset) <= 6 && !Number(row.rehearsal);
  const recentFinished = sum(orders, recent);
  // 工作台「近7天成功率」的分子：RECHARGE_SUCCESS，或 CLOSED 且有过 RECHARGE_SUCCESS 事件（admin-read-service）。
  const recentSuccessful = sum(orders, (row) => recent(row)
    && (row.status === 'RECHARGE_SUCCESS' || (row.status === 'CLOSED' && Number(row.successEvent))));
  const recentAutomatic = sum(orders, (row) => recent(row) && !Number(row.humanTouched)
    && (row.status === 'RECHARGE_SUCCESS' || (row.status === 'CLOSED' && Number(row.successEvent))));
  const byStatus = {};
  for (const row of orders) byStatus[row.status] = (byStatus[row.status] || 0) + Number(row.count || 0);
  const cdkByStatus = {};
  for (const row of shape.cdks || []) cdkByStatus[row.status] = (cdkByStatus[row.status] || 0) + Number(row.count || 0);
  const stock = {};
  for (const [key, product] of [['stockPlus', 'plus'], ['stockPro5x', 'pro_5x'], ['stockPro20x', 'pro_20x']]) {
    for (const row of shape[key] || []) {
      stock[`${row.providerCode}/${product}`] = { stock: Number(row.stockAvailable || 0), remainingOrders: Number(row.remainingOrders || 0) };
    }
  }
  const wallets = {};
  for (const p of shape.providers || []) if (p.walletBalance != null) wallets[p.providerCode] = Number(p.walletBalance);
  return {
    orders: sum(orders),
    ordersByStatus: byStatus,
    todayOrders: sum(orders, (row) => Number(row.dayOffset) === 0),
    processingOrders: sum(orders, (row) => PROCESSING.has(row.status)),
    last30Days: sum(orders, (row) => Number(row.dayOffset) <= 29),
    recentFinished,
    recentSuccessful,
    recentAutomatic,
    finishedSuccess: sum(orders, isSuccess),
    openWarningAlerts: sum(shape.alerts, (row) => row.status === 'OPEN' && ['warning', 'critical'].includes(row.severity)),
    openAlerts: sum(shape.alerts, (row) => row.status === 'OPEN'),
    cards: sum(shape.cards),
    cdkByStatus,
    stock,
    wallets
  };
}

export function summarizeShape(shape) {
  const k = keyNumbers(shape);
  const rate = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
  const stock = Object.entries(k.stock).filter(([, v]) => v.stock || v.remainingOrders)
    .map(([key, v]) => `${key} 剩 ${v.stock} 张·能充 ${v.remainingOrders} 单`).join('；') || '全部 0';
  return [
    `快照抓取于 ${shape.capturedAt}（UTC）`,
    `订单 ${k.orders}（${Object.entries(k.ordersByStatus).map(([s, n]) => `${s} ${n}`).join(' / ')}）；今日 ${k.todayOrders}；近 30 天 ${k.last30Days}`,
    `近7天成功率 ${rate(k.recentSuccessful, k.recentFinished)}（成功 ${k.recentSuccessful} / 样本 ${k.recentFinished}）；自动完成 ${k.recentAutomatic}`,
    `卡 ${k.cards} 张；库存口径：${stock}`,
    `提醒（warning/critical OPEN）${k.openWarningAlerts} 条；全部 OPEN ${k.openAlerts} 条`,
    `卡密：${Object.entries(k.cdkByStatus).map(([s, n]) => `${s} ${n}`).join(' / ')}`,
    `钱包（取整）：${Object.entries(k.wallets).map(([p, v]) => `${p} $${v}`).join('；') || '无'}`
  ].join('\n');
}
