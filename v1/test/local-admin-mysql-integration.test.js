// 「演示精简版」本机后台（scripts/local-admin.sh，RUNBOOK §2.8）的真库测试。
// 跑法：v1/scripts/mysql-tests.sh test/local-admin-mysql-integration.test.js
// 覆盖：up 造数后关键表非空且个数等于快照、形状比对全过、邮箱全是假域名、口令不出现在输出里、
//       密钥目录 700 / 文件 600、重复 up 结果一样；down 只删自己的库，别的库（含前缀不对的）一个不动。
// 用的库名是随机的 pojia_local_admin_it<hex>，密钥目录是临时目录 —— 不碰本机正在用的 pojia_local_admin。
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', '..', 'scripts', 'local-admin.sh');
const shape = JSON.parse(readFileSync(path.resolve(here, '..', 'scripts', 'local-admin', 'shape.json'), 'utf8'));
const url = process.env.TEST_DATABASE_URL;

const sum = (rows) => (rows || []).reduce((n, row) => n + Number(row.count || 0), 0);

function run(args, env) {
  return new Promise((resolve) => {
    execFile('bash', [script, ...args], { env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024, timeout: 600_000 },
      (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }));
  });
}

test('shape.json 只有聚合：没有邮箱、订单号、卡号、token 形状的内容', () => {
  const text = readFileSync(path.resolve(here, '..', 'scripts', 'local-admin', 'shape.json'), 'utf8');
  assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, '不应含邮箱');
  assert.doesNotMatch(text, /PJV1-/, '不应含订单号');
  assert.doesNotMatch(text, /\b\d{12,19}\b/, '不应含卡号形状的数字');
  assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}/, '不应含 JWT');
  assert.doesNotMatch(text, /\b(PLUS|20X|5X)-[A-Z0-9]{5}-/, '不应含卡密');
  assert.ok(sum(shape.orders) > 0 && sum(shape.cards) > 0, '快照应有订单与卡');
});

test('local-admin.sh up 造数与快照一致、重复 up 幂等；down 只删自己的库', {
  skip: !url && 'requires TEST_DATABASE_URL (run via v1/scripts/mysql-tests.sh)', timeout: 900_000
}, async () => {
  const parsed = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname), 'only a local test database');
  const port = parsed.port;
  const suffix = randomBytes(3).toString('hex');
  const db = `pojia_local_admin_it${suffix}`;
  const sentinel = `pojia_it_keep_${suffix}`;
  const home = mkdtempSync(path.join(tmpdir(), 'local-admin-it-'));
  const env = { LOCAL_ADMIN_DB: db, LOCAL_ADMIN_HOME: path.join(home, 'state'), MYSQL_TEST_PORT: port, LOCAL_ADMIN_PORT: '18810' };
  const root = await mysql.createConnection({ host: '127.0.0.1', port: Number(port), user: 'root', password: 'root' });
  const exists = async (name) => (await root.query('SHOW DATABASES LIKE ?', [name]))[0].length === 1;
  const counts = async () => {
    const out = {};
    for (const table of ['orders', 'cards', 'cdks', 'cdk_batches', 'operator_alerts', 'card_consumption_ledger', 'card_transactions']) {
      out[table] = Number((await root.query(`SELECT COUNT(*) AS n FROM \`${db}\`.\`${table}\``))[0][0].n);
    }
    return out;
  };
  try {
    await root.query(`CREATE DATABASE \`${sentinel}\``);

    const first = await run(['up'], env);
    assert.equal(first.code, 0, `up failed:\n${first.stdout}\n${first.stderr}`);
    assert.match(first.stdout, /形状比对：全部一致/);
    const password = readFileSync(path.join(env.LOCAL_ADMIN_HOME, 'admin-password.txt'), 'utf8').trim();
    assert.ok(password.length >= 12);
    assert.ok(!first.stdout.includes(password) && !first.stderr.includes(password), '口令不能出现在输出里');
    assert.equal(statSync(env.LOCAL_ADMIN_HOME).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(env.LOCAL_ADMIN_HOME, 'local-admin.env')).mode & 0o777, 0o600);
    assert.equal(statSync(path.join(env.LOCAL_ADMIN_HOME, 'admin-password.txt')).mode & 0o777, 0o600);

    const expected = {
      orders: sum(shape.orders), cards: sum(shape.cards), cdks: sum(shape.cdks), cdk_batches: sum(shape.cdkBatches),
      operator_alerts: sum(shape.alerts), card_consumption_ledger: sum(shape.ledger), card_transactions: sum(shape.cardTransactions)
    };
    const afterFirst = await counts();
    for (const [table, n] of Object.entries(expected)) {
      assert.ok(n > 0, `快照里 ${table} 应非空`);
      assert.equal(afterFirst[table], n, `${table} 行数应等于快照`);
    }
    const [emails] = await root.query(`SELECT COUNT(*) AS total, SUM(customer_email LIKE '%@demo.invalid') AS fake FROM \`${db}\`.orders`);
    assert.equal(Number(emails[0].fake), Number(emails[0].total), '订单邮箱全部是假域名');

    const second = await run(['up'], env);
    assert.equal(second.code, 0, `second up failed:\n${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /形状比对：全部一致/);
    assert.deepEqual(await counts(), afterFirst, '重复 up 结果一样');
    assert.equal(readFileSync(path.join(env.LOCAL_ADMIN_HOME, 'admin-password.txt'), 'utf8').trim(), password, '重复 up 复用口令');

    // 前缀不对的库名：脚本直接拒绝，什么都不删
    const refused = await run(['down'], { ...env, LOCAL_ADMIN_DB: sentinel });
    assert.notEqual(refused.code, 0);
    assert.ok(await exists(sentinel), '前缀不对的库不能被删');

    const down = await run(['down'], env);
    assert.equal(down.code, 0, `down failed:\n${down.stdout}\n${down.stderr}`);
    assert.equal(await exists(db), false, 'down 删掉自己的库');
    assert.ok(await exists(sentinel), 'down 不碰别的库');
    assert.ok(await exists(parsed.pathname.slice(1)), 'down 不碰测试框架给的库');
  } finally {
    await root.query(`DROP DATABASE IF EXISTS \`${db}\``);
    await root.query(`DROP DATABASE IF EXISTS \`${sentinel}\``);
    await root.end();
    rmSync(home, { recursive: true, force: true });
  }
});
