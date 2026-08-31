import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '../../deploy/server');

test('card funding unit exposes only the narrow card-write capability behind a separate off-by-default gate', async () => {
  const service = await readFile(resolve(serverDir, 'pojia-card-funding.service'), 'utf8');
  assert.match(service, /Environment=CARD_FUNDING_EXECUTION_ENABLED=false/);
  assert.match(service, /PROVIDER_WRITES_ENABLED=false/);
  assert.match(service, /PROVIDER_RECHARGE_WRITES_ENABLED=false/);
  assert.match(service, /PROVIDER_CARD_WRITES_ENABLED=true/);
  assert.match(service, /scripts\/card-funding-runner\.js/);
});

test('card funding reconciliation unit is read-only and cannot inherit provider writes', async () => {
  const service = await readFile(resolve(serverDir, 'pojia-card-funding-reconcile.service'), 'utf8');
  for (const name of [
    'PROVIDER_WRITES_ENABLED',
    'PROVIDER_RECHARGE_WRITES_ENABLED',
    'PROVIDER_CARD_WRITES_ENABLED'
  ]) {
    assert.match(service, new RegExp(`${name}=false`));
  }
  assert.match(service, /scripts\/card-funding-reconcile-runner\.js/);
});

test('funding timers provide fast order pickup without calling the provider while idle', async () => {
  const fundingTimer = await readFile(resolve(serverDir, 'pojia-card-funding.timer'), 'utf8');
  const reconcileTimer = await readFile(resolve(serverDir, 'pojia-card-funding-reconcile.timer'), 'utf8');
  assert.match(fundingTimer, /OnUnitActiveSec=5s/);
  assert.match(reconcileTimer, /OnUnitActiveSec=15s/);
});
