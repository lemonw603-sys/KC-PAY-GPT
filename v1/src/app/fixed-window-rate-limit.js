export function createFixedWindowRateLimit({
  limit = 10,
  windowMs = 60_000,
  now = () => Date.now()
} = {}) {
  const clients = new Map();
  return function fixedWindowRateLimit(req, res, next) {
    const timestamp = now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let state = clients.get(key);
    if (!state || state.resetAt <= timestamp) {
      state = { count: 0, resetAt: timestamp + windowMs };
      clients.set(key, state);
    }
    state.count += 1;
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - state.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(state.resetAt / 1_000)));
    if (state.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((state.resetAt - timestamp) / 1_000))));
      return res.status(429).json({ error: 'rate_limited' });
    }
    return next();
  };
}
