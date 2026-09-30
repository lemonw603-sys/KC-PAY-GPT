// D-411 按单补钱：TOP_UP_CARD（发一次补钱请求）与 CHECK_TOP_UP（查到账）两个任务的执行逻辑。
//
// 为什么拆成两个任务、而不是在一个任务里原地等到账：服务器 worker 串行（并发 1）、租约 60 秒。
// 原地等 10～17 秒会堵住后面的客户；超过 60 秒租约任务会被重领再跑——那就可能补两次钱（D-411 v2 影响地图）。
//
// 只发一次：发请求前先把登记改成 SENDING（card-top-up-repository.markSending，带 WHERE status='PREPARED'）。
// 进程在「已发、未记」之间死掉 → 重跑看到 SENDING → 按结果不明处理，绝不再发（CLAUDE.md：没有幂等键的
// highvcc 写请求一律不自动重发，超时或结果不明先读余额和流水判断，判不清转人工）。
//
// 客户不因补钱失败而失败：被拒 / 钱包不够 / token 失效 → 放卡、订单换卡（新卡或等卡）；
// 结果不明 → 卡锁住（资格规则 TOP_UP_PENDING），订单同样换卡走，这张卡由 CHECK_TOP_UP 继续核对。

import { toCents, fromCents } from '../domain/card-issue-fee.js';
import { findTopUpForOrder, markSending, markSubmitted, bumpCheckCount, pendingTopUpAmountCents, inflightCardOpenCents,
  enqueueTopUpCheck } from '../db/repositories/card-top-up-repository.js';
import { markProviderTokenExpired } from './card-supply-scheduler-service.js';
import { recordProviderBalanceSnapshot } from './provider-balance-snapshot-service.js';

// 请求根本没被卡台受理（登录失效 / 没 token / 金额不合法没发）——钱没动，可以放心换卡。
// 卡台回了业务错误码（HIGHVCC_API_ERROR）不算在内：我们没见过补钱的失败响应长什么样（惯犯规则 3），
// 「系统繁忙」之类可能已经扣了钱包。它按结果不明处理：订单当场换卡，3 分钟后翻账户流水再定（对抗审查 2026-09-30）。
const DEFINITE_NO = new Set(['HIGHVCC_TOKEN_EXPIRED', 'HIGHVCC_TOKEN_MISSING', 'HIGHVCC_INVALID_AMOUNT']);

export const TOP_UP_POLL_MS = 3_000;
export const TOP_UP_ARRIVAL_WINDOW_MS = 180_000;      // 与客户页「3 分钟没动就说已通知运营」对齐（D-352）
export const TOP_UP_SLOW_POLL_MS = 60_000;
export const TOP_UP_GIVE_UP_MS = 24 * 3_600_000;       // 24 小时后停止自动核对，留给人

function cardBalanceCents(detail) {
  const raw = detail?.card?.balance;
  const cents = Number(raw);
  return Number.isInteger(cents) ? cents : null;        // highvcc 卡详情 balance 是整数分（2026-09-29 实测 1600）
}

/** 卡台账户流水里「这张卡、这个时间之后、补钱」的记录。initiated 是 UTC+8 的「YYYY-MM-DD HH:mm:ss」。 */
export function topUpFlowRows(rows, { cardId, sinceMs }) {
  return (rows || []).filter((row) => {
    if (String(row?.cardSeqNo || '') !== String(cardId)) return false;
    if (!/Add Balance To Card/i.test(String(row?.tradeDesc || ''))) return false;
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(row?.initiated || ''));
    if (!m) return true;                                 // 时间读不出来就当「可能是」，宁可叫人
    const utcMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +m[6]);
    return utcMs >= sinceMs - 60_000;
  });
}

export class TopUpRetry extends Error {
  constructor(delayMs, code = 'TOP_UP_PENDING') {
    super('Top-up is still in progress');
    this.name = 'TopUpRetry';
    this.delayMs = delayMs;
    this.code = code;
  }
}

export function createCardTopUpService({ pool, workflow, provider,
  enqueueCheck = (orderId, topUpId, delayMs) => enqueueTopUpCheck(pool, { orderId, topUpId, delayMs }),
  now = () => Date.now() }) {
  if (!pool?.query) throw new TypeError('pool is required');
  if (!workflow?.confirmTopUp) throw new TypeError('workflow repository with top-up methods is required');

  async function walletFloorCents(providerAccountId) {
    const [[row]] = await pool.query('SELECT wallet_floor FROM provider_accounts WHERE id = ? LIMIT 1', [providerAccountId]);
    const cents = toCents(String(row?.wallet_floor ?? ''));
    return Number.isInteger(cents) ? cents : null;
  }

  // 补钱前实时读到的钱包顺手记一条快照（与每小时同步同一个写入口），让调度器 / 卡数口径看到的钱包更新鲜。
  async function recordWalletSnapshot(providerAccountId, wallet) {
    const cents = Number(wallet?.usdBalanceCents);
    if (!Number.isInteger(cents)) return;
    await recordProviderBalanceSnapshot(pool, {
      providerAccountId, currency: 'USD', availableBalance: fromCents(cents), pendingBalance: null,
      observedAt: new Date(now()), rawPayload: wallet
    }).catch(() => {});   // 快照只是参考；写不进去不影响这次补钱的判断（判断用的是刚读到的实时值）
  }

  async function topUpAlertRaised(topUpId) {
    const [[row]] = await pool.query('SELECT 1 AS raised FROM operator_alerts WHERE dedupe_key = ? LIMIT 1', [`card-top-up:${topUpId}`]);
    return Boolean(row);
  }

  /** TOP_UP_CARD：对这一单的补钱只发一次请求。 */
  async function send(orderId) {
    const topUp = await findTopUpForOrder(pool, orderId, ['PREPARED', 'SENDING', 'SUBMITTED']);
    if (!topUp) return { action: 'NONE' };
    if (topUp.status === 'SUBMITTED') {
      // 上一次记完「已受理」、还没排上查到账就断了：补排一次（同一个去重键，排多少次都只有一个）。
      await enqueueCheck(orderId, topUp.id, TOP_UP_POLL_MS);
      return { action: 'NONE' };
    }
    if (topUp.status === 'SENDING') {
      // 上一次发送中途断了：不知道卡台收没收到，绝不再发。
      await workflow.markTopUpUnknownAndDetach(topUp.id, { code: 'SEND_INTERRUPTED', message: 'worker stopped while sending' });
      await enqueueCheck(orderId, topUp.id, TOP_UP_POLL_MS);
      return { action: 'UNKNOWN', code: 'SEND_INTERRUPTED' };
    }
    if (!provider) {
      await workflow.rejectTopUp(topUp.id, { code: 'TOP_UP_PROVIDER_MISSING', message: 'no top-up client in this worker', allowedFrom: ['PREPARED'] });
      return { action: 'REJECTED', code: 'TOP_UP_PROVIDER_MISSING' };
    }
    // 「自动开卡」总闸在分卡之后被关了：不再发（钱没动），订单换卡 / 等卡。总闸是人收手的唯一把手（D-412 补记三）。
    const [[autoSupply]] = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'card_auto_replenishment_enabled' LIMIT 1`);
    if (autoSupply?.setting_value !== 'true') {
      await workflow.rejectTopUp(topUp.id, { code: 'AUTO_SUPPLY_OFF', allowedFrom: ['PREPARED'],
        message: 'card_auto_replenishment_enabled is off; top-up not sent' });
      return { action: 'REJECTED', code: 'AUTO_SUPPLY_OFF' };
    }
    const amountCents = toCents(String(topUp.amount));
    const cardId = String(topUp.provider_card_id || topUp.external_card_id || '');
    let balanceBeforeCents;
    try {
      // 发之前：实时钱包（补后不低于押金底线，D-273）+ 卡详情（记下补前余额、核对尾号）。
      const wallet = await provider.wallet();
      const walletCents = Number(wallet?.usdBalanceCents);
      await recordWalletSnapshot(topUp.provider_account_id, wallet);
      const floorCents = await walletFloorCents(topUp.provider_account_id);
      // 还没从钱包扣走的：别的待发补钱 + 已排队没开出来的卡（开卡调度器那一侧同样扣掉待发补钱，两边互相看得见）。
      const pendingCents = await pendingTopUpAmountCents(pool, { providerAccountId: topUp.provider_account_id, excludeTopUpId: topUp.id })
        + await inflightCardOpenCents(pool, { providerAccountId: topUp.provider_account_id });
      if (!Number.isInteger(walletCents) || floorCents == null || walletCents - pendingCents - amountCents < floorCents) {
        await workflow.rejectTopUp(topUp.id, { code: 'WALLET_LOW', allowedFrom: ['PREPARED'],
          message: `wallet ${fromCents(walletCents)} - pending ${fromCents(pendingCents)} - ${fromCents(amountCents)} < floor ${fromCents(floorCents)}` });
        return { action: 'REJECTED', code: 'WALLET_LOW' };
      }
      const detail = await provider.detail(cardId);
      balanceBeforeCents = cardBalanceCents(detail);
      const last4 = String(detail?.card?.lastFour || '');
      if (balanceBeforeCents == null || (topUp.last4 && last4 && last4 !== String(topUp.last4))) {
        await workflow.rejectTopUp(topUp.id, { code: 'CARD_MISMATCH', allowedFrom: ['PREPARED'],
          message: `card detail unusable (last4 ${last4 || '?'} vs ${topUp.last4 || '?'})` });
        return { action: 'REJECTED', code: 'CARD_MISMATCH' };
      }
    } catch (error) {
      if (error?.code === 'HIGHVCC_TOKEN_EXPIRED') await markProviderTokenExpired(pool, { providerAccountId: topUp.provider_account_id });
      await workflow.rejectTopUp(topUp.id, { code: error?.code || 'PRECHECK_FAILED', allowedFrom: ['PREPARED'],
        message: String(error?.message || '').slice(0, 250) });
      return { action: 'REJECTED', code: error?.code || 'PRECHECK_FAILED' };
    }
    const mine = await markSending(pool, topUp.id, { balanceBefore: fromCents(balanceBeforeCents) });
    if (!mine) return { action: 'NONE' };
    let response;
    try {
      response = await provider.recharge({ cardId, amountCents });
    } catch (error) {
      if (DEFINITE_NO.has(error?.code)) {
        if (error.code === 'HIGHVCC_TOKEN_EXPIRED') await markProviderTokenExpired(pool, { providerAccountId: topUp.provider_account_id });
        await workflow.rejectTopUp(topUp.id, { code: error.code, allowedFrom: ['SENDING'],
          message: String(error.providerMessage || error.message || '').slice(0, 250) });
        return { action: 'REJECTED', code: error.code };
      }
      await workflow.markTopUpUnknownAndDetach(topUp.id, { code: error?.code || 'TOP_UP_UNKNOWN',
        message: String(error?.providerMessage || error?.message || '').slice(0, 250) });
      await enqueueCheck(orderId, topUp.id, TOP_UP_POLL_MS);
      return { action: 'UNKNOWN', code: error?.code || 'TOP_UP_UNKNOWN' };
    }
    await markSubmitted(pool, topUp.id, response);
    await enqueueCheck(orderId, topUp.id, TOP_UP_POLL_MS);
    return { action: 'SUBMITTED' };
  }

  /** CHECK_TOP_UP：卡详情到账 → 了结为 CONFIRMED；否则按时限换卡 / 查流水 / 叫人。返回或抛 TopUpRetry。 */
  async function check(orderId) {
    const topUp = await findTopUpForOrder(pool, orderId, ['SUBMITTED', 'UNKNOWN']);
    if (!topUp) return { action: 'NONE' };
    await bumpCheckCount(pool, topUp.id);
    const cardId = String(topUp.provider_card_id || topUp.external_card_id || '');
    const amountCents = toCents(String(topUp.amount));
    const beforeCents = topUp.balance_before == null ? null : toCents(String(topUp.balance_before));
    const startedMs = Date.parse(String(topUp.submitted_at || topUp.sending_at || topUp.created_at)) || now();
    const elapsed = now() - startedMs;
    let balance = null;
    try { balance = cardBalanceCents(await provider.detail(cardId)); } catch { balance = null; }
    // 到账 = 余额 ≥ 补前 + 补钱额（卡台余额是整数分、补钱 0 手续费，不留误差）；补前没读到时退一步：余额 ≥ 补钱额。
    const target = beforeCents == null ? amountCents : beforeCents + amountCents;
    if (balance != null && balance >= target) {
      const result = await workflow.confirmTopUp(topUp.id, { observedBalance: fromCents(balance) });
      return { action: 'CONFIRMED', ...result };
    }
    if (elapsed < TOP_UP_ARRIVAL_WINDOW_MS) throw new TopUpRetry(TOP_UP_POLL_MS);
    if (topUp.status === 'SUBMITTED') {
      // 卡台受理了（钱包当场扣）、3 分钟卡上还没到：不正常。订单换卡走，叫人；卡锁住，继续慢慢核对。
      await workflow.markTopUpUnknownAndDetach(topUp.id, { code: 'NOT_ARRIVED', alert: true,
        alertDetail: `卡台已受理，3 分钟卡上仍没到账（最近读到 ${balance == null ? '读不到' : `$${fromCents(balance)}`}）` });
      throw new TopUpRetry(TOP_UP_SLOW_POLL_MS, 'TOP_UP_NOT_ARRIVED');
    }
    // 24 小时停止自动核对（放在「受理后没到账就换卡叫人」之后：worker 停了一天回来，先把订单放走）。
    // 没叫过人的由每分钟巡检兜底叫（operator-watch：补钱 15 分钟没了结又没告警）。
    if (elapsed >= TOP_UP_GIVE_UP_MS) return { action: 'GAVE_UP' };
    // 已经叫过人的，之后只慢慢看余额（上面到账就自动了结并关告警），不再重开告警——同一件事只推一条（D-407）。
    if (await topUpAlertRaised(topUp.id)) throw new TopUpRetry(TOP_UP_SLOW_POLL_MS, 'TOP_UP_UNRESOLVED');
    // UNKNOWN（没拿到明确回应）：3 分钟没到账，翻账户流水看钱到底出去没有。
    let rows = null;
    try {
      rows = topUpFlowRows(await provider.accountFlow({ createStartMs: startedMs - 120_000, createEndMs: now() + 60_000 }),
        { cardId, sinceMs: startedMs });
    } catch { rows = null; }
    if (rows && rows.length === 0 && balance != null) {
      // 卡台回过业务错误码、流水也证实钱没出去＝卡台拒了这张卡补钱，这张卡 24 小时不再补；其余只是没发出去。
      const code = topUp.error_code === 'HIGHVCC_API_ERROR' ? 'PLATFORM_REFUSED' : 'NOT_SENT_PER_FLOW';
      await workflow.rejectTopUp(topUp.id, { code, allowedFrom: ['UNKNOWN'],
        message: 'account flow shows no top-up for this card; card balance unchanged' });
      return { action: 'REJECTED', code };
    }
    await workflow.markTopUpUnknownAndDetach(topUp.id, { code: topUp.error_code || 'TOP_UP_UNKNOWN', alert: true,
      alertDetail: rows == null ? '结果不明，账户流水也查不到' : '账户流水里有这笔补钱，卡上却没到账' });
    throw new TopUpRetry(TOP_UP_SLOW_POLL_MS, 'TOP_UP_UNRESOLVED');
  }

  return { send, check };
}
