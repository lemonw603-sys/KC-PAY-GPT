import { redactSensitiveText } from '../security/redaction.js';

export class BarkDeliveryError extends Error {
  constructor(message, { retryable = true, status = null } = {}) {
    super(message);
    this.name = 'BarkDeliveryError';
    this.retryable = retryable;
    this.status = status;
  }
}

function barkLevel(severity) {
  if (String(severity).toLowerCase() === 'critical') return 'critical';
  if (String(severity).toLowerCase() === 'warning') return 'timeSensitive';
  return 'active';
}

export function createBarkClient({
  serverUrl,
  deviceKey,
  group = 'AI充值业务',
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  if (!deviceKey) throw new Error('Bark device key is required');
  const endpoint = `${String(serverUrl).replace(/\/+$/, '')}/push`;

  return {
    async send({ title, message, severity = 'warning', url = null }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_key: deviceKey,
            title: redactSensitiveText(title).slice(0, 200),
            body: redactSensitiveText(message).slice(0, 1_000),
            group,
            level: barkLevel(severity),
            ...(url ? { url } : {})
          }),
          signal: controller.signal
        });
      } catch (error) {
        throw new BarkDeliveryError(
          controller.signal.aborted ? 'Bark request timed out' : 'Bark request failed',
          { retryable: true }
        );
      } finally {
        clearTimeout(timer);
      }

      let result = null;
      try {
        result = await response.json();
      } catch {
        // The HTTP status remains authoritative when a Bark-compatible server returns no JSON.
      }
      const accepted = response.ok && (result?.code == null || Number(result.code) === 200);
      if (!accepted) {
        const status = Number(response.status) || null;
        throw new BarkDeliveryError(`Bark rejected notification (HTTP ${status ?? 'unknown'})`, {
          status,
          retryable: status == null || status === 408 || status === 429 || status >= 500
        });
      }
      return { delivered: true, status: response.status };
    }
  };
}
