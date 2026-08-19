#!/usr/bin/env bash
set -euo pipefail

source_dir=${1:-/opt/pojia/current/v1}
test_suffix="$$"
test_database="pojia_test_${test_suffix}"
test_user="pojia_test_${test_suffix}"
test_password="$(openssl rand -hex 24)"
mysql_container=pojia-mysql
mysql_gateway=%

cleanup() {
  docker exec -i "${mysql_container}" sh -c \
    'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" mysql -uroot' <<SQL >/dev/null 2>&1 || true
DROP DATABASE IF EXISTS ${test_database};
DROP USER IF EXISTS '${test_user}'@'${mysql_gateway}';
SQL
}
trap cleanup EXIT

docker exec -i "${mysql_container}" sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" mysql -uroot' <<SQL
CREATE DATABASE ${test_database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER '${test_user}'@'${mysql_gateway}' IDENTIFIED BY '${test_password}';
GRANT ALL PRIVILEGES ON ${test_database}.* TO '${test_user}'@'${mysql_gateway}';
FLUSH PRIVILEGES;
SQL

test_url="mysql://${test_user}:${test_password}@127.0.0.1:3306/${test_database}"
(
  cd "${source_dir}"
  TEST_DATABASE_URL="${test_url}" node --input-type=module - <<'NODE'
import mysql from 'mysql2/promise';
const pool = mysql.createPool(process.env.TEST_DATABASE_URL);
await pool.query('SELECT 1');
await pool.end();
console.log('temporary_database_auth=OK');
NODE
  NODE_ENV=test DATABASE_URL="${test_url}" MIGRATION_DATABASE_URL="${test_url}" node scripts/migrate.js
  TEST_DATABASE_URL="${test_url}" npm test
)
