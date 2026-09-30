// 选卡顺序（D-414，2026-09-30 Lemon 定「像 ZOVO 一样可自定义」）：一单来了，现成有钱的卡和可补钱的旧卡都有时先用哪种。
//   balance_first 卡上有钱的先用（默认，ZOVO 默认「余额优先」）：客户不用等补钱，卡上闲着的钱先花掉；都没钱才补旧卡。
//   used_first    旧卡先用满：有可补钱的旧卡就先补它，新卡留到后面（早用满早删）。
// 两个选项都不会重复扣钱，只影响「先用哪张卡」。
export const CARD_SELECT_ORDER_SETTING = 'card_select_order';
export const CARD_SELECT_ORDERS = Object.freeze(['balance_first', 'used_first']);
export const DEFAULT_CARD_SELECT_ORDER = 'balance_first';

export function normalizeCardSelectOrder(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return CARD_SELECT_ORDERS.includes(text) ? text : DEFAULT_CARD_SELECT_ORDER;
}
