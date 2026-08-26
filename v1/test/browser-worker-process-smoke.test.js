import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const child = path.resolve(here, '../test-support/browser-worker-process-child.js');

function start(env = {}) {
  const proc = spawn(process.execPath, [child], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
  return { proc, output: () => output };
}

function waitFor(proc, read, marker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${marker}: ${read()}`)), 2000);
    const check = () => {
      if (read().includes(marker)) { clearTimeout(timer); resolve(); }
    };
    proc.stdout.on('data', check);
    proc.once('error', (error) => { clearTimeout(timer); reject(error); });
    proc.once('exit', (code) => {
      if (!read().includes(marker)) { clearTimeout(timer); reject(new Error(`child exited ${code}`)); }
    });
    check();
  });
}

function waitExit(proc) {
  return new Promise((resolve) => proc.once('exit', (code, signal) => resolve({ code, signal })));
}

test('isolated Browser worker child starts and stops cleanly on SIGTERM', async () => {
  const instance = start({ BROWSER_TEST_WORKER_ID: 'smoke-term' });
  await waitFor(instance.proc, instance.output, 'READY');
  instance.proc.kill('SIGTERM');
  const result = await waitExit(instance.proc);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.match(instance.output(), /STOPPED/);
});

test('isolated Browser worker child can be restarted after a crash', async () => {
  const crashed = start({ BROWSER_TEST_WORKER_ID: 'smoke-crash', BROWSER_TEST_CRASH: '1' });
  await waitFor(crashed.proc, crashed.output, 'READY');
  const crashResult = await waitExit(crashed.proc);
  assert.equal(crashResult.code, 42);

  const restarted = start({ BROWSER_TEST_WORKER_ID: 'smoke-restart' });
  await waitFor(restarted.proc, restarted.output, 'READY');
  restarted.proc.kill('SIGTERM');
  const restartResult = await waitExit(restarted.proc);
  assert.equal(restartResult.code, 0);
});
