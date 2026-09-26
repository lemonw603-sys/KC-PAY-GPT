import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { PublicApiError } from '../domain/public-api-error.js';
import { CdkBatchError } from '../services/cdk-service.js';
import { MANUAL_FULFILLMENT_CONFIRMATION } from '../services/manual-fulfillment-service.js';
import { OrderCancellationError } from '../services/order-cancellation-service.js';
import { ReconciliationCaseError } from '../services/reconciliation-case-service.js';
import { OperationsCsvExportError } from '../services/operations-csv-export-service.js';
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
  verifyCustomerCdk = null,
  replaceCustomerSession = null,
  adminAuth = null,
  getAdminOverview = null,
  listAdminOrders = null,
  getFailureStats = null,
  getAdminOrder = null,
  getAdminOrderTimeline = null,
  listAdminOrderAttempts = null,
  closeAdminManualFulfilled = null,
  completeAdminCustomerPayment = null,
  listAdminAlerts = null,
  closeAdminAlert = null,
  requestCardTransactionSync = null,
  getAdminCard = null,
  requestAdminCardSync = null,
  discoverAdminCards = null,
  validateAdminCardIntake = null,
  acceptAdminCardIntake = null,
  listAdminCardIntake = null,
  getAdminCardStock = null,
  refreshAdminCardStockProvider = null,
  setAdminCardStockDefaultCardType = null,
  startAdminBusiness = null,
  setAdminCardMaxSuccessfulPayments = null,
  setAdminCardMinimumBalance = null,
  refreshHighvccSnapshot = null,
  getAdminSupplySettings = null,
  setAdminSupplyPolicyField = null,
  setAdminProviderWalletField = null,
  createAdminCardStockJob = null,
  getHighvccCardStatus = null,
  setHighvccCardToken = null,
  quoteHighvccCard = null,
  openHighvccCard = null,
  listHighvccCardRanges = null,
  getHighvccWalletStatus = null,
  setAdminDefaultRechargeMethod = null,
  listAdminCardSources = null,
  createAdminManualCardSource = null,
  estimateAdminBrowserCardSourceTakeover = null,
  switchAdminBrowserCardSource = null,
  getAdminBillingAddressSettings = null,
  setAdminBillingAddressSettings = null,
  previewManualCardImport = null,
  commitManualCardImport = null,
  listCardOperationalOverrides = null,
  setCardOperationalOverride = null,
  clearCardOperationalOverride = null,
  setAdminOrderAcceptance = null,
  setAdminDispatch = null,
  setAdminBrowserPaymentWrites = null,
  cancelAdminOrder = null,
  confirmManualCancellation = null,
  resolveUnknownSubmission = null,
  listCardRetirementCandidates = null,
  runDailyReconciliation = null,
  confirmCardRetired = null,
  undoCardRetired = null,
  createAdminCdkBatch = null,
  listAdminCdkBatches = null,
  downloadAdminCdkBatch = null,
  inspectAdminCdkBatch = null,
  revokeAdminCdkBatch = null,
  listAdminCdkCodes = null,
  revokeAdminCdkCode = null,
  markAdminCdkIssued = null,
  summarizeAdminCdkLiability = null,
  listAdminCdkBatchOptions = null,
  updateAdminCdkCodes = null,
  updateAdminCdkBatchMetadata = null,
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
  cdkVerifyRateLimit = createFixedWindowRateLimit({ limit: 10, windowMs: 60 * 1000 }),
  orderStatusRateLimit = createFixedWindowRateLimit({ limit: 30 }),
  adminLoginRateLimit = createFixedWindowRateLimit({ limit: 5, windowMs: 15 * 60 * 1000 }),
  adminWriteRateLimit = createFixedWindowRateLimit({ limit: 60, windowMs: 15 * 60 * 1000 })
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
      || req.path.startsWith('/api/v1/cdks/')
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

  if (typeof verifyCustomerCdk === 'function') {
    // The first screen of the customer flow: check the code before asking for a
    // Session, so a bad code fails in two seconds instead of after the customer
    // has fetched and pasted a Session. Read-only — it changes nothing, and
    // intake re-decides everything under lock when the order is actually placed.
    app.post('/api/v1/cdks/verify', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    }, cdkVerifyRateLimit, async (req, res) => {
      const cdk = await verifyCustomerCdk(req.body || {});
      return res.json({ cdk });
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
  const adminWriteGuards = [noStore, requireAdminApi, requireAdminOrigin, adminWriteRateLimit];
  // D-119/D-129: money and production actions use the same same-origin session write
  // guards; the operator confirms once in the page dialog, never with a second password.
  const sensitiveAdminGuards = [...adminWriteGuards];

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
  if (typeof getAdminOrderTimeline === 'function') {
    app.get('/api/v1/admin/orders/:publicNo/timeline', noStore, requireAdminApi, async (req, res) => {
      res.json(await getAdminOrderTimeline(req.params.publicNo));
    });
  }
  if (typeof listAdminOrderAttempts === 'function') {
    // 订单页 v3（D-356）：同一张码下这一单之外的其它尝试，列表展开「此前 N 次」时读。
    app.get('/api/v1/admin/orders/:publicNo/attempts', noStore, requireAdminApi, async (req, res) => {
      res.json(await listAdminOrderAttempts(req.params.publicNo));
    });
  }
  if (typeof closeAdminManualFulfilled === 'function') {
    // 订单页 v3（D-356 ⑤）：「标为已手工充值」。守卫与脚本 close-manually-fulfilled-order.mjs 同一份
    // （manual-fulfillment-service）：任何系统付款痕迹即拒；要打确认词。
    app.post('/api/v1/admin/orders/:publicNo/manual-fulfilled', ...sensitiveAdminGuards, async (req, res) => {
      const body = req.body || {};
      if (String(body.confirmation || '') !== MANUAL_FULFILLMENT_CONFIRMATION) {
        return res.status(400).json({ error: 'manual_fulfillment_confirmation_required' });
      }
      try {
        return res.json(await closeAdminManualFulfilled(req.params.publicNo, {
          cardUsed: body.cardUsed === true, reason: body.reason || '', actorId: req.admin?.id || 'admin'
        }));
      } catch (error) {
        if (error?.name === 'ManualFulfillmentError') {
          return res.status(error.status || 409).json({ error: error.code.toLowerCase(), detail: error.detail || null });
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
  if (typeof closeAdminAlert === 'function') {
    // Operator dismissal of an OPEN internal alert. It only marks the alert
    // RESOLVED; it never changes orders, cards or settings.
    app.post('/api/v1/admin/alerts/:alertId/close', ...adminWriteGuards, async (req, res) => {
      const result = await closeAdminAlert(req.params.alertId);
      return res.status(result.closed ? 200 : 404).json(result);
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
  if (typeof setAdminCardMaxSuccessfulPayments === 'function') {
    app.post('/api/v1/admin/card-stock/max-successful-payments', ...adminWriteGuards, async (req, res) => {
      const count = req.body?.count;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 4) {
        return res.status(400).json({ error: 'invalid_card_capacity' });
      }
      // D-221：按产品；不传按 Plus（历史全局键）
      const planType = req.body?.planType === undefined ? 'plus' : req.body.planType;
      if (typeof planType !== 'string' || !/^(plus|pro_5x|pro_20x)$/.test(planType)) {
        return res.status(400).json({ error: 'invalid_plan_type' });
      }
      res.json(await setAdminCardMaxSuccessfulPayments(count, planType));
    });
  }
  if (typeof setAdminCardMinimumBalance === 'function') {
    app.post('/api/v1/admin/card-stock/minimum-balance', ...adminWriteGuards, async (req, res) => {
      const amount = req.body?.amount;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1000
        || Math.round(amount * 100) !== amount * 100) {
        return res.status(400).json({ error: 'invalid_minimum_balance' });
      }
      const planType = req.body?.planType == null ? 'plus' : String(req.body.planType).trim().toLowerCase();
      if (!['plus', 'pro_5x', 'pro_20x'].includes(planType)) return res.status(400).json({ error: 'invalid_plan_type' });
      res.json(await setAdminCardMinimumBalance(amount, planType));
    });
  }
  // 设置页（第⑥步 B / D-290）。策略表与钱包底线此前只有读、没有写端点——
  // 真正决定「何时自动开卡、开多大金额、钱够不够」的数，过去只能改库。
  if (typeof getAdminSupplySettings === 'function') {
    app.get('/api/v1/admin/settings/supply', noStore, requireAdminApi, async (_req, res) => {
      res.json(await getAdminSupplySettings());
    });
  }
  if (typeof setAdminSupplyPolicyField === 'function') {
    app.post('/api/v1/admin/settings/supply-policy', ...adminWriteGuards, async (req, res) => {
      try {
        return res.json(await setAdminSupplyPolicyField({
          providerAccountId: req.body?.providerAccountId,
          productCode: req.body?.productCode,
          field: req.body?.field,
          value: req.body?.value,
          reason: req.body?.reason ?? null,
          actorId: req.admin?.id || 'admin'
        }));
      } catch (error) {
        if (error instanceof PublicApiError) {
          return res.status(error.status || 400).json({ error: error.code.toLowerCase(), detail: error.message });
        }
        throw error;
      }
    });
  }
  if (typeof setAdminProviderWalletField === 'function') {
    app.post('/api/v1/admin/settings/provider-wallet', ...adminWriteGuards, async (req, res) => {
      try {
        return res.json(await setAdminProviderWalletField({
          providerAccountId: req.body?.providerAccountId,
          field: req.body?.field,
          value: req.body?.value,
          reason: req.body?.reason ?? null,
          actorId: req.admin?.id || 'admin'
        }));
      } catch (error) {
        if (error instanceof PublicApiError) {
          return res.status(error.status || 400).json({ error: error.code.toLowerCase(), detail: error.message });
        }
        throw error;
      }
    });
  }
  if (typeof createAdminCardStockJob === 'function') {
    app.post('/api/v1/admin/card-stock/jobs', ...sensitiveAdminGuards, async (req, res) => {
      const job = await createAdminCardStockJob(req.body);
      return res.status(202).json({ job });
    });
  }
  // Backup card platform A (highvcc.com): a separate, synchronous open — not routed through
  // card_stock_jobs, whose createJob preconditions (provider snapshot / catalog freshness)
  // exist for HNSKJ's rate-limited, drift-prone catalog and don't apply to a live, always-
  // queryable API. One click = one card, executed and returned in the same request.
  if (typeof getHighvccCardStatus === 'function') {
    app.get('/api/v1/admin/backup-cards/highvcc/status', noStore, requireAdminApi, async (_req, res) => {
      res.json(await getHighvccCardStatus());
    });
  }
  if (typeof listHighvccCardRanges === 'function') {
    app.get('/api/v1/admin/backup-cards/highvcc/ranges', noStore, requireAdminApi, async (_req, res) => {
      try {
        return res.json(await listHighvccCardRanges());
      } catch (error) {
        if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase(), detail: error.detail || null });
        throw error;
      }
    });
  }
  if (typeof getHighvccWalletStatus === 'function') {
    app.get('/api/v1/admin/backup-cards/highvcc/wallet', noStore, requireAdminApi, async (_req, res) => {
      try {
        return res.json(await getHighvccWalletStatus());
      } catch (error) {
        if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase(), detail: error.detail || null });
        throw error;
      }
    });
  }
  // D-280 ②「刷新这台」（highvcc）。与 hnskj 的 card-stock/provider-refresh 对称，
  // 但要慢得多：它走 list + 每张 detail，卡多时是几十秒级的外部调用，前端需提示等待。
  // 不花钱（不开卡），所以用 adminWriteGuards 而不是 sensitiveAdminGuards。
  if (typeof refreshHighvccSnapshot === 'function') {
    app.post('/api/v1/admin/backup-cards/highvcc/refresh', ...adminWriteGuards, async (_req, res) => {
      const result = await refreshHighvccSnapshot();
      return res.status(result.failed?.length ? 207 : 200).json(result);
    });
  }
  if (typeof setHighvccCardToken === 'function') {
    app.post('/api/v1/admin/backup-cards/highvcc/token', ...sensitiveAdminGuards, async (req, res) => {
      try {
        return res.json(await setHighvccCardToken({ token: req.body?.token, requestedBy: req.admin?.id || 'admin' }));
      } catch (error) {
        if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
  }
  if (typeof quoteHighvccCard === 'function') {
    app.post('/api/v1/admin/backup-cards/highvcc/quote', noStore, requireAdminApi, async (req, res) => {
      try {
        return res.json(await quoteHighvccCard({ vid: req.body?.vid, amount: req.body?.amount }));
      } catch (error) {
        if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase(), detail: error.detail || null });
        throw error;
      }
    });
  }
  if (typeof openHighvccCard === 'function') {
    app.post('/api/v1/admin/backup-cards/highvcc/open', ...sensitiveAdminGuards, async (req, res) => {
      try {
        const result = await openHighvccCard({
          vid: req.body?.vid, amount: req.body?.amount, confirmation: req.body?.confirmation,
          requestedBy: req.admin?.id || 'admin',
        });
        return res.status(201).json(result);
      } catch (error) {
        if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase(), detail: error.detail || null });
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
          confirmation: req.body?.confirmation,
          expectedCurrentMethod: req.body?.expectedCurrentMethod
        }));
      } catch (error) {
        if (error instanceof PublicApiError) {
          // 四项校验的逐项结果一起交回：拒切要说清楚是哪一项没过（D-246 面一 C1 ③）。
          return res.status(error.status || 400).json({ error: error.code.toLowerCase(), checks: error.checks || null });
        }
        throw error;
      }
    });
  }
  if (typeof listAdminCardSources === 'function') {
    app.get('/api/v1/admin/card-sources', noStore, requireAdminApi, async (_req, res) => {
      res.json(await listAdminCardSources());
    });
  }
  if (typeof createAdminManualCardSource === 'function') {
    app.post('/api/v1/admin/card-sources', ...sensitiveAdminGuards, async (req, res) => {
      res.status(201).json(await createAdminManualCardSource({
        ...(req.body || {}), actorId: req.admin?.id || 'admin'
      }));
    });
  }
  if (typeof estimateAdminBrowserCardSourceTakeover === 'function') {
    app.get('/api/v1/admin/card-sources/browser/takeover-estimate', noStore, requireAdminApi,
      async (_req, res) => res.json(await estimateAdminBrowserCardSourceTakeover()));
  }
  if (typeof switchAdminBrowserCardSource === 'function') {
    app.post('/api/v1/admin/card-sources/browser/current', ...adminWriteGuards, async (req, res) => {
      try {
        return res.json(await switchAdminBrowserCardSource({
          providerAccountId: req.body?.providerAccountId,
          expectedVersion: req.body?.expectedVersion,
          takeoverWaiting: req.body?.takeoverWaiting === true,
          actorId: req.admin?.id || 'admin'
        }));
      } catch (error) {
        if (error instanceof PublicApiError) {
          return res.status(error.status || 400).json({ error: error.code.toLowerCase(), checks: error.checks || null });
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
    app.post('/api/v1/admin/manual-cards/import', ...adminWriteGuards, async (req, res) => {
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
      res.json(await clearCardOperationalOverride({ ...(req.body || {}), actorId: req.admin?.id || 'admin' }));
    });
  }
  if (typeof setAdminOrderAcceptance === 'function') {
    app.post('/api/v1/admin/operations/order-acceptance', ...adminWriteGuards, async (req, res) => {
      res.json(await setAdminOrderAcceptance({ ...(req.body || {}), actorId: req.admin?.id || 'admin' }));
    });
  }
  if (typeof setAdminDispatch === 'function') {
    app.post('/api/v1/admin/operations/recharge-dispatch', ...adminWriteGuards, async (req, res) => {
      res.json(await setAdminDispatch({ ...(req.body || {}), actorId: req.admin?.id || 'admin' }));
    });
  }
  if (typeof setAdminBrowserPaymentWrites === 'function') {
    app.post('/api/v1/admin/operations/browser-payment', ...adminWriteGuards, async (req, res) => {
      if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'invalid_operation_state' });
      res.json(await setAdminBrowserPaymentWrites({ enabled: req.body.enabled, actorId: req.admin?.id || 'admin' }));
    });
  }
  // 「自动开卡总开关」端点已删（D-309，Lemon 2026-09-20 定不做这个控件）。
  // 它一次写两个键（card_auto_replenishment_enabled + card_balance_recharge_enabled），
  // 而补余额已弃用（D-218）、生产刻意把两键设成不同值 —— 调一次就会被抹平。
  // 停自动开卡有两条更对的路：设置页把水位设成 0（按台按产品）；
  // 或 `node v1/scripts/set-supply-scheduler-flag.mjs off --apply`（只写单键、带预览与审计）。
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
  if (typeof confirmManualCancellation === 'function') {
    // 运营亲自在账号里关闭自动续费后，记录事实并收口（付款已成功、取消续费待人工的单）。
    app.post('/api/v1/admin/orders/:publicNo/cancellation-confirmed', ...sensitiveAdminGuards, async (req, res) => {
      try {
        res.json(await confirmManualCancellation(req.params.publicNo, { ...req.body, actorId: req.admin?.id || 'admin' }));
      } catch (error) {
        if (error?.name === 'ManualCancellationError') {
          return res.status(error.status).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof resolveUnknownSubmission === 'function') {
    // 第④步（面三③ 表二）：API 单付款不明、两路证据定不了之后的人工收口入口（CHARGED / NOT_CHARGED）。
    app.post('/api/v1/admin/orders/:publicNo/resolve-unknown-submission', ...sensitiveAdminGuards, async (req, res) => {
      try {
        res.json(await resolveUnknownSubmission(req.params.publicNo, { ...(req.body || {}), actorId: req.admin?.id || 'admin' }));
      } catch (error) {
        if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
  }
  if (typeof listCardRetirementCandidates === 'function') {
    // 第④步（面二⑩）：待销清单（派生查询，不建表）。due = 到了最短存活期该去卡台删的；notYetDue = 口径成立但时间未到。
    app.get('/api/v1/admin/card-retirement/candidates', noStore, requireAdminApi, async (req, res) => {
      res.json(await listCardRetirementCandidates(req.query || {}));
    });
  }
  if (typeof getFailureStats === 'function') {
    // D-393：诊断页「失败原因统计」。只读；from/to 与订单页同一写法（UTC+8 当日起止的 ISO 时间）。
    app.get('/api/v1/admin/failure-stats', noStore, requireAdminApi, async (req, res) => {
      res.json(await getFailureStats(req.query || {}));
    });
  }
  if (typeof runDailyReconciliation === 'function') {
    // 第⑤步（面四③）：日对账报告。只读——端点这一路不写「连续两次」的指纹，
    // 那个只由 pojia-daily-reconciliation.timer 每天写一次，免得后台刷新一下就把判断搅了。
    app.get('/api/v1/admin/reconciliation/daily', noStore, requireAdminApi, async (req, res) => {
      res.json(await runDailyReconciliation());
    });
  }
  if (typeof confirmCardRetired === 'function') {
    // Lemon 在卡台删完后登记。
    //
    // D-301：确认词不留。它挡不住误点——手打一次就会被复制粘贴，真正的闸门是
    // ① 只有到期的卡才亮按钮、② 有活动分配的卡后端直接拒、③ 现在有了撤销路径
    // （POST /card-retirement/undo）。last4 仍然校验，那是**定位**这张卡用的，不是闸门。
    app.post('/api/v1/admin/card-retirement/confirm', ...sensitiveAdminGuards, async (req, res) => {
      const body = req.body || {};
      const last4 = String(body.last4 || '').trim();
      if (!/^\d{4}$/.test(last4)) {
        return res.status(400).json({ error: 'card_retirement_last4_required' });
      }
      try {
        res.json(await confirmCardRetired({ cardId: body.cardId, providerAccountId: body.providerAccountId,
          externalCardId: body.externalCardId, note: body.note, actorId: req.admin?.id || 'admin', source: 'admin' }));
      } catch (error) {
        if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
  }
  if (typeof undoCardRetired === 'function') {
    // 撤销退役登记（B3 的前置：去掉确认词之前必须先有回头路）。必填理由，进审计。
    app.post('/api/v1/admin/card-retirement/undo', ...sensitiveAdminGuards, async (req, res) => {
      const body = req.body || {};
      try {
        res.json(await undoCardRetired({ cardId: body.cardId, providerAccountId: body.providerAccountId,
          externalCardId: body.externalCardId, reason: body.reason, actorId: req.admin?.id || 'admin' }));
      } catch (error) {
        if (error instanceof PublicApiError) return res.status(error.status || 400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
  }
  if (typeof createAdminCdkBatch === 'function') {
    app.post('/api/v1/admin/cdks/generate', ...adminWriteGuards, async (req, res) => {
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
  // 注意顺序：这两条静态路径必须排在 /cdks/:batchNo/... 之前，
  // 否则 Express 会把 "codes"、"liability" 当成 :batchNo 匹配进去。
  if (typeof listAdminCdkCodes === 'function') {
    app.post('/api/v1/admin/cdks/search', noStore, requireAdminApi, requireAdminOrigin, async (req, res) => {
      try { return res.json(await listAdminCdkCodes(req.body)); }
      catch (error) {
        if (error instanceof CdkBatchError) return res.status(400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
    // D-279 ④：以单码为主的列表（Lemon 选 A：直接给明文码，后台仅他一人使用）。
    app.get('/api/v1/admin/cdks/codes', noStore, requireAdminApi, async (req, res) => {
      try {
        return res.json(await listAdminCdkCodes(req.query));
      } catch (error) {
        if (error instanceof CdkBatchError) return res.status(400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
  }
  if (typeof summarizeAdminCdkLiability === 'function') {
    // D-286 ①：欠客户多少次交付（已发出未兑）vs 还能卖多少（未发出）。
    app.get('/api/v1/admin/cdks/liability', noStore, requireAdminApi, async (_req, res) => {
      res.json(await summarizeAdminCdkLiability());
    });
  }
  if (typeof revokeAdminCdkCode === 'function') {
    // D-279 ⑤：作废单张码。服务层只允许作废 AVAILABLE 的码。
    app.post('/api/v1/admin/cdks/codes/:cdkId/revoke', ...adminWriteGuards, async (req, res) => {
      try {
        return res.json(await revokeAdminCdkCode(req.params.cdkId, { reason: req.body?.reason }));
      } catch (error) {
        if (error instanceof CdkBatchError) return res.status(400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
  }
  if (typeof markAdminCdkIssued === 'function') {
    // D-286 ①：标记/撤销「已发给客户」。与 status 正交，不影响能否兑换。
    app.post('/api/v1/admin/cdks/codes/:cdkId/issued', ...adminWriteGuards, async (req, res) => {
      try {
        return res.json(await markAdminCdkIssued(req.params.cdkId, {
          note: req.body?.note, issued: req.body?.issued !== false
        }));
      } catch (error) {
        if (error instanceof CdkBatchError) return res.status(400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
  }
  if (typeof listAdminCdkBatchOptions === 'function') {
    app.get('/api/v1/admin/cdks/batch-options', noStore, requireAdminApi, async (req, res) => {
      try { res.json(await listAdminCdkBatchOptions(req.query)); }
      catch (error) {
        if (error instanceof CdkBatchError) return res.status(400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
  }
  if (typeof updateAdminCdkCodes === 'function') {
    app.post('/api/v1/admin/cdks/bulk', ...adminWriteGuards, async (req, res) => {
      try { res.json(await updateAdminCdkCodes(req.body)); }
      catch (error) {
        if (error instanceof CdkBatchError) return res.status(400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
  }
  if (typeof updateAdminCdkBatchMetadata === 'function') {
    app.post('/api/v1/admin/cdks/:batchNo/metadata', ...adminWriteGuards, async (req, res) => {
      try { res.json(await updateAdminCdkBatchMetadata(req.params.batchNo, req.body)); }
      catch (error) {
        if (error instanceof CdkBatchError) return res.status(400).json({ error: error.code.toLowerCase() });
        throw error;
      }
    });
  }
  if (typeof downloadAdminCdkBatch === 'function') {
    app.post('/api/v1/admin/cdks/:batchNo/download', ...adminWriteGuards, async (req, res) => {
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
    app.post('/api/v1/admin/cdks/:batchNo/status-report', ...adminWriteGuards, async (req, res) => {
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
    app.post('/api/v1/admin/cdks/:batchNo/revoke', ...adminWriteGuards, async (req, res) => {
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
          return res.status(error.code === 'CASE_NOT_FOUND' ? 404 : error.code === 'CASE_REQUIRES_ORDER_RESOLUTION' ? 409 : 400)
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
    // Unexpected errors used to vanish: log route + error identity only (never bodies).
    console.error('web request failed', {
      method: _req.method, path: _req.path, name: error?.name, code: error?.code,
      errno: error?.errno, message: String(error?.message || '').slice(0, 300)
    });
    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
