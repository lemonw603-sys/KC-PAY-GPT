/**
 * 第⑤步（面四①，D-249）：**哪些告警值得占用手机**。
 *
 * 旧规则是排除法（`PHONE_SILENT_TYPES`，D-176）：除两个中间态外全推。近 7 天推 99 条、真需要
 * 人的 <10 条，噪音来自「默认推」这个方向本身——每加一个新告警类型就自动多一路推送，没人
 * 会记得回来关。**改成白名单：不在表里的一律只进后台。**
 *
 * 四类的依据是契约表三（`docs/contracts/2026-09-18_human-intervention-points-contract.md`）
 * 的「A 必须叫」行，不是按严重级别拍的：
 *
 *   HUMAN    叫人——系统已经停手，不做点什么这一单就一直停着（表三 #3/#4/#5/#6/#9/#10）
 *   SUPPLY   供给——还没卡住客户，但再不动手就会（缺卡预警、开卡失败、钱包低于告警线）
 *   MONEY    资金——钱的去向变了，事后再看就来不及（拒付、余额变化、取消续费未确认=续订会再扣）
 *   CUSTOMER 客户动态——客户刚提交，Lemon 要知道有人在等（D-175）
 *
 * **不在白名单里的都有理由，写在 `NON_PUSH_REASONS` 里**，不是漏掉的：新增告警类型时先去那张
 * 表里给个理由，再决定要不要进白名单。
 */

export const PushCategory = Object.freeze({
  HUMAN: 'HUMAN',
  SUPPLY: 'SUPPLY',
  MONEY: 'MONEY',
  CUSTOMER: 'CUSTOMER'
});

export const PHONE_PUSH_TYPES = Object.freeze({
  // —— 叫人（契约表三 A 项）——
  BROWSER_HUMAN_VERIFICATION: PushCategory.HUMAN,   // #4 结账页人机验证，只有人能过
  BROWSER_HUMAN_REQUIRED: PushCategory.HUMAN,       // #6 Browser 付款不明，两路证据定不了
  ORDER_PAYMENT_UNKNOWN_REVIEW: PushCategory.HUMAN, // #5 API 付款不明，同上
  BROWSER_ORDER_FAILED: PushCategory.HUMAN,         // #3 付款前失败、现场保留 90s 等接手
  BROWSER_ORDER_STALLED: PushCategory.HUMAN,        // 客户排队没人处理 / 付款结果久不落定（D-176 说的「真卡住」）
  ORDER_WAITING_FOR_CARD: PushCategory.HUMAN,       // #9 缺卡且没有自动补卡在途 = 开不出，要人
  CARD_SUPPLY_OPEN_FAILED: PushCategory.HUMAN,      // #9 调度器开卡失败
  PROVIDER_TOKEN_EXPIRED: PushCategory.HUMAN,       // #10 token 要用而没有（本块新产生点）
  CARD_SUPPLY_FAULT: PushCategory.HUMAN,            // #10 卡台故障（本块新产生点）
  PROVIDER_SNAPSHOT_STALE: PushCategory.HUMAN,      // #10 卡台信息拉不动，同属卡台故障

  // —— 供给 ——
  CARD_STOCK_LOW: PushCategory.SUPPLY,              // 按台×产品水位不足（第③步起唯一产生点）
  CARD_SUPPLY_WALLET_LOW: PushCategory.SUPPLY,      // 钱包扣完低于硬底线，开不了卡
  PROVIDER_WALLET_LOW: PushCategory.SUPPLY,         // 钱包低于告警线
  CARD_SUPPLY_BLOCKED: PushCategory.SUPPLY,         // 调度器被挡住且无处转台

  // —— 资金 ——
  CARD_CHARGEBACK: PushCategory.MONEY,              // 拒付必推（D-249；本块新产生点）
  PROVIDER_BALANCE_CHANGED: PushCategory.MONEY,     // 余额每笔变化必推（D-275 ④：撤掉未实现的每日汇总开关）
  ORDER_CANCELLATION_UNCONFIRMED: PushCategory.MONEY, // 缝 g：取消续费没确认 = 下个周期还会扣
  DAILY_RECONCILIATION_SUMMARY: PushCategory.MONEY, // 每日一条对账汇总（面四③；含待销到期数，D-272）

  // —— 客户动态 ——
  BROWSER_ORDER_SUBMITTED: PushCategory.CUSTOMER    // 客户提交了充值（D-175 的「一头」）
});

/** 明确不推的类型与理由。新增类型时在这里或白名单里二选一登记，别留空白。 */
export const NON_PUSH_REASONS = Object.freeze({
  // D5：补卡还在自动重试，系统没有停手；真「开不出、要人」是 ORDER_WAITING_FOR_CARD，
  // 调度器开卡失败另有 CARD_SUPPLY_OPEN_FAILED 在推 —— 这条再推就是同一件事第三遍。
  ORDER_REPLENISH_RETRYING: '补卡仍在自动重试，未卡住客户；要人时由 ORDER_WAITING_FOR_CARD 叫',
  BROWSER_PAYMENT_UNKNOWN: '链路中间态；付款后核实通道常在一分钟内自己确认，真卡住由 BROWSER_HUMAN_REQUIRED 接手（D-176）',
  BROWSER_PAYMENT_CONFIRMED: '与 BROWSER_ORDER_COMPLETED 相隔数秒，重复（D-176）',
  BROWSER_ORDER_COMPLETED: '成功不需要人做什么；成功数进每日汇总（D-249 把 D-176 的「一尾」收进看板）',
  BROWSER_UPGRADE_HANDOFF: '两阶段 20X 方案已退休（D-245），整条线第⑦块删',
  REFUND_CANDIDATE: '疑似退款只是线索，真扣款走 CARD_CHARGEBACK；本身只进后台（D-249）',
  CARD_STOCK_EMPTY: '与按台×产品的 CARD_STOCK_LOW 重叠，且门槛写死 Plus 16（第③步发现 1）',
  BARK_TEST: '通道自检',
  BARK_DEAD_TEST: '通道自检',
  BARK_RECOVERY_TEST: '通道自检'
});

/**
 * 当前该推的类型清单——白名单四类，谁在里面谁响手机，`alert-push-policy` 一处说了算。
 *
 * D-275 ④：**撤掉 `DAILY_DIGEST` 余额汇总选项**。它当初只实现了「把余额变化从即时推送里摘掉」
 * 的前半条，却没有任何替代的「每日汇总发送者」——设了这个开关，余额变化就只是从此不再响，
 * 没有别的通知补上（F-52）。未实现的功能不给开关。余额变化恢复为每笔必推。
 */
export function phonePushTypes() {
  return Object.keys(PHONE_PUSH_TYPES);
}

export function shouldPushToPhone(alertType) {
  return phonePushTypes().includes(String(alertType));
}

export function pushCategoryOf(alertType) {
  return PHONE_PUSH_TYPES[String(alertType)] ?? null;
}
