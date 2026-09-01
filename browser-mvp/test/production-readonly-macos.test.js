import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

async function text(path) { return readFile(resolve(root, path), 'utf8'); }

test('macOS headed launcher is fail-closed and tunnel-bound', async () => {
  const script = await text('browser-mvp/scripts/run-macos-headed-worker.sh');
  assert.match(script, /uname -s.*Darwin/);
  assert.match(script, /environment file must have mode 0600/);
  assert.match(script, /BROWSER_CHROME_HEADLESS must be false/);
  assert.match(script, /DATABASE_URL must use the configured local loopback tunnel port/);
  assert.match(script, /ExitOnForwardFailure=yes/);
  assert.match(script, /ServerAliveInterval=15/);
  assert.match(script, /caffeinate -dimsu node[^\n]*production-readonly-worker\.js\" --once/);
  assert.match(script, /production-readonly-worker\.js" --check/);
  assert.match(script, /kill -TERM "\$worker_pid"/);
  assert.doesNotMatch(script, /-R [^\n]*3306/);
  assert.doesNotMatch(script, /0\.0\.0\.0/);
  for (const name of [
    'BROWSER_PAYMENT_WRITES_ENABLED', 'PROVIDER_WRITES_ENABLED',
    'PROVIDER_CARD_WRITES_ENABLED', 'PROVIDER_RECHARGE_WRITES_ENABLED',
    'CARD_FUNDING_WRITES_ENABLED',
  ]) assert.match(script, new RegExp(`\\b${name}\\b`));
  assert.match(script, /\$name must be exactly false/);
});

test('macOS launchd template stays unloaded by default and carries no secrets', async () => {
  const plist = await text('deploy/macos/com.vibebridge.browser-readonly.plist.example');
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<false\/>/);
  assert.match(plist, /run-macos-headed-worker\.sh/);
  assert.match(plist, /BROWSER_LOCAL_ENV_FILE/);
  assert.doesNotMatch(plist, /DATABASE_URL|SESSION_ENCRYPTION_KEY|REPLACE_WITH_32_BYTE_BASE64/);
});

test('macOS env template is headed readonly and keeps every write gate off', async () => {
  const env = await text('deploy/macos/browser-readonly.env.example');
  assert.match(env, /BROWSER_CHROME_HEADLESS=false/);
  assert.match(env, /BROWSER_WORKER_TARGET=EXTERNAL_READONLY/);
  assert.match(env, /BROWSER_READONLY_HARNESS=CHATGPT_ACCOUNT_CHECKOUT/);
  assert.match(env, /DATABASE_URL='mysql:\/\/[^@]+@127\.0\.0\.1:13306\/pojia'/);
  assert.match(env, /BROWSER_DB_TUNNEL_REMOTE_HOST=127\.0\.0\.1/);
  for (const name of [
    'BROWSER_PAYMENT_WRITES_ENABLED', 'PROVIDER_WRITES_ENABLED',
    'PROVIDER_CARD_WRITES_ENABLED', 'PROVIDER_RECHARGE_WRITES_ENABLED',
    'CARD_FUNDING_WRITES_ENABLED', 'BROWSER_PAYMENT_EXECUTOR_ENABLED',
  ]) assert.match(env, new RegExp(`^${name}=false$`, 'm'));
  assert.match(env, /^BROWSER_PAYMENT_EXECUTOR_MODE=MOCK$/m);
  assert.doesNotMatch(env, /CHATGPT_SESSION_COOKIE=|CARD_NUMBER=|CARD_CVC=/);
});
