import { snapshotIsFresh } from './card-provider-snapshot-service.js';

export function createAdminStartBusinessService({ adminReadService, cardStockService, adminOperationsService }) {
  return async function startBusiness() {
    const overview = await adminReadService.getOverview();
    const stock = overview.cardStock || {};
    const health = overview.providerHealth || {};
    const cardStock = await cardStockService.status();
    const defaultCardTypeId = cardStock.provider?.defaultCardTypeId;
    const defaultExists = cardStock.provider?.cardTypes?.some((item) => String(item.id) === String(defaultCardTypeId));
    if (!health.syncedAt || !snapshotIsFresh({ syncedAt: health.syncedAt }) || health.purchaseEnabled !== true) {
      throw new Error('卡台只读状态未就绪，请先刷新卡段规则');
    }
    if (!defaultExists) throw new Error('默认卡段未配置或已失效');
    if (Number(stock.available || 0) < 1) {
      throw new Error(`可用卡库存不足：可分配 ${stock.available || 0}，待补余额 ${stock.needsFunding || 0}`);
    }
    const acceptance = await adminOperationsService.setOrderAcceptance({ enabled: true, confirmation: '开始接单' });
    const dispatch = await adminOperationsService.setDispatch({ enabled: true, confirmation: '开始自动充值' });
    return { ready: true, acceptNewOrders: acceptance.acceptNewOrders, dispatchExistingOrders: dispatch.dispatchExistingOrders };
  };
}
