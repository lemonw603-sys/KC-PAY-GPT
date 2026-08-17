import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public'
);

test('customer assets contain no remote or legacy runtime dependencies', () => {
  const files = [
    path.join(directory, 'index.html'),
    path.join(directory, 'assets', 'customer.css'),
    path.join(directory, 'assets', 'customer.js'),
    path.join(directory, 'assets', 'favicon.svg')
  ];
  const forbidden = [
    'src="http://',
    'src="https://',
    'href="http://',
    'href="https://',
    'url(http://',
    'url(https://',
    "fetch('http://",
    "fetch('https://",
    'playwright',
    'puppeteer',
    'stripe',
    'hcaptcha',
    '/api/verify-cdk',
    '/pay'
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${file} contains ${token}`);
    }
  }
});

test('admin assets contain no remote, legacy, or secret-bearing dependencies', () => {
  const files = [
    path.join(directory, 'admin', 'index.html'),
    path.join(directory, 'admin', 'login.html'),
    path.join(directory, 'admin', 'assets', 'admin.css'),
    path.join(directory, 'admin', 'assets', 'admin.js'),
    path.join(directory, 'admin', 'assets', 'login.js')
  ];
  const forbidden = [
    'src="http://', 'src="https://', 'href="http://', 'href="https://',
    'url(http://', 'url(https://', 'playwright', 'stripe', 'hcaptcha',
    'session_ciphertext', 'recharge_card_key', 'api key', 'cvv'
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${file} contains ${token}`);
    }
  }
});
