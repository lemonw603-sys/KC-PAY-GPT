// 把一次开卡的真实成本写成一条 card_transactions 行（D-249 面四② T2）。
//
// 算法在 domain/card-issue-fee.js（纯函数、可单测）；这里只负责落库与不落库的取舍。
//
// 落的是一条**独立的费用行**，不是去改卡台给的那条 card_recharge 的 fee 列：
// 那一列的 0 是卡台的真实回答（生产实证：卡台没给 fee 字段的记录落库是 NULL，
// card_recharge 落的是 0，说明卡台确实返回了 fee=0），改它等于篡改观察。
// provider_transaction_id 带 LOCAL_ 前缀，一眼能看出这行是我们自己算出来的。
import {
  computeIssueFee, CARD_ISSUE_FEE_TYPE, CARD_ISSUE_FEE_STATUS, issueFeeTransactionId,
} from '../domain/card-issue-fee.js';
import { insertCardTransactionRow } from '../db/repositories/card-transaction-repository.js';
import { sha256Payload } from './provider-balance-snapshot-service.js';

/**
 * 算得出就写一行，算不出就如实返回原因、一个字都不写。
 *
 * 调用方（card-stock-job-runner）必须把这个调用包在 try/catch 里：卡已经开出来、
 * 钱已经花了，记不了成本不该让开卡 job 变成失败。
 */
export async function recordIssueFee(pool, {
  providerAccountId, providerCardId, balanceBefore, balanceAfter, openCardAmount,
  currency = 'USD', observedAt = new Date(),
} = {}) {
  const transactionId = issueFeeTransactionId(providerCardId);
  const base = { providerCardId, balanceBefore, balanceAfter, openCardAmount };
  if (!transactionId || !providerAccountId) {
    return { ...base, recorded: false, reason: 'NO_CARD_TO_ATTACH_THE_FEE_TO' };
  }
  const computed = computeIssueFee({ balanceBefore, balanceAfter, openCardAmount });
  if (!computed.ok) return { ...base, recorded: false, reason: computed.reason, detail: computed };

  // 卡行 id 在这里自己查，不让调用方传：card-stock-service 的 register() 返回的是
  // { providerCardId, inventoryStatus, ...stock }，**没有 id**。让调用方「把 id 传进来」
  // 就会写成 registered.id —— 恒为 undefined，而单测里传的是个假 id，照样全绿。
  // （D-172 惯犯 3 的原样重演：代码和夹具一致、测试全绿、功能永不生效。）
  const [cardRows] = await pool.query(
    `SELECT id FROM cards
     WHERE provider_account_id = ? AND BINARY external_card_id = BINARY ? LIMIT 1`,
    [providerAccountId, String(providerCardId)]
  );
  const cardId = cardRows[0]?.id;
  if (!cardId) return { ...base, recorded: false, reason: 'CARD_NOT_FOUND_IN_INVENTORY' };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await insertCardTransactionRow(connection, {
      cardId,
      transaction: {
        id: transactionId,
        type: CARD_ISSUE_FEE_TYPE,
        // 不是卡台给的状态——这是我们从余额差观察到的，写成 OBSERVED 而不是 success，
        // 免得将来有人把它当成卡台流水去跟卡台对账。
        status: CARD_ISSUE_FEE_STATUS,
        amount: computed.fee,
        currency,
        // fee 列留空：这一整行就是一笔费用，amount 已经是它的金额。两列都填同一个数
        // 会让「按 fee 汇总」和「按费用行汇总」相加时重复计算。
        fee: null,
        tradeTime: observedAt.toISOString(),
        relatedTxnId: null,
        settlementStatus: null,
        originalAmount: null,
        originalCurrency: null,
        merchantName: null,
        merchantCountry: null,
        merchantMcc: null,
        rawHash: sha256Payload({ providerCardId, balanceBefore, balanceAfter, openCardAmount, fee: computed.fee }),
      },
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { ...base, recorded: true, fee: computed.fee, spent: computed.spent, transactionId };
}
