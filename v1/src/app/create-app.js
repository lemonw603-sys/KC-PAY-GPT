import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicApiError } from '../domain/public-api-error.js';
import { CdkBatchError } from '../services/cdk-service.js';
import { RechargePermitError } from '../services/recharge-permit-service.js';
import { createFixedWindowRateLimit } from './fixed-window-rate-limit.js';

const DEFAULT_BODY_LIMIT = '256kb';
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
  adminAuth = null,
  getAdminOverview = null,
  listAdminOrders = null,
  getAdminOrder = null,
  listAdminAlerts = null,
  requestCardTransactionSync = null,
  getAdminCardStock = null,
  setAdminCardStockThreshold = null,
  createAdminCardStockJob = null,
  setAdminOrderAcceptance = null,
  setAdminRechargePermit = null,
  createAdminCdkBatch = null,
  revokeAdminCdkBatch = null,
  orderRateLimit = createFixedWindowRateLimit(),
  orderStatusRateLimit = createFixedWindowRateLimit({ limit: 30 }),
  adminLoginRateLimit = createFixedWindowRateLimit({ limit: 5, windowMs: 15 * 60 * 1000 })
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: DEFAULT_BODY_LIMIT, strict: true }));

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

  const noStore = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  const requireAdminApi = (req, res, next) => {
    if (!adminAuth?.authenticateRequest(req)) {
      return res.status(401).json({ error: 'admin_auth_required' });
    }
    return next();
  };

  app.get('/admin/login', noStore, (req, res) => {
    if (adminAuth?.authenticateRequest(req)) return res.redirect(302, '/admin');
    return res.sendFile(path.join(publicDirectory, 'admin', 'login.html'));
  });

  app.post('/api/v1/admin/session', noStore, adminLoginRateLimit, async (req, res) => {
    if (!adminAuth) return res.status(503).json({ error: 'admin_not_configured' });
    const password = req.body?.password;
    if (!await adminAuth.verifyPassword(password)) {
      return res.status(401).json({ error: 'invalid_admin_credentials' });
    }
    adminAuth.setSessionCookie(res, adminAuth.issueSession());
    return res.status(204).end();
  });

  app.get('/api/v1/admin/session', noStore, requireAdminApi, (_req, res) => {
    res.json({ authenticated: true });
  });

  app.delete('/api/v1/admin/session', noStore, (req, res) => {
    if (adminAuth) adminAuth.clearSessionCookie(res);
    return res.status(204).end();
  });

  if (typeof getAdminOverview === 'function') {
    app.get('/api/v1/admin/overview', noStore, requireAdminApi, async (_req, res) => {
      res.json(await getAdminOverview());
    });
  }
  if (typeof listAdminOrders === 'function') {
    app.get('/api/v1/admin/orders', noStore, requireAdminApi, async (req, res) => {
      res.json(await listAdminOrders(req.query));
    });
  }
  if (typeof getAdminOrder === 'function') {
    app.get('/api/v1/admin/orders/:publicNo', noStore, requireAdminApi, async (req, res) => {
      res.json(await getAdminOrder(req.params.publicNo));
    });
  }
  if (typeof listAdminAlerts === 'function') {
    app.get('/api/v1/admin/alerts', noStore, requireAdminApi, async (req, res) => {
      res.json(await listAdminAlerts(req.query));
    });
  }
  if (typeof requestCardTransactionSync === 'function') {
    app.post('/api/v1/admin/orders/:publicNo/sync-transactions', noStore, requireAdminApi, async (req, res) => {
      const result = await requestCardTransactionSync(req.params.publicNo);
      return res.status(result.queued ? 202 : 200).json(result);
    });
  }
  if (typeof getAdminCardStock === 'function') {
    app.get('/api/v1/admin/card-stock', noStore, requireAdminApi, async (_req, res) => {
      res.json(await getAdminCardStock());
    });
  }
  if (typeof setAdminCardStockThreshold === 'function') {
    app.post('/api/v1/admin/card-stock/threshold', noStore, requireAdminApi, async (req, res) => {
      res.json(await setAdminCardStockThreshold(req.body?.count));
    });
  }
  if (typeof createAdminCardStockJob === 'function') {
    app.post('/api/v1/admin/card-stock/jobs', noStore, requireAdminApi, async (req, res) => {
      const job = await createAdminCardStockJob(req.body);
      return res.status(202).json({ job });
    });
  }
  if (typeof setAdminOrderAcceptance === 'function') {
    app.post('/api/v1/admin/operations/order-acceptance', noStore, requireAdminApi, async (req, res) => {
      res.json(await setAdminOrderAcceptance(req.body));
    });
  }
  if (typeof setAdminRechargePermit === 'function') {
    app.post('/api/v1/admin/orders/:publicNo/recharge-permit', noStore, requireAdminApi, async (req, res) => {
      try {
        const result = await setAdminRechargePermit(req.params.publicNo, req.body);
        return res.status(req.body?.action === 'arm' ? 202 : 200).json(result);
      } catch (error) {
        if (error instanceof RechargePermitError || [
          'RECHARGE_CONFIRMATION_REQUIRED', 'INVALID_RECHARGE_PERMIT_ACTION'
        ].includes(error?.code)) {
          return res.status(400).json({ error: String(error.code).toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof createAdminCdkBatch === 'function') {
    app.post('/api/v1/admin/cdks/generate', noStore, requireAdminApi, async (req, res) => {
      try {
        const result = await createAdminCdkBatch(req.body);
        return res.status(201).json(result);
      } catch (error) {
        if (error instanceof CdkBatchError) {
          return res.status(400).json({ error: error.code.toLowerCase() });
        }
        throw error;
      }
    });
  }
  if (typeof revokeAdminCdkBatch === 'function') {
    app.post('/api/v1/admin/cdks/:batchNo/revoke', noStore, requireAdminApi, async (req, res) => {
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

  app.get('/admin', noStore, (req, res) => {
    if (!adminAuth?.authenticateRequest(req)) return res.redirect(302, '/admin/login');
    return res.sendFile(path.join(publicDirectory, 'admin', 'index.html'));
  });
  app.use('/admin/assets', express.static(path.join(publicDirectory, 'admin', 'assets'), {
    etag: true,
    maxAge: 0,
    fallthrough: true
  }));

  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDirectory, 'index.html'));
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
