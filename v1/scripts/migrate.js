import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(here, '..', 'migrations', '001_initial.sql');
const sql = await fs.readFile(migrationPath, 'utf8');
const connection = await mysql.createConnection({
  uri: config.databaseUrl,
  multipleStatements: true,
  timezone: 'Z'
});

try {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [rows] = await connection.query(
    'SELECT version FROM schema_migrations WHERE version = ?',
    ['001_initial']
  );
  if (rows.length > 0) {
    console.log('migration 001_initial already applied');
    process.exitCode = 0;
  } else {
    await connection.query(sql);
    await connection.query(
      `INSERT IGNORE INTO schema_migrations (version) VALUES (?)`,
      ['001_initial']
    );
    console.log('applied migration 001_initial');
  }
} finally {
  await connection.end();
}
