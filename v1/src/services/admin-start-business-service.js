import { buildAdminReadinessSummary } from './admin-readiness-summary.js';

export function createAdminStartBusinessService({ adminReadService, cardStockService, adminOperationsService }) {
  return async function startBusiness() {
    const overview = await adminReadService.getOverview();
    const cardStock = await cardStockService.status();
    const defaultCardTypeId = cardStock.provider?.defaultCardTypeId;
    const defaultExists = cardStock.provider?.cardTypes?.some((item) => String(item.id) === String(defaultCardTypeId));
    const readiness = buildAdminReadinessSummary(overview, { defaultCardTypeReady: defaultExists });
    if (!readiness.ready) return { ready: false, readiness };
    const acceptance = await adminOperationsService.setOrderAcceptance({ enabled: true, confirmation: '开始接单' });
    let dispatch;
    try {
      dispatch = await adminOperationsService.setDispatch({ enabled: true, confirmation: '开始自动充值' });
    } catch (error) {
      // Compensation keeps the two public switches from ending in a partial-open state.
      await adminOperationsService.setOrderAcceptance({ enabled: false, confirmation: '停止接单' }).catch(() => {});
      throw error;
    }
    return { ready: true, readiness, acceptNewOrders: acceptance.acceptNewOrders, dispatchExistingOrders: dispatch.dispatchExistingOrders };
  };
}
