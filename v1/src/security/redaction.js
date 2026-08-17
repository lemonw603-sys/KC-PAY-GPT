const SENSITIVE_KEY = /(?:api.?key|authorization|password|secret|token|session|cvv|cvc|card.?number|card.?no|pan)/i;

function redactText(value) {
  return String(value)
    .replace(/nhs_[A-Za-z0-9._-]+/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/\b\d{12,19}\b/g, (match) => `****${match.slice(-4)}`)
    .slice(0, 1_000);
}

export function redactSensitiveFields(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactSensitiveFields(item));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 200).map(([childKey, child]) => [
        childKey,
        redactSensitiveFields(child, childKey)
      ])
    );
  }
  return String(value).slice(0, 1_000);
}
