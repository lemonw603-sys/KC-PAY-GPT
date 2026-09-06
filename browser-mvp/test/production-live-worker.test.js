import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProductionLiveArgs } from '../src/production-live-worker.js';

test('production LIVE entrypoint requires one explicit safe mode', () => {
  assert.deepEqual(parseProductionLiveArgs(['--check']), { checkOnly: true });
  assert.deepEqual(parseProductionLiveArgs(['--once']), { checkOnly: false });
  assert.throws(() => parseProductionLiveArgs([]));
  assert.throws(() => parseProductionLiveArgs(['--check', '--once']));
  assert.throws(() => parseProductionLiveArgs(['--loop']));
});
