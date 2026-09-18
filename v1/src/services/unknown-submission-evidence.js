/**
 * 第④步（面三③ 表二）：API 单付款不明时的「卡台侧扣款」这一路证据的判定。
 *
 * 输入是库内 card_transactions 的行（hnskj 卡：API 路线冻结 hnskj，D-253）。真实形状
 * （2026-09-18 生产实查）：
 *   PURCHASE / SETTLED / 15.71 USD / original 982.14 PHP / merchant 'OPENAI' / trade_time_raw
 *   是卡台给的 UTC+8 本地串 "2026-09-17 09:34:34"（对应 01:34 UTC，hnskj 合同实证）、
 *   occurred_at 为 NULL；失败行是 purchase / failed / -78.24 / not_settle。
 *
 * 只认「成功状态 + OpenAI 商户 + 提交时间之后（容 15 分钟时钟差）」的行为扣款证据；
 * 判不出（没有行）不等于「没扣款」，结论由调用方按窗口是否用尽再定。
 */
const SUCCESS_STATUSES = new Set(['SUCCESS', 'SUCCEEDED', 'SETTLED', 'COMPLETED', 'COMPLETE']);
const PURCHASE_TYPES = new Set(['PURCHASE', 'PAYMENT', 'CONSUMPTION', 'DEBIT']);

/** hnskj 的 trade_time_raw 是 UTC+8 本地串；解析成 UTC 时刻。解析不了返回 null。 */
export function parseHnskjTradeTime(raw) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(raw || '').trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, sec] = match.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 8, mi, sec));
}

function transactionTime(row) {
  if (row?.occurred_at) {
    const t = new Date(row.occurred_at);
    if (Number.isFinite(t.getTime())) return t;
  }
  return parseHnskjTradeTime(row?.trade_time_raw);
}

function isOpenAiMerchant(row) {
  const merchant = String(row?.merchant_name || '').trim();
  if (merchant) return /openai|chatgpt/i.test(merchant);
  return PURCHASE_TYPES.has(String(row?.transaction_type || '').trim().toUpperCase());
}

export function assessCardSideCharge({ purchases, submittedAt, clockSkewMs = 15 * 60_000 } = {}) {
  const rows = Array.isArray(purchases) ? purchases : [];
  const submitted = submittedAt == null ? null : new Date(submittedAt);
  if (submitted && !Number.isFinite(submitted.getTime())) throw new TypeError('submittedAt is invalid');
  const candidates = [];
  for (const row of rows) {
    if (!SUCCESS_STATUSES.has(String(row?.status || '').trim().toUpperCase())) continue;
    if (!isOpenAiMerchant(row)) continue;
    const at = transactionTime(row);
    if (submitted && at && at.getTime() < submitted.getTime() - clockSkewMs) continue;
    candidates.push({
      providerTransactionId: row.provider_transaction_id == null ? null : String(row.provider_transaction_id),
      amount: row.amount == null ? null : String(row.amount),
      currency: row.currency || null,
      originalAmount: row.original_amount == null ? null : String(row.original_amount),
      originalCurrency: row.original_currency || null,
      merchantName: row.merchant_name || null,
      at: at ? at.toISOString() : null
    });
  }
  const summary = candidates.length === 0
    ? '卡台扣款：提交后卡台流水里没有 OpenAI 成功扣款'
    : `卡台扣款：提交后卡台流水里有 ${candidates.length} 笔 OpenAI 成功扣款（${candidates.map((c) => `${c.amount} ${c.currency}${c.at ? ` @ ${c.at}` : ''}`).join('；')}）`;
  return { available: true, charged: candidates.length > 0, candidates, summary };
}
