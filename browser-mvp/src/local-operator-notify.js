/**
 * Immediate, local-only operator alert for the one moment a person must act:
 * a human-verification challenge on the checkout page (D-154). It uses the
 * operator's own macOS notification centre — nothing leaves the machine, and no
 * order, card, session or account detail is ever put in the text.
 */
import { execFile } from 'node:child_process';

const escapeAppleScript = (value) => String(value).replace(/["\\]/g, '\\$&').slice(0, 180);

export function createLocalOperatorNotifier({
  enabled = process.platform === 'darwin',
  log = (line) => process.stdout.write(`${line}\n`),
  run = execFile,
} = {}) {
  return async function notifyOperator({ title, message } = {}) {
    const safeTitle = escapeAppleScript(title || '需要人工');
    const safeMessage = escapeAppleScript(message || '');
    log(`[operator] ${safeTitle} — ${safeMessage}`);
    if (!enabled) return { delivered: false, reason: 'DISABLED' };
    return new Promise((resolve) => {
      run('osascript', ['-e',
        `display notification "${safeMessage}" with title "${safeTitle}" sound name "Glass"`,
      ], { timeout: 5_000 }, (error) => resolve(
        error ? { delivered: false, reason: 'OSASCRIPT_FAILED' } : { delivered: true },
      ));
    });
  };
}
