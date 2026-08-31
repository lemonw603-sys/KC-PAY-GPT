import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dropIn = fs.readFileSync(path.join(
  here, '../../deploy/server/pojia-worker-api-recharge-enabled.conf.example'
), 'utf8');

test('API recharge enablement grants only the narrow worker capability', () => {
  assert.match(dropIn, /^ExecStart=\s*$/m);
  assert.match(dropIn, /PROVIDER_RECHARGE_WRITES_ENABLED=true/);
  assert.match(dropIn, /PROVIDER_WRITES_ENABLED=false/);
  assert.match(dropIn, /PROVIDER_CARD_WRITES_ENABLED=false/);
  assert.doesNotMatch(dropIn, /BROWSER_PAYMENT_WRITES_ENABLED=true/);
});
