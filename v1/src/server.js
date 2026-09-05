import { createApp } from './app/create-app.js';
import { loadConfig } from './config.js';
import { checkDatabaseReady, createDatabasePool } from './db/pool.js';
import { createOrderIntakeService } from './services/order-intake-service.js';
import { createOrderStatusService } from './services/order-status-service.js';
import { createAdminReadService } from './services/admin-read-service.js';
import {
  createAdminCdkService,
  downloadCdkBatch,
  inspectCdkBatch,
  listCdkBatches,
  revokeCdkBatch
} from './services/cdk-service.js';
import { createAdminSessionAuth } from './security/admin-session.js';
import { createCardStockService } from './services/card-stock-service.js';
import { createCardStockJobService } from './services/card-stock-job-service.js';
import { createCardReplenishmentSettingsService } from './services/card-replenishment-settings-service.js';
import { createCardFundingAdminService } from './services/card-funding-admin-service.js';
import { createProviderRouteAdminService } from './services/provider-route-admin-service.js';
import { createCardSyncJobService } from './services/card-sync-job-service.js';
import { createAdminOperationsService } from './services/admin-operations-service.js';
import {
  RechargePermitError,
  revokeRechargePermit
} from './services/recharge-permit-service.js';
import {
  createRechargeAuthorization,
  getRechargeAuthorizationStatus,
  revokeRechargeAuthorization
} from './services/recharge-authorization-v2-service.js';
import { createOrderCompensationService } from './services/order-compensation-service.js';
import { createOrderCancellationService } from './services/order-cancellation-service.js';
import { HnskjCardProvider } from './providers/index.js';
import { createCardIntakeService } from './services/card-intake-service.js';
import { createCardIntakeRepository } from './db/repositories/card-intake-repository.js';
import { createCdkDeliveryService } from './services/cdk-delivery-service.js';
import { createReconciliationCaseService } from './services/reconciliation-case-service.js';
import { createOperationsCsvExportService } from './services/operations-csv-export-service.js';
import { createTraceabilityOperationsService } from './services/traceability-operations-service.js';
import { createSessionReplacementService } from './services/session-replacement-service.js';
import { createBrowserAdminService } from './services/browser-admin-service.js';
import { createBrowserBillingAddressAdminService } from './services/browser-billing-address-admin-service.js';
import { resolveCurrentCardProviderAccountId } from './services/provider-route-service.js';
import {
  providerSupportedCardTypeIds,
  readProviderSnapshot,
  refreshProviderSnapshot
} from './services/card-provider-snapshot-service.js';
import { createCardOperationalOverrideService } from './services/card-operational-override-service.js';
import { createAdminStartBusinessService } from './services/admin-start-business-service.js';
import { buildAdminReadinessSummary } from './services/admin-readiness-summary.js';
import { createManualCardImportService } from './services/manual-card-import-service.js';
import { createCardSourceAdminService } from './services/card-source-admin-service.js';

const config = loadConfig();
const pool = createDatabasePool(config.database);
const currentCardProviderAccountId = await resolveCurrentCardProviderAccountId(pool);
if (!currentCardProviderAccountId) throw new Error('No active production card provider route');
const createCustomerOrder = createOrderIntakeService({
  pool,
  sessionEncryptionKey: config.sessionEncryptionKey,
  cdkHashKey: config.cdkHashKey
});
const getCustomerOrderStatus = createOrderStatusService({ pool, cdkHashKey: config.cdkHashKey });
const replaceCustomerSession = createSessionReplacementService({
  pool,
  sessionEncryptionKey: config.sessionEncryptionKey,
  cdkHashKey: config.cdkHashKey
});
const adminReadService = createAdminReadService({
  pool,
  sessionEncryptionKey: config.sessionEncryptionKey,
  cdkHashKey: config.cdkHashKey,
  panHmacKey: config.cardIntakePanHmacKey,
  deliveryTrackingEnabled: Boolean(config.cdkDeliveryHmacKey)
});
const cardStockService = createCardStockService({
  pool,
  sessionEncryptionKey: config.sessionEncryptionKey,
  panHmacKey: config.cardIntakePanHmacKey,
  providerAccountId: currentCardProviderAccountId
});
const cardStockJobService = createCardStockJobService({ pool });
const replenishmentSettingsService = createCardReplenishmentSettingsService({ pool });
const cardFundingAdminService = createCardFundingAdminService({ pool });
const providerRouteAdminService = createProviderRouteAdminService({ pool });
const cardSourceAdminService = createCardSourceAdminService({ pool });
const cardOperationalOverrideService = createCardOperationalOverrideService({ pool });
const cardSyncJobService = createCardSyncJobService({ pool });
const cardIntakeRepository = createCardIntakeRepository({ pool });
const cardIntakeProvider = config.hnskjApiKey
  ? new HnskjCardProvider({ baseUrl: config.hnskjApiBaseUrl, apiKey: config.hnskjApiKey })
  : null;
async function configuredCardIntake() {
  if (!cardIntakeProvider) return null;
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value FROM app_settings
     WHERE setting_key IN ('default_card_type_id','default_minimum_required_card_balance')`
  );
  const settings = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
  const providerSnapshot = await readProviderSnapshot(pool);
  return createCardIntakeService({
    provider: cardIntakeProvider,
    repository: cardIntakeRepository,
    providerAccountId: currentCardProviderAccountId,
    sessionEncryptionKey: config.sessionEncryptionKey,
    panHmacKey: config.cardIntakePanHmacKey,
    assumeDedicatedAccount: true,
    getOperationalOverride: async ({ providerAccountId, externalCardId }) => {
      const [rows] = await pool.query(
        `SELECT allocation_policy AS allocationPolicy, product_code AS productCode
           FROM card_operational_overrides
          WHERE provider_account_id = ? AND BINARY external_card_id = BINARY ? LIMIT 1`,
        [providerAccountId, externalCardId]
      );
      return rows[0] || null;
    },
    validationRules: {
      // The default card type controls which segment new opening jobs use. It
      // must not make an otherwise supported existing card invalid.
      allowedCardTypeIds: providerSupportedCardTypeIds(
        providerSnapshot, settings.get('default_card_type_id')
      ),
      allowedCardTypes: providerSnapshot?.cardTypes || [],
      minimumBalance: String(settings.get('default_minimum_required_card_balance') || '')
    }
  });
}
const createAdminCdkBatch = createAdminCdkService({
  pool,
  cdkHashKey: config.cdkHashKey,
  cdkRecoveryKey: config.cdkRecoveryKey
});
const adminOperationsService = createAdminOperationsService({ pool });
const startBusiness = createAdminStartBusinessService({ adminReadService, cardStockService, adminOperationsService });
const compensateAdminOrder = createOrderCompensationService({
  pool,
  cdkHashKey: config.cdkHashKey,
  cdkRecoveryKey: config.cdkRecoveryKey
});
const cancelAdminOrder = createOrderCancellationService({ pool });
const reconciliationCases = createReconciliationCaseService({ pool });
const browserAdmin = createBrowserAdminService({ pool });
const browserBillingAddressAdmin = createBrowserBillingAddressAdminService({ pool });
const manualCardImport = createManualCardImportService({
  pool, encryptionKey: config.sessionEncryptionKey, panHmacKey: config.cardIntakePanHmacKey
});
const operationsCsv = createOperationsCsvExportService({ pool });
const traceabilityOperations = createTraceabilityOperationsService({
  pool,
  paymentReferenceHmacKey: config.paymentReferenceHmacKey
});
const cdkDelivery = config.cdkDeliveryHmacKey
  ? createCdkDeliveryService({
    pool,
    recipientReferenceHmacKey: config.cdkDeliveryHmacKey
  })
  : null;
const adminAuth = config.adminPasswordHash
  ? createAdminSessionAuth({
    passwordHash: config.adminPasswordHash,
    sessionSecret: config.adminSessionSecret,
    secureCookies: config.nodeEnv === 'production',
    pool
  })
  : null;
async function getAdminOverviewWithReadiness() {
  const [overview, stockStatus] = await Promise.all([adminReadService.getOverview(), cardStockService.status()]);
  const defaultId = stockStatus.provider?.defaultCardTypeId;
  const defaultCardTypeReady = stockStatus.provider?.cardTypes?.some((item) => String(item.id) === String(defaultId)) === true;
  return { ...overview, readiness: buildAdminReadinessSummary(overview, { defaultCardTypeReady }) };
}

const app = createApp({
  readiness: () => checkDatabaseReady(pool),
  createCustomerOrder,
  getCustomerOrderStatus,
  replaceCustomerSession,
  adminAuth,
  adminHost: config.adminHost,
  getAdminOverview: getAdminOverviewWithReadiness,
  getAdminReadinessSummary: async () => (await getAdminOverviewWithReadiness()).readiness,
  listAdminOrders: adminReadService.listOrders,
  getAdminOrder: adminReadService.getOrder,
  addAdminOrderNote: traceabilityOperations.addOrderNote,
  addAdminOrderTag: traceabilityOperations.addOrderTag,
  completeAdminCustomerPayment: traceabilityOperations.completeCustomerPayment,
  listAdminAlerts: adminReadService.listAlerts,
  requestCardTransactionSync: adminReadService.requestCardTransactionSync
  ,getAdminCard: adminReadService.getCard
  ,getAdminCardConsumption: adminReadService.getCardConsumption
  ,requestAdminCardSync: cardSyncJobService.createJobs
  ,discoverAdminCards: cardIntakeProvider ? async () => {
    const service = await configuredCardIntake();
    const discovery = await service.discover();
    const firstPass = await service.validateBatch(discovery.batch.id);
    const secondPass = await service.validateBatch(discovery.batch.id);
    return { discovery, firstPass, secondPass };
  } : null
  ,validateAdminCardIntake: cardIntakeProvider
    ? async (batchId) => (await configuredCardIntake()).validateBatch(batchId) : null
  ,acceptAdminCardIntake: cardIntakeProvider
    ? async (input) => (await configuredCardIntake()).acceptDiscoveries(input) : null
  ,listAdminCardIntake: async (input = {}) => {
    const batches = await cardIntakeRepository.listBatches({ limit: input.limit });
    const batchId = String(input.batchId || batches[0]?.id || '').trim();
    const discoveries = batchId
      ? await cardIntakeRepository.listDiscoveries(batchId, {
        statuses: ['QUARANTINED','VALIDATED','REVIEW_REQUIRED','ACCEPTED','EXISTING','FAILED'],
        limit: input.limit || 100
      })
      : [];
    return { configured: Boolean(cardIntakeProvider), batches, batchId: batchId || null, discoveries };
  }
  ,getAdminCardStock: async () => ({
    ...await cardStockService.status(),
    ...await cardStockJobService.listJobs({ limit: 20 })
  })
  ,refreshAdminCardStockProvider: cardIntakeProvider
    ? async () => {
      const snapshot = await refreshProviderSnapshot(pool, cardIntakeProvider, {
        providerAccountId: currentCardProviderAccountId
      });
      return {
        syncedAt: snapshot.syncedAt,
        cardTypes: snapshot.cardTypes,
        accountBalance: snapshot.accountBalance,
        currency: snapshot.currency,
        cardLimit: snapshot.cardLimit,
        purchaseEnabled: snapshot.purchaseEnabled
      };
    } : null
  ,setAdminCardStockDefaultCardType: cardStockService.setDefaultCardType
  ,setAdminCardStockThreshold: (value) => cardStockService.setThreshold(value)
  ,setAdminCardMaxSuccessfulPayments: (value) => cardStockService.setMaxSuccessfulPayments(value)
  ,createAdminCardStockJob: cardStockJobService.createJob
  ,getAdminReplenishmentSettings: replenishmentSettingsService.get
  ,setAdminReplenishmentDailyLimit: replenishmentSettingsService.setDailyLimit
  ,listAdminCardFundingAttempts: cardFundingAdminService.list
  ,resolveAdminCardFundingUnknown: cardFundingAdminService.resolveUnknown
  ,listAdminProviderRoutes: providerRouteAdminService.list
  ,setAdminDefaultRechargeMethod: providerRouteAdminService.setDefaultRechargeMethod
  ,listAdminCardSources: cardSourceAdminService.list
  ,createAdminManualCardSource: cardSourceAdminService.createManualSource
  ,estimateAdminBrowserCardSourceTakeover: cardSourceAdminService.estimateWaitingTakeover
  ,switchAdminBrowserCardSource: cardSourceAdminService.switchBrowserSource
  ,listCardOperationalOverrides: cardOperationalOverrideService.list
  ,setCardOperationalOverride: cardOperationalOverrideService.set
  ,clearCardOperationalOverride: cardOperationalOverrideService.clear
  ,setAdminOrderAcceptance: adminOperationsService.setOrderAcceptance
  ,setAdminDispatch: adminOperationsService.setDispatch
  ,startAdminBusiness: startBusiness
  ,setAdminRechargePermit: async (publicNo, input = {}) => {
    const action = String(input.action || '');
    const confirmation = String(input.confirmation || '');
    if (action === 'arm') {
      if (confirmation !== `确认充值 ${publicNo}`) {
        throw new RechargePermitError('Recharge confirmation mismatch', 'RECHARGE_CONFIRMATION_REQUIRED');
      }
      return createRechargeAuthorization(pool, {
        publicNos: [publicNo],
        authorizedBy: 'admin',
        ttlMinutes: 10,
        reason: 'single order recharge authorization from admin'
      });
    }
    if (action === 'revoke') {
      if (confirmation !== `撤销充值 ${publicNo}`) {
        throw new RechargePermitError('Recharge revocation confirmation mismatch', 'RECHARGE_CONFIRMATION_REQUIRED');
      }
      const status = await getRechargeAuthorizationStatus(pool, { publicNo });
      if (status.authorization?.id && status.authorization.itemStatus === 'PENDING') {
        return revokeRechargeAuthorization(pool, {
          authorizationId: status.authorization.id,
          revokedBy: 'admin'
        });
      }
      // Rolling-deploy compatibility for permits armed before Foundation v2.
      return revokeRechargePermit(pool, { publicNo, revokedBy: 'admin' });
    }
    throw new RechargePermitError('Invalid recharge permit action', 'INVALID_RECHARGE_PERMIT_ACTION');
  }
  ,createAdminRechargeAuthorization: async (input = {}) => {
    const publicNos = Array.isArray(input.publicNos) ? input.publicNos : [];
    if (String(input.confirmation || '') !== `确认充值${publicNos.length}单`) {
      throw new RechargePermitError('Recharge confirmation mismatch', 'RECHARGE_CONFIRMATION_REQUIRED');
    }
    return createRechargeAuthorization(pool, {
      publicNos,
      ttlMinutes: input.ttlMinutes ?? 10,
      authorizedBy: 'admin',
      reason: input.reason || 'explicit batch recharge authorization from admin'
    });
  }
  ,revokeAdminRechargeAuthorization: (input) => revokeRechargeAuthorization(pool, {
    authorizationId: input.authorizationId,
    revokedBy: 'admin'
  })
  ,compensateAdminOrder
  ,cancelAdminOrder
  ,createAdminCdkBatch
  ,listAdminCdkBatches: async (input) => ({
    ...await listCdkBatches(pool, input),
    deliveryTrackingEnabled: Boolean(cdkDelivery)
  })
  ,downloadAdminCdkBatch: (batchNo) => downloadCdkBatch(pool, batchNo, config.cdkRecoveryKey)
  ,inspectAdminCdkBatch: (batchNo) => inspectCdkBatch(
    pool, batchNo, config.cdkHashKey, config.cdkRecoveryKey
  )
  ,revokeAdminCdkBatch: (batchNo, reason) => revokeCdkBatch(pool, batchNo, reason)
  ,recordAdminCdkDelivery: cdkDelivery ? async (input = {}) => {
    const common = {
      ...input,
      actorId: 'admin'
    };
    return Array.isArray(input.cdkIds)
      ? cdkDelivery.recordBatchDelivery(common)
      : cdkDelivery.recordDelivery(common);
  } : null
  ,listAdminReconciliationCases: reconciliationCases.listCases
  ,assignAdminReconciliationCase: reconciliationCases.assign
  ,resolveAdminReconciliationCase: reconciliationCases.resolve
  ,getAdminBillingAddressSettings: browserBillingAddressAdmin.get
  ,setAdminBillingAddressSettings: browserBillingAddressAdmin.set
  ,previewManualCardImport: manualCardImport.preview
  ,commitManualCardImport: manualCardImport.commit
  ,listAdminBrowserDispatchJobs: browserAdmin.listDispatchJobs
  ,listAdminBrowserRuns: browserAdmin.listRuns
  ,getAdminBrowserRun: browserAdmin.getRun
  ,controlAdminBrowserRun: (runId, input = {}) => browserAdmin.controlRun(runId, {
    ...input,
    actorId: 'admin'
  })
  ,exportAdminOperationsCsv: operationsCsv.exportCsv
});

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

const server = app.listen(config.port, config.host, () => {
  console.log(`pojia-v1 listening on ${config.host}:${config.port}`);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down`);

  server.close(async () => {
    await pool.end();
    process.exitCode = 0;
  });

  setTimeout(() => {
    process.exitCode = 1;
    server.closeAllConnections?.();
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
