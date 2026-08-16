import express from 'express';
import helmet from 'helmet';

const DEFAULT_BODY_LIMIT = '256kb';

export function createApp({ readiness = async () => ({ ready: true }) } = {}) {
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

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((error, _req, res, _next) => {
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
