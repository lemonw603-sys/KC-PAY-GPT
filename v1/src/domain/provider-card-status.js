/**
 * 卡台说「这张卡已失效」的状态值（原样小写比较）。卡片同步据此把卡标 FAILED（card-stock-service），
 * 待销清单据此判断「卡台已作废、不用再去删」（card-retirement-service）。一份，两处引用。
 */
export const PROVIDER_FAILED_CARD_STATUSES = Object.freeze(new Set(['failed', 'failure', 'invalid', 'inactive', 'closed', 'cancelled', 'canceled']));
