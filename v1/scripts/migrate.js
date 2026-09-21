import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { loadMigrationConfig } from '../src/config.js';
import { createDatabaseConnectionOptions } from '../src/db/pool.js';
import { preflightStep6Migrations, applyStep6Migration } from '../src/db/step6-migration-guard.js';

const config = loadMigrationConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(here, '..', 'migrations');
const connection = await mysql.createConnection(createDatabaseConnectionOptions(config.database, {
  multipleStatements: true,
  timezone: 'Z'
}));

let lockName;
try {
  const [[{ db }]] = await connection.query('SELECT DATABASE() AS db');
  if (!db) throw Object.assign(new Error('MIGRATION_DATABASE_REQUIRED'), { code: 'MIGRATION_DATABASE_REQUIRED' });
  lockName = `pojia-migrate:${createHash('sha256').update(db).digest('hex').slice(0, 32)}`;
  const [[{ acquired }]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
  if (Number(acquired) !== 1) throw Object.assign(new Error('MIGRATION_ALREADY_RUNNING'), { code: 'MIGRATION_ALREADY_RUNNING' });
  const files = (await fs.readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  const sources = await Promise.all(files.map(async file => ({ file, sql: await fs.readFile(path.join(migrationsDirectory, file), 'utf8') })));
  const [[{ present }]] = await connection.query("SELECT COUNT(*) present FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'");
  const [recorded] = Number(present) ? await connection.query('SELECT version FROM schema_migrations') : [[]];
  const applied = new Set(recorded.map(row => row.version));
  // Read-only checks for the ENTIRE 055–057 batch precede every DDL, including metadata setup.
  const recoveryPlans = await preflightStep6Migrations(connection, sources, applied);
  if (!Number(present)) await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  for (const { file, sql } of sources) {
    const version = file.replace(/\.sql$/i, '');
    const [rows] = await connection.query(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [version]
    );
    if (rows.length > 0) {
      console.log(`migration ${version} already applied`);
      continue;
    }
    if (recoveryPlans.has(file)) await applyStep6Migration(connection, recoveryPlans.get(file));
    else await connection.query(sql);
    await connection.query(
      `INSERT INTO schema_migrations (version) VALUES (?)`,
      [version]
    );
    console.log(`applied migration ${version}`);
  }
} finally {
  if (lockName) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
  await connection.end();
}
