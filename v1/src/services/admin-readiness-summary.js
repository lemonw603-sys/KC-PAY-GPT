import { snapshotIsFresh } from './card-provider-snapshot-service.js';

function check(checkId, status, message, actionId = null) {
  return { checkId, status, actionId, message };
}

/** Summarise only gates needed by the currently selected route. */
export function buildAdminReadinessSummary(overview = {}, { defaultCardTypeReady = false } = {}) {
  const health = overview.providerHealth || {};
  const stock = overview.cardStock || {};
  const runtime = overview.runtimeHealth || {};
  const method = String(health.rechargeMethod || '').toUpperCase() || null;
  const checks = [];

  if (!['API', 'BROWSER'].includes(method)) {
    checks.push(check('EXECUTION_ROUTE', 'BLOCKED', 'Plus 默认充值路线未配置或不可识别', 'OPEN_PROVIDER_ROUTES'));
  } else if (method === 'BROWSER') {
    checks.push(health.browserRechargeReady === true
      ? check('EXECUTION_ROUTE', 'READY', '默认使用 Browser，执行器已就绪')
      : check('EXECUTION_ROUTE', 'BLOCKED', '默认使用 Browser，但执行器尚未就绪', 'OPEN_BROWSER_STATUS'));
  } else {
    if (runtime.workerHealthy !== true) {
      checks.push(check('EXECUTION_ROUTE', 'BLOCKED', 'API 订单 Worker 当前不健康', 'OPEN_RECONCILIATION'));
    } else if (runtime.rechargeWritesEnabled !== true) {
      checks.push(check('EXECUTION_ROUTE', 'BLOCKED', '默认使用 API，但真实充值执行权限尚未开启，需要通过部署配置开启'));
    } else {
      checks.push(check('EXECUTION_ROUTE', 'READY', '默认使用 API，订单 Worker 和真实充值权限均已就绪'));
    }
  }

  const available = Number(stock.available || 0);
  const needsFunding = Number(stock.needsFunding || 0);
  if (available > 0) {
    checks.push(check('CARD_SUPPLY', 'READY', `可直接分配卡 ${available} 张`));
  } else if (needsFunding > 0) {
    checks.push(stock.balanceFundingEnabled === true
      ? check('CARD_SUPPLY', 'AUTO_HEAL', `有 ${needsFunding} 张卡余额不足；订单到达后会自动补足`)
      : check('CARD_SUPPLY', 'BLOCKED', `有 ${needsFunding} 张卡需要补余额后才能使用`, 'OPEN_CARD_FUNDING'));
  } else if (stock.autoReplenishmentEnabled === true) {
    const providerReady = Boolean(health.syncedAt)
      && snapshotIsFresh({ syncedAt: health.syncedAt })
      && health.purchaseEnabled === true
      && defaultCardTypeReady;
    checks.push(providerReady
      ? check('CARD_SUPPLY', 'AUTO_HEAL', '当前无卡；首个订单到达时会按已确认规则自动开卡')
      : check('CARD_SUPPLY', 'BLOCKED', '自动补卡已开启，但卡台规则或默认卡段未就绪', 'REFRESH_PROVIDER_RULES'));
  } else {
    checks.push(check('CARD_SUPPLY', 'BLOCKED', '当前无可用卡，且自动补卡未开启', 'OPEN_CARD_STOCK'));
  }

  const blocked = checks.some((item) => item.status === 'BLOCKED');
  const autoHeal = checks.some((item) => item.status === 'AUTO_HEAL');
  return { status: blocked ? 'BLOCKED' : autoHeal ? 'AUTO_HEAL' : 'READY', ready: !blocked, method, checks };
}
