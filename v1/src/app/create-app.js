import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { PublicApiError } from '../domain/public-api-error.js';
import { CdkBatchError } from '../services/cdk-service.js';
import { RechargePermitError } from '../services/recharge-permit-service.js';
import { RechargeAuthorizationV2Error } from '../services/recharge-authorization-v2-service.js';
import { OrderCompensationError } from '../services/order-compensation-service.js';
import { OrderCancellationError } from '../services/order-cancellation-service.js';
import { ReconciliationCaseError } from '../services/reconciliation-case-service.js';
import { OperationsCsvExportError } from '../services/operations-csv-export-service.js';
import { CdkDeliveryError } from '../services/cdk-delivery-service.js';
import { TraceabilityOperationError } from '../services/traceability-operations-service.js';
import { BrowserAdminError } from '../services/browser-admin-service.js';
import { createFixedWindowRateLimit } from './fixed-window-rate-limit.js';

// Manual card spreadsheets are capped at 2MB by the importer; leave room for
// base64 overhead while keeping the API body bounded.
const DEFAULT_BODY_LIMIT = '3mb';
const publicDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public'
);

export function createApp({
  readiness = async () => ({ ready: true }),
  createCustomerOrder = null,
  getCustomerOrderStatus = null,
  replaceCustomerSession = null,
  adminAuth = null,
  getAdminOverview = null,
  getAdminReadinessSummary = null,
  listAdminOrders = null,
  getAdminOrder = null,
  addAdminOrderNote = null,
  addAdminOrderTag = null,
  completeAdminCustomerPayment = null,
  listAdminAlerts = null,
  requestCardTransactionSync = null,
  getAdminCard = null,
  getAdminCardConsumption = null,
  requestAdminCardSync = null,
  discoverAdminCards = null,
  validateAdminCardIntake = null,
  acceptAdminCardIntake = null,
  listAdminCardIntake = null,
  getAdminCardStock = null,
  refreshAdminCardStockProvider = null,
  setAdminCardStockDefaultCardType = null,
  startAdminBusiness = null,
  setAdminCardStockThreshold = null,
  setAdminCardMaxSuccessfulPayments = null,
  createAdminCardStockJob = null,
  getAdminReplenishmentSettings = null,
  setAdminReplenishmentDailyLimit = null,
  listAdminCardFundingAttempts = null,
  resolveAdminCardFundingUnknown = null,
  listAdminProviderRoutes = null,
  switchAdminProviderRoute = null,
  setAdminDefaultRechargeMethod = null,
  getAdminBillingAddressSettings = null,
  setAdminBillingAddressSettings = null,
  previewManualCardImport = null,
  commitManualCardImport = null,
  listCardOperationalOverrides = null,
  setCardOperationalOverride = null,
  clearCardOperationalOverride = null,
  setAdminOrderAcceptance = null,
  setAdminDispatch = null,
  setAdminRechargePermit = null,
  createAdminRechargeAuthorization = null,
  revokeAdminRechargeAuthorization = null,
  compensateAdminOrder = null,
  cancelAdminOrder = null,
  createAdminCdkBatch = null,
  listAdminCdkBatches = null,
  downloadAdminCdkBatch = null,
  inspectAdminCdkBatch = null,
  revokeAdminCdkBatch = null,
  recordAdminCdkDelivery = null,
  listAdminReconciliationCases = null,
  assignAdminReconciliationCase = null,
  resolveAdminReconciliationCase = null,
  listAdminBrowserDispatchJobs = null,
  listAdminBrowserRuns = null,
  getAdminBrowserRun = null,
  controlAdminBrowserRun = null,
  exportAdminOperationsCsv = null,
  adminHost = null,
  orderRateLimit = createFixedWindowRateLimit(),
  orderStatusRateLimit = createFixedWindowRateLimit({ limit: 30 }),
  adminLoginRateLimit = createFixedWindowRateLimit({ limit: 5, windowMs: 15 * 60 * 1000 }),
  adminWriteRateLimit = createFixedWindowRateLimit({ limit: 60, windowMs: 15 * 60 * 1000 }),
  adminStepUpRateLimit = createFixedWindowRateLimit({ limit: 5, windowMs: 15 * 60 * 1000 })
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: DEFAULT_BODY_LIMIT, strict: true }));
  app.use((req, res, next) => {
    if (!adminHost) return next();
    const host = String(req.hostname || '').toLowerCase();
    const expected = String(adminHost).toLowerCase();
    const adminPath = req.path === '/admin' || req.path.startsWith('/admin/')
      || req.path === '/api/v1/admin' || req.path.startsWith('/api/v1/admin/');
    if (adminPath && host !== expected) return res.status(404).json({ error: 'not_found' });
    if (host === expected && req.path === '/') return res.redirect(302, '/admin');
    if (host === expected && (req.path === '/api/v1/orders' || req.path.startsWith('/api/v1/orders/')
      || req.path === '/assets' || req.path.startsWith('/assets/'))) {
      return res.status(404).json({ error: 'not_found' });
    }
    return next();
  });

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/health/ready', async (_req, res) => {
    try {
      const result = await readiness();
      if (!result?.ready) {
        return res.status(503).json({ status: 'not_ready' });
      }
      return res.json({ status: 'ready' });
    } catch {
      return res.status(503).json({ status: 'not_ready' });
    }
  });

  if (typeof createCustomerOrder === 'function') {
    app.post('/api/v1/orders', orderRateLimit, async (req, res) => {
      const order = await createCustomerOrder(req.body);
      return res.status(201).json({
        order: {
          publicNo: order.publicNo,
          status: order.status
        }
      });
    });
  }

  if (typeof getCustomerOrderStatus === 'function') {
    app.post('/api/v1/orders/status', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    }, orderStatusRateLimit, async (req, res) => {
      const order = await getCustomerOrderStatus(req.body);
      return res.json({ order });
    });
  }

  if (typeof replaceCustomerSession === 'function') {
    app.post('/api/v1/orders/session', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    }, orderRateLimit, async (req, res) => {
      const order = await replaceCustomerSession(req.body || {});
      return res.json({ order });
    });
  }

  const noStore = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  const requireAdminApi = async (req, res, next) => {
    if (!adminAuth || !await adminAuth.authenticateRequest(req)) {
      return res.status(401).json({ error: 'admin_auth_required' });
    }
    return next();
  };
  const requireAdminOrigin = (req, res, next) => {
    const origin = String(req.get('origin') || '');
    const expectedOrigin = `${req.protocol}://${req.get('host')}`;
    if (origin !== expectedOrigin) {
      return res.status(403).json({ error: 'admin_origin_required' });
    }
    return next();
  };
  const requireAdminStepUp = async (req, res, next) => {
    if (!adminAuth || !await adminAuth.hasStepUp(req)) {
      return res.status(403).json({ error: 'admin_step_up_required' });
    }
    return next();
  };
  const adminWriteGuards = [noStore, requireAdminApi, requireAdminOrigin, adminWriteRateLimit];
  const sensitiveAdminGuards = [...adminWriteGuards, requireAdminStepUp];

  app.get('/admin/login', noStore, async (req, res) => {
    if (adminAuth && await adminAuth.authenticateRequest(req)) return res.redirect(302, '/admin');
    return res.sendFile(path.join(publicDirectory, 'admin', 'login.html'));
  });

  app.post('/api/v1/admin/session', noStore, adminLoginRateLimit, async (req, res) => {
    if (!adminAuth) return res.status(503).json({ error: 'admin_not_configured' });
    const password = req.body?.password;
    if (!await adminAuth.verifyPassword(password)) {
      return res.status(401).json({ error: 'invalid_admin_credentials' });
    }
    adminAuth.setSessionCookie(res, await adminAuth.issueSession());
    return res.status(204).end();
  });

  app.post('/api/v1/admin/step-up', noStore, requireAdminApi, requireAdminOrigin,
    adminStepUpRateLimit, async (req, res) => {
      const token = await adminAuth.issueStepUp(req, req.body?.password);
      if (!token) return res.status(401).json({ error: 'invalid_admin_credentials' });
      adminAuth.setStepUpCookie(res, token);
      return res.status(204).end();
    });

  app.get('/api/v1/admin/session', noStore, requireAdminApi, (_req, res) => {
    res.json({ authenticated: true });
  });

  app.delete('/api/v1/admin/session', ...adminWriteGuards, async (_req, res) => {
    await adminAuth.revokeAllSessions();
    adminAuth.clearSessionCookie(res);
    return res.status(204).end();
  });

  if (typeof getAdminOverview === 'function') {
    app.get('/api/v1/admin/overview', noStore, requireAdminApi, async (_req, res) => {
      res.json(await getAdminOverview());
    });
  }
  if (typeof getAdminReadinessSummary === 'function') {
    app.get('/api/v1/admin/operations/readiness', noStore, requireAdminApi, async (_req, res) => {
      res.json(await getAdminReadinessSummary());
    });
  }
  if (typeof listAdminOrders === 'function') {
    app.get('/api/v1/admin/orders', noStore, requireAdminApi, async (req, res) => {
      if (req.query?.q) return res.status(400).json({ error: 'admin_search_body_required' });
      res.json(await listAdminOrders(req.query));
    });
    app.post('/api/v1/admin/orders/search', ...adminWriteGuards, async (req, res) => {
      res.json(await listAdminOrders(req.body || {}));
    });
  }
  if (typeof getAdminOrder === 'function') {
    app.get('/api/v1/admin/orders/:publicNo', noStore, requireAdminApi, async (req, res) => {
      res.json(await getAdminOrder(req.params.publicNo));
    });
  }
  if (typeof addAdminOrderNote === 'function') {
    app.post('/api/v1/admin/orders/:publicNo/notes', ...adminWriteGuards, async (req, res) => {
      try {
        return res.status(201).json(await addAdminOrderNote(req.params.publicNo, req.body || {}));
      } catch (error) {
        if (error instanceof TraceabilityOperationError) {
          return res.status(error.status).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof addAdminOrderTag === 'function') {
    app.post('/api/v1/admin/orders/:publicNo/tags', ...adminWriteGuards, async (req, res) => {
      try {
        return res.status(201).json(await addAdminOrderTag(req.params.publicNo, req.body || {}));
      } catch (error) {
        if (error instanceof TraceabilityOperationError) {
          return res.status(error.status).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof completeAdminCustomerPayment === 'function') {
    app.post('/api/v1/admin/orders/:publicNo/customer-payment', ...sensitiveAdminGuards, async (req, res) => {
      try {
        return res.json(await completeAdminCustomerPayment(req.params.publicNo, req.body || {}));
      } catch (error) {
        if (error instanceof TraceabilityOperationError) {
          return res.status(error.status).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof listAdminAlerts === 'function') {
    app.get('/api/v1/admin/alerts', noStore, requireAdminApi, async (req, res) => {
      res.json(await listAdminAlerts(req.query));
    });
  }
  if (typeof requestCardTransactionSync === 'function') {
    app.post('/api/v1/admin/orders/:publicNo/sync-transactions', ...adminWriteGuards, async (req, res) => {
      const result = await requestCardTransactionSync(req.params.publicNo);
      return res.status(result.queued ? 202 : 200).json(result);
    });
  }
  if (typeof getAdminCard === 'function') {
    app.get('/api/v1/admin/cards/:providerCardId', noStore, requireAdminApi, async (req, res) => {
      res.json(await getAdminCard(req.params.providerCardId, req.query || {}));
    });
  }
  if (typeof getAdminCardConsumption === 'function') {
    app.get('/api/v1/admin/card-consumption', noStore, requireAdminApi, async (req, res) => {
      res.json(await getAdminCardConsumption(req.query || {}));
    });
  }
  if (typeof requestAdminCardSync === 'function') {
    app.post('/api/v1/admin/cards/sync', ...adminWriteGuards, async (req, res) => {
      const result = await requestAdminCardSync(req.body || {});
      return res.status(result.queued ? 202 : 200).json(result);
    });
  }
  if (typeof listAdminCardIntake === 'function') {
    app.get('/api/v1/admin/card-intake', noStore, requireAdminApi, async (req, res) => {
      res.json(await listAdminCardIntake(req.query || {}));
    });
  }
  if (typeof discoverAdminCards === 'function') {
    app.post('/api/v1/admin/card-intake/discover', ...adminWriteGuards, async (_req, res) => {
      return res.status(202).json(await discoverAdminCards());
    });
  }
  if (typeof validateAdminCardIntake === 'function') {
    app.post('/api/v1/admin/card-intake/:batchId/validate', ...adminWriteGuards, async (req, res) => {
      return res.status(202).json(await validateAdminCardIntake(req.params.batchId));
    });
  }
  if (typeof acceptAdminCardIntake === 'function') {
    app.post('/api/v1/admin/card-intake/:batchId/accept', ...sensitiveAdminGuards, async (req, res) => {
      res.json(await acceptAdminCardIntake({
        batchId: req.params.batchId,
        discoveryIds: req.body?.discoveryIds
      }));
    });
  }
  if (typeof getAdminCardStock === 'function') {
    app.get('/api/v1/admin/card-stock', noStore, requireAdminApi, async (_req, res) => {
      res.json(await getAdminCardStock());
    });
  }
  if (typeof refreshAdminCardStockProvider === 'function') {
    app.post('/api/v1/admin/card-stock/provider-refresh', ...adminWriteGuards, async (_req, res) => {
      res.json(await refreshAdminCardStockProvider());
    });
  }
  if (typeof setAdminCardStockDefaultCardType === 'function') {
    app.post('/api/v1/admin/card-stock/default-card-type', ...adminWriteGuards, async (req, res) => {
      res.json(await setAdminCardStockDefaultCardType(req.body?.cardTypeId));
    });
  }
  if (typeof startAdminBusiness === 'function') {
    app.post('/api/v1/admin/operations/start-business', ...adminWriteGuards, async (_req, res) => {
      const result = await startAdminBusiness();
      if (!result.ready) return res.status(409).json({ error: 'business_not_ready', ...result });
      return res.json(result);
    });
  }
  if (typeof setAdminCardStockThreshold === 'function') {
    app.post('/api/v1/admin/card-stock/threshold', ...adminWriteGuards, async (req, res) => {
      res.json(await setAdminCardStockThreshold(req.body?.count));
    });
  }
  if (typeof setAdminCardMaxSuccessfulPayments === 'function') {
    app.post('/api/v1/admin/card-stock/max-successful-payments', ...adminWriteGuards, async (req, res) => {
      const count = req.body?.count;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 4) {
        return res.status(400).json({ error: 'invalid_card_capacity' });
      }
      res.json(await setAdminCardMaxSuccessfulPayments(count));
    });
  }
  if (typeof createAdminCardStockJob === 'function') {
    app.post('/api/v1/admin/card-stock/jobs', ...sensitiveAdminGuards, async (req, res) => {
      const job = await createAdminCardStockJob(req.body);
      return res.status(202).json({ job });
    });
  }
  if (typeof getAdminReplenishmentSettings === 'function') {
    app.get('/api/v1/admin/card-stock/replenishment-settings', noStore, requireAdminApi, async (req, res) => {
      res.json(await getAdminReplenishmentSettings());
    });
  }
  if (typeof listAdminCardFundingAttempts === 'function') {
    app.get('/api/v1/admin/card-funding-attempts', noStore, requireAdminApi, async (req, res) => {
      try {
        return res.json(await listAdminCardFundingAttempts(req.query || {}));
      } catch (error) {
        if (error instanceof PublicApiError) {
          return res.status(error.status || 400).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof resolveAdminCardFundingUnknown === 'function') {
    app.post('/api/v1/admin/card-funding-attempts/:attemptId/resolve', ...sensitiveAdminGuards, async (req, res) => {
      try {
        return res.json(await resolveAdminCardFundingUnknown({
          attemptId: req.params.attemptId,
          action: req.body?.action,
          actorId: req.admin?.id || 'admin',
          note: req.body?.note,
          confirmation: req.body?.confirmation
        }));
      } catch (error) {
        if (error instanceof PublicApiError) {
          return res.status(error.status || 400).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof listAdminProviderRoutes === 'function') {
    app.get('/api/v1/admin/provider-routes', noStore, requireAdminApi, async (_req, res) => {
      res.json(await listAdminProviderRoutes());
    });
  }
  if (typeof switchAdminProviderRoute === 'function') {
    app.post('/api/v1/admin/provider-routes/:routeId/switch', ...sensitiveAdminGuards, async (req, res) => {
      try {
        return res.json(await switchAdminProviderRoute({
          routeId: req.params.routeId,
          actorId: req.admin?.id || 'admin',
          operatorNote: req.body?.note,
          confirmation: req.body?.confirmation
        }));
      } catch (error) {
        if (error instanceof PublicApiError) {
          return res.status(error.status || 400).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof setAdminDefaultRechargeMethod === 'function') {
    app.post('/api/v1/admin/operations/default-recharge-method', ...adminWriteGuards, async (req, res) => {
      try {
        return res.json(await setAdminDefaultRechargeMethod({
          method: req.body?.method,
          actorId: req.admin?.id || 'admin',
          confirmation: req.body?.confirmation
        }));
      } catch (error) {
        if (error instanceof PublicApiError) {
          return res.status(error.status || 400).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof getAdminBillingAddressSettings === 'function') {
    app.get('/api/v1/admin/browser/billing-address', noStore, requireAdminApi, async (_req, res) => res.json(await getAdminBillingAddressSettings()));
  }
  if (typeof setAdminBillingAddressSettings === 'function') {
    app.post('/api/v1/admin/browser/billing-address', ...sensitiveAdminGuards, async (req, res) => {
      try { return res.json(await setAdminBillingAddressSettings({ ...req.body, actorId: req.admin?.id || 'admin' })); }
      catch (error) { if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase() }); throw error; }
    });
  }
  if (typeof previewManualCardImport === 'function') {
    app.post('/api/v1/admin/manual-cards/preview', ...adminWriteGuards, async (req, res) => {
      try { return res.json(await previewManualCardImport({ ...(req.body || {}), requestedBy: req.admin?.id || 'admin' })); }
      catch (error) { if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase() }); throw error; }
    });
  }
  if (typeof commitManualCardImport === 'function') {
    app.post('/api/v1/admin/manual-cards/import', ...sensitiveAdminGuards, async (req, res) => {
      try { return res.json(await commitManualCardImport({ ...(req.body || {}), requestedBy: req.admin?.id || 'admin' })); }
      catch (error) { if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase() }); throw error; }
    });
  }
  if (typeof listCardOperationalOverrides === 'function') {
    app.get('/api/v1/admin/card-operational-overrides', noStore, requireAdminApi, async (req, res) => {
      res.json(await listCardOperationalOverrides(req.query || {}));
    });
  }
  if (typeof setCardOperationalOverride === 'function') {
    app.post('/api/v1/admin/card-operational-overrides', ...sensitiveAdminGuards, async (req, res) => {
      res.status(200).json(await setCardOperationalOverride({ ...(req.body || {}), actorId: req.admin?.id || 'admin' }));
    });
  }
  if (typeof clearCardOperationalOverride === 'function') {
    app.delete('/api/v1/admin/card-operational-overrides', ...sensitiveAdminGuards, async (req, res) => {
      res.json(await clearCardOperationalOverride(req.body || {}));
    });
  }
  if (typeof setAdminReplenishmentDailyLimit === 'function') {
    app.post('/api/v1/admin/card-stock/replenishment-settings', ...sensitiveAdminGuards, async (req, res) => {
      res.json(await setAdminReplenishmentDailyLimit({
        value: req.body?.dailyLimit,
        actorId: 'admin',
        reason: req.body?.reason
      }));
    });
  }
  if (typeof setAdminOrderAcceptance === 'function') {
    app.post('/api/v1/admin/operations/order-acceptance', ...adminWriteGuards, async (req, res) => {
      res.json(await setAdminOrderAcceptance(req.body));
    });
  }
  if (typeof setAdminDispatch === 'function') {
    app.post('/api/v1/admin/operations/recharge-dispatch', ...adminWriteGuards, async (req, res) => {
      res.json(await setAdminDispatch(req.body));
    });
  }
  if (typeof setAdminRechargePermit === 'function') {
    app.post('/api/v1/admin/orders/:publicNo/recharge-permit', ...sensitiveAdminGuards, async (req, res) => {
      try {
        const result = await setAdminRechargePermit(req.params.publicNo, req.body);
        return res.status(req.body?.action === 'arm' ? 202 : 200).json(result);
      } catch (error) {
        if (error instanceof RechargePermitError || error instanceof RechargeAuthorizationV2Error || [
          'RECHARGE_CONFIRMATION_REQUIRED', 'INVALID_RECHARGE_PERMIT_ACTION'
        ].includes(error?.code)) {
          return res.status(400).json({ error: String(error.code).toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof createAdminRechargeAuthorization === 'function') {
    app.post('/api/v1/admin/recharge-authorizations', ...sensitiveAdminGuards, async (req, res) => {
      try {
        return res.status(201).json(await createAdminRechargeAuthorization(req.body || {}));
      } catch (error) {
        if (error instanceof RechargeAuthorizationV2Error || error instanceof RechargePermitError) {
          return res.status(400).json({ error: error.code.toLowerCase(), details: error.details });
        }
        throw error;
      }
    });
  }
  if (typeof revokeAdminRechargeAuthorization === 'function') {
    app.post('/api/v1/admin/recharge-authorizations/:authorizationId/revoke',
      ...sensitiveAdminGuards, async (req, res) => {
        try {
          return res.json(await revokeAdminRechargeAuthorization({
            authorizationId: req.params.authorizationId,
            ...(req.body || {})
          }));
        } catch (error) {
          if (error instanceof RechargeAuthorizationV2Error) {
            return res.status(400).json({ error: error.code.toLowerCase(), details: error.details });
          }
          throw error;
        }
      });
  }
  if (typeof compensateAdminOrder === 'function') {
    app.post('/api/v1/admin/orders/:publicNo/compensation', ...sensitiveAdminGuards, async (req, res) => {
      try {
        res.json(await compensateAdminOrder(req.params.publicNo, req.body));
      } catch (error) {
        if (error instanceof OrderCompensationError) {
          return res.status(error.status).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof cancelAdminOrder === 'function') {
    app.post('/api/v1/admin/orders/:publicNo/cancellation', ...sensitiveAdminGuards, async (req, res) => {
      try {
        res.json(await cancelAdminOrder(req.params.publicNo, req.body));
      } catch (error) {
        if (error instanceof OrderCancellationError) {
          return res.status(error.status).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof createAdminCdkBatch === 'function') {
    app.post('/api/v1/admin/cdks/generate', ...sensitiveAdminGuards, async (req, res) => {
      try {
        const result = await createAdminCdkBatch({
          ...req.body,
          requestKey: req.get('idempotency-key')
        });
        return res.status(201).json(result);
      } catch (error) {
        if (error instanceof CdkBatchError) {
          return res.status(400).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof listAdminCdkBatches === 'function') {
    app.get('/api/v1/admin/cdks/batches', noStore, requireAdminApi, async (req, res) => {
      res.json(await listAdminCdkBatches(req.query));
    });
  }
  if (typeof downloadAdminCdkBatch === 'function') {
    app.post('/api/v1/admin/cdks/:batchNo/download', ...sensitiveAdminGuards, async (req, res) => {
      try {
        res.json(await downloadAdminCdkBatch(req.params.batchNo));
      } catch (error) {
        if (error instanceof CdkBatchError) {
          return res.status(404).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof inspectAdminCdkBatch === 'function') {
    app.post('/api/v1/admin/cdks/:batchNo/status-report', ...sensitiveAdminGuards, async (req, res) => {
      try {
        res.json(await inspectAdminCdkBatch(req.params.batchNo));
      } catch (error) {
        if (error instanceof CdkBatchError) {
          return res.status(404).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof revokeAdminCdkBatch === 'function') {
    app.post('/api/v1/admin/cdks/:batchNo/revoke', ...sensitiveAdminGuards, async (req, res) => {
      try {
        const result = await revokeAdminCdkBatch(req.params.batchNo, req.body?.reason);
        return res.json(result);
      } catch (error) {
        if (error instanceof CdkBatchError) {
          return res.status(400).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof recordAdminCdkDelivery === 'function') {
    app.post('/api/v1/admin/cdks/deliveries', ...sensitiveAdminGuards, async (req, res) => {
      try {
        return res.status(201).json(await recordAdminCdkDelivery(req.body || {}));
      } catch (error) {
        if (error instanceof CdkDeliveryError) {
          return res.status(400).json({ error: error.code.toLowerCase(), details: error.details });
        }
        throw error;
      }
    });
  }
  if (typeof listAdminReconciliationCases === 'function') {
    app.get('/api/v1/admin/reconciliation-cases', noStore, requireAdminApi, async (req, res) => {
      try {
        return res.json(await listAdminReconciliationCases(req.query || {}));
      } catch (error) {
        if (error instanceof ReconciliationCaseError) {
          return res.status(400).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof assignAdminReconciliationCase === 'function') {
    app.post('/api/v1/admin/reconciliation-cases/:caseId/assign', ...adminWriteGuards, async (req, res) => {
      try {
        return res.json(await assignAdminReconciliationCase({
          id: req.params.caseId,
          assignedTo: req.body?.assignedTo
        }));
      } catch (error) {
        if (error instanceof ReconciliationCaseError) {
          return res.status(error.code === 'CASE_NOT_FOUND' ? 404 : 400)
            .json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof resolveAdminReconciliationCase === 'function') {
    app.post('/api/v1/admin/reconciliation-cases/:caseId/resolve', ...sensitiveAdminGuards, async (req, res) => {
      try {
        return res.json(await resolveAdminReconciliationCase({
          id: req.params.caseId,
          resolutionNote: req.body?.resolutionNote
        }));
      } catch (error) {
        if (error instanceof ReconciliationCaseError) {
          return res.status(error.code === 'CASE_NOT_FOUND' ? 404 : 400)
            .json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof listAdminBrowserRuns === 'function') {
    app.get('/api/v1/admin/browser/runs', noStore, requireAdminApi, async (req, res) => {
      try {
        return res.json(await listAdminBrowserRuns(req.query || {}));
      } catch (error) {
        if (error instanceof BrowserAdminError) {
          return res.status(error.status).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof listAdminBrowserDispatchJobs === 'function') {
    app.get('/api/v1/admin/browser/dispatch-jobs', noStore, requireAdminApi, async (req, res) => {
      try {
        return res.json(await listAdminBrowserDispatchJobs(req.query || {}));
      } catch (error) {
        if (error instanceof BrowserAdminError) {
          return res.status(error.status).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof getAdminBrowserRun === 'function') {
    app.get('/api/v1/admin/browser/runs/:runId', noStore, requireAdminApi, async (req, res) => {
      try {
        return res.json(await getAdminBrowserRun(req.params.runId));
      } catch (error) {
        if (error instanceof BrowserAdminError) {
          return res.status(error.status).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof controlAdminBrowserRun === 'function') {
    app.post('/api/v1/admin/browser/runs/:runId/control', ...sensitiveAdminGuards, async (req, res) => {
      try {
        return res.json(await controlAdminBrowserRun(req.params.runId, req.body || {}));
      } catch (error) {
        if (error instanceof BrowserAdminError) {
          return res.status(error.status).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof exportAdminOperationsCsv === 'function') {
    app.get('/api/v1/admin/exports/:dataset.csv', noStore, requireAdminApi, async (req, res) => {
      try {
        const result = await exportAdminOperationsCsv({
          dataset: req.params.dataset,
          limit: req.query?.limit,
          cursor: req.query?.cursor,
          includeBom: true
        });
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${result.dataset}-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.setHeader('X-Export-Row-Count', String(result.rowCount));
        res.setHeader('X-Export-Truncated', String(result.truncated));
        if (result.nextCursor) res.setHeader('X-Export-Next-Cursor', result.nextCursor);
        return res.send(result.csv);
      } catch (error) {
        if (error instanceof OperationsCsvExportError) {
          return res.status(400).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }

  app.get('/admin', noStore, async (req, res) => {
    if (!adminAuth || !await adminAuth.authenticateRequest(req)) return res.redirect(302, '/admin/login');
    return res.sendFile(path.join(publicDirectory, 'admin', 'index.html'));
  });
  app.use('/admin/assets', express.static(path.join(publicDirectory, 'admin', 'assets'), {
    etag: true,
    maxAge: 0,
    fallthrough: true
  }));

  app.get('/', async (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.type('html').send(await readFile(path.join(publicDirectory, 'index.html')));
    } catch (error) {
      next(error);
    }
  });
  app.use('/assets', express.static(path.join(publicDirectory, 'assets'), {
    etag: true,
    maxAge: 0,
    fallthrough: true
  }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof PublicApiError) {
      return res.status(error.status).json({ error: error.code.toLowerCase() });
    }
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'body_too_large' });
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: 'invalid_json' });
    }
    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
