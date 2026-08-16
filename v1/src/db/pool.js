import mysql from 'mysql2/promise';

export function createDatabasePool(databaseUrl) {
  return mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    decimalNumbers: false,
    timezone: 'Z'
  });
}

export async function checkDatabaseReady(pool) {
  await pool.query('SELECT 1');
  return { ready: true };
}
