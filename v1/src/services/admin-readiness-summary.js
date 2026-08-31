import { snapshotIsFresh } from './card-provider-snapshot-service.js';

/**
 * Convert the existing overview fields into a small, stable control-plane
 * summary. This is presentation-only: it performs no writes and does not
 * relax any execution gate.
 */
export function buildAdminReadinessSummary(overview = {}) {
  const health = overview.providerHealth || {};
  const stock = overview.cardStock || {};
  const checks = [];
  const providerReady = Boolean(health.syncedAt)
    && snapshotIsFresh({ syncedAt: health.syncedAt })
    && health.purchaseEnabled === true;
  checks.push({
    checkId: 'PROVIDER_READINESS',
    status: providerReady ? 'READY' : 'ACTION_REQUIRED',
    actionId: providerReady ? null : 'REFRESH_PROVIDER_RULES',
    message: providerReady ? '卡台规则和开卡权限已就绪' : '请刷新卡台规则并确认开卡权限'
  });

  const stockReady = Number(stock.available || 0) > 0;
  checks.push({
    checkId: 'CARD_STOCK',
    status: stockReady ? 'READY' : 'BLOCKED',
    actionId: stockReady ? null : 'OPEN_CARD_STOCK',
    message: stockReady ? `可分配卡 ${Number(stock.available || 0)} 张` : '当前没有可直接分配的卡'
  });

  const browserReady = health.browserRechargeReady === true;
  checks.push({
    checkId: 'BROWSER_EXECUTOR',
    status: browserReady ? 'READY' : 'ACTION_REQUIRED',
    actionId: browserReady ? null : 'OPEN_BROWSER_STATUS',
    message: browserReady ? 'Browser 执行器已就绪' : 'Browser 执行器当前未就绪（不影响 API 充值）'
  });

  const blocked = checks.some((item) => item.status === 'BLOCKED');
  const actionRequired = checks.some((item) => item.status === 'ACTION_REQUIRED');
  return {
    status: blocked ? 'BLOCKED' : actionRequired ? 'ACTION_REQUIRED' : 'READY',
    checks
  };
}
