import express from 'express';
import helmet from 'helmet';
import { OrderIntakeError } from '../domain/order-intake-error.js';
import { createFixedWindowRateLimit } from './fixed-window-rate-limit.js';

const DEFAULT_BODY_LIMIT = '256kb';

export function createApp({
  readiness = async () => ({ ready: true }),
  createCustomerOrder = null,
  orderRateLimit = createFixedWindowRateLimit()
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

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof OrderIntakeError) {
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
