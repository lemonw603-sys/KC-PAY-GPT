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
    'session_ciphertext', 'recharge_card_key', 'card_credentials_ciphertext', 'api key', 'cvv',
    'style="'
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${file} contains ${token}`);
    }
  }
});

test('admin batch generation keeps generation and downloads separate and exposes audit history', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  assert.match(html, />生成 CDK</);
  assert.match(html, /下载本批次 TXT/);
  assert.match(script, /下载原始 TXT/);
  assert.match(script, /下载状态清单 CSV/);
  assert.match(script, /已全部作废/);
  assert.match(script, /禁止把文件中的码重新发放/);
  assert.match(script, /已生成，但列表刷新失败/);
  assert.match(script, /已作废.*但批次列表刷新失败/);
});

test('admin refresh feedback and inset dropdown arrows remain visible', () => {
  const html = fs.readFileSync(path.join(directory, 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.js'), 'utf8');
  const styles = fs.readFileSync(path.join(directory, 'admin', 'assets', 'admin.css'), 'utf8');
  assert.match(html, /admin\.css\?v=13/);
  assert.match(script, /button\.textContent = '刷新中…'/);
  assert.match(script, /showNotice\('刷新完成。', 'success'\)/);
  assert.match(script, /showNotice\('刷新失败，请稍后重试。'\)/);
  assert.match(styles, /select\s*\{[\s\S]*appearance:\s*none/);
  assert.match(styles, /padding-right:\s*40px\s*!important/);
  assert.match(styles, /background-image:[^;]+!important/);
  assert.match(styles, /background-position:\s*calc\(100% - 19px\) 50%, calc\(100% - 14px\) 50%\s*!important/);
});
