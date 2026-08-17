import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadMigrationConfig } from '../src/config.js';
import { createDatabaseConnectionOptions } from '../src/db/pool.js';

const config = loadMigrationConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(here, '..', 'migrations');
const connection = await mysql.createConnection(createDatabaseConnectionOptions(config.database, {
  multipleStatements: true,
  timezone: 'Z'
}));

try {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const files = (await fs.readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/i, '');
    const [rows] = await connection.query(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [version]
    );
    if (rows.length > 0) {
      console.log(`migration ${version} already applied`);
      continue;
    }
    const sql = await fs.readFile(path.join(migrationsDirectory, file), 'utf8');
    await connection.query(sql);
    await connection.query(
      `INSERT INTO schema_migrations (version) VALUES (?)`,
      [version]
    );
    console.log(`applied migration ${version}`);
  }
} finally {
  await connection.end();
}
