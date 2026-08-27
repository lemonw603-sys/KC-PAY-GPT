import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

test('dedicated Browser systemd service is independent and forces all writes off', async () => {
  const service = await readFile(resolve(here, '../../deploy/server/pojia-browser-worker.service'), 'utf8');
  assert.match(service, /production-readonly-worker\.js --check/);
  assert.match(service, /production-readonly-worker\.js\n/);
  assert.doesNotMatch(service, /src\/worker\.js/);
  assert.doesNotMatch(service, /provider\.env/);
  assert.match(service, /StateDirectory=pojia-browser-worker/);
  assert.match(service, /Environment=HOME=\/var\/lib\/pojia-browser-worker/);
  for (const name of [
    'BROWSER_PAYMENT_WRITES_ENABLED', 'PROVIDER_WRITES_ENABLED',
    'PROVIDER_CARD_WRITES_ENABLED', 'PROVIDER_RECHARGE_WRITES_ENABLED',
    'CARD_FUNDING_WRITES_ENABLED',
  ]) {
    assert.match(service, new RegExp(`Environment=${name}=false`));
  }
});
