import { CookieSessionBootstrapAdapter } from './session-bootstrap.js';
import { ExtensionSessionBootstrapAdapter } from './extension-session-bootstrap.js';

export function sessionProviderClass(raw = 'COOKIE') {
  const mode = String(raw || 'COOKIE').trim().toUpperCase();
  if (mode === 'COOKIE') return CookieSessionBootstrapAdapter;
  if (mode === 'EXTENSION') return ExtensionSessionBootstrapAdapter;
  throw new TypeError('BROWSER_SESSION_PROVIDER must be COOKIE or EXTENSION');
}
