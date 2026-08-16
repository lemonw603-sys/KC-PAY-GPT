import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const forbidden = [
  'playwright',
  'puppeteer',
  'stripe-payment',
  'browser-pool',
  'hcaptcha',
  'captcha-platform',
  'proxy-pool'
];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : (entry.name.endsWith('.js') ? [target] : []);
  });
}

test('v1 source graph does not import legacy automation modules', () => {
  for (const file of sourceFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const token of forbidden) {
      assert.equal(source.includes(`from '${token}`), false, `${file} imports ${token}`);
      assert.equal(source.includes(`from "${token}`), false, `${file} imports ${token}`);
      assert.equal(source.includes(`require('${token}`), false, `${file} requires ${token}`);
      assert.equal(source.includes(`require("${token}`), false, `${file} requires ${token}`);
    }
    assert.equal(source.includes("from '../../server.js'"), false, `${file} imports legacy server`);
  }
});
