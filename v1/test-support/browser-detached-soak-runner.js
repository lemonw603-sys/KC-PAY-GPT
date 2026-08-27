#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDir = path.resolve('artifacts/browser-soak');
mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `24h-${runId}.log`);
const metadataPath = path.join(outputDir, `24h-${runId}.json`);
const fd = openSync(outputPath, 'a', 0o600);
const child = spawn(process.execPath, [
  'v1/test-support/browser-mysql-bounded-soak.js',
  '--duration-ms=86400000', '--jobs=1', '--workers=2',
  '--delay-ms=240000', '--lease-seconds=600'
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    TEST_DATABASE_URL: databaseUrl,
    BROWSER_SOAK_METADATA_PATH: metadataPath
  },
  detached: true,
  stdio: ['ignore', fd, fd]
});
writeFileSync(metadataPath, `${JSON.stringify({
  runId, pid: child.pid, status: 'RUNNING', startedAt: new Date().toISOString(),
  durationMs: 86400000, targetRate: 'approximately 360 synthetic jobs/day',
  outputPath
}, null, 2)}\n`, { mode: 0o600 });
child.unref();
console.log(JSON.stringify({ runId, pid: child.pid, metadataPath, outputPath }, null, 2));
