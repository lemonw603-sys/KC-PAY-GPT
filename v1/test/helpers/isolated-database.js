import assert from 'node:assert/strict';

/**
 * 真数据库测试只许连本机的隔离库（会建表、写数、清数），绝不能碰到生产。
 * 原先每个文件各写死一个库名（'/step6_jfix'、'/step6_cdk_test'），换一个隔离库就跑不起来（D-394 ③）。
 * 规则本意不变：本机 + 隔离前缀（step6_ 为第⑥块起的旧库名，pojia_it_ 为 scripts/mysql-tests.sh 自动建的库）。
 */
export function assertIsolatedTestDatabase(url) {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), `isolated test database must be local, got ${target.hostname}`);
  assert.match(target.pathname, /^\/(step6_|pojia_it_)[A-Za-z0-9_]+$/, `isolated test database name must start with step6_ or pojia_it_, got ${target.pathname}`);
}
