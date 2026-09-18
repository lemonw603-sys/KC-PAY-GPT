import { HnskjCardProvider } from '../providers/index.js';
import { createHighvccCardService } from './highvcc-card-service.js';
import { createCardStockService } from './card-stock-service.js';
import { createProviderBalanceSnapshotService, recordProviderBalanceSnapshot } from './provider-balance-snapshot-service.js';
import { evaluateCardStockRequest, refreshProviderSnapshot } from './card-provider-snapshot-service.js';
import { openStockCards, syncProvisioningStock } from '../../scripts/card-stock.js';
import { CARD_ADAPTER_HIGHVCC, CARD_ADAPTER_HNSKJ } from './provider-route-service.js';

/**
 * 开卡适配器注册表（D-246 面一 C1 ②「新卡台 = 一行账户 + 一个适配器」）。
 *
 * 调度器与 runner 只认这个接口，按 provider_accounts.open_adapter 取实现，不看 provider_code：
 *   canOpen(account)                → { ok, reason }   此刻这台能不能开（token/快照/维护）
 *   readWallet(account)             → { availableBalance:'89.48', currency, purchaseEnabled?, snapshot? }
 *                                     （顺手把余额观察写进 provider_balance_snapshots，T2 要它）
 *   openOne(account, { segment, amount, jobId, wallet, onRegistered }) → { providerCardId }
 *   idle(account)                   可选：没 job 时的整理动作（hnskj 的 PROVISIONING 卡补同步）
 *
 * 每个适配器只处理自家卡台的错误语义；跨台的判断（水位/日限/底线/转台）都在调度器。
 */

export function createHnskjOpenAdapter({ pool, config, env = process.env }) {
  const provider = new HnskjCardProvider({
    baseUrl: env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
    apiKey: String(env.HNSKJ_API_KEY || '')
  });
  const balanceSnapshots = createProviderBalanceSnapshotService({ pool });
  const stocks = new Map();
  const stockFor = (account) => {
    if (!stocks.has(account.id)) {
      stocks.set(account.id, createCardStockService({ pool, sessionEncryptionKey: config.sessionEncryptionKey,
        panHmacKey: config.cardIntakePanHmacKey, providerAccountId: account.id }));
    }
    return stocks.get(account.id);
  };
  const refresh = (account) => refreshProviderSnapshot(pool, provider, {
    balanceSnapshotService: balanceSnapshots, providerAccountId: account.id
  });

  return Object.freeze({
    code: CARD_ADAPTER_HNSKJ,
    provider,
    async canOpen() {
      return { ok: true };
    },
    async readWallet(account) {
      const snapshot = await refresh(account);
      return {
        availableBalance: String(snapshot.accountBalance), currency: snapshot.currency || 'USD',
        purchaseEnabled: Boolean(snapshot.purchaseEnabled), snapshot
      };
    },
    /** 用刚读到的快照做 hnskj 自己的规则预检（卡段在不在、金额范围、卡台余额、在线卡上限）。 */
    preflight(account, { segment, amount, wallet }) {
      const snapshot = wallet?.snapshot;
      if (!snapshot) throw Object.assign(new Error('hnskj snapshot is required for preflight'), { code: 'CARD_STOCK_RULES_STALE' });
      return evaluateCardStockRequest(snapshot, { cardTypeId: segment, amount: Number(amount), count: 1 });
    },
    async openOne(account, { segment, amount, onRegistered = async () => {} }) {
      const result = await openStockCards({
        provider, stock: stockFor(account), count: 1, amount: Number(amount), cardTypeId: String(segment),
        onCardOpened: async ({ providerCardId, registered }) => onRegistered({ providerCardId, registered })
      });
      const providerCardId = result.cards[0]?.providerCardId;
      if (!providerCardId) throw Object.assign(new Error('hnskj opened a card but returned no card id'), { code: 'CARD_STOCK_OPEN_FAILED' });
      return { providerCardId };
    },
    async idle(account) {
      return syncProvisioningStock({ pool, provider, stock: stockFor(account) });
    }
  });
}

export function createHighvccOpenAdapter({ pool, config, service = null }) {
  const highvcc = service || createHighvccCardService({
    pool, encryptionKey: config.sessionEncryptionKey, panHmacKey: config.cardIntakePanHmacKey
  });
  return Object.freeze({
    code: CARD_ADAPTER_HIGHVCC,
    async canOpen() {
      // token 只能人贴、约 2 小时失效（D-249/D-251）：没有 token 就是「此刻不能开」，
      // 让调度器转另一台，不叫人。
      const status = await highvcc.tokenStatus();
      return status.configured ? { ok: true } : { ok: false, reason: 'HIGHVCC_TOKEN_MISSING' };
    },
    async readWallet(account, { observedAt = new Date() } = {}) {
      const wallet = await highvcc.walletBalance();
      await recordProviderBalanceSnapshot(pool, {
        providerAccountId: account.id, currency: wallet.currency, availableBalance: wallet.availableBalance,
        pendingBalance: null, observedAt, rawPayload: wallet.raw
      });
      return { availableBalance: wallet.availableBalance, currency: wallet.currency, purchaseEnabled: true };
    },
    preflight() {
      return null;
    },
    async openOne(account, { segment, amount, jobId }) {
      const opened = await highvcc.openCardForSupply({
        vid: String(segment), amount: Number(amount), requestedBy: `card-supply:${jobId || 'manual'}`
      });
      return { providerCardId: String(opened.cardId), last4: opened.last4 };
    }
  });
}

export function createCardOpenAdapters({ pool, config, env = process.env, highvccService = null }) {
  const registry = new Map([
    [CARD_ADAPTER_HNSKJ, () => createHnskjOpenAdapter({ pool, config, env })],
    [CARD_ADAPTER_HIGHVCC, () => createHighvccOpenAdapter({ pool, config, service: highvccService })]
  ]);
  const built = new Map();
  return Object.freeze({
    codes: [...registry.keys()],
    has(code) { return registry.has(String(code || '')); },
    for(code) {
      const key = String(code || '');
      if (!registry.has(key)) return null;
      if (!built.has(key)) built.set(key, registry.get(key)());
      return built.get(key);
    }
  });
}
