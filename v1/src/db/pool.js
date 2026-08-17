import mysql from 'mysql2/promise';

export function createDatabaseConnectionOptions(database, overrides = {}) {
  return {
    uri: database.url,
    ...(database.tls.enabled ? {
      ssl: {
        rejectUnauthorized: database.tls.rejectUnauthorized,
        verifyIdentity: database.tls.verifyIdentity,
        ...(database.tls.ca ? { ca: database.tls.ca } : {})
      }
    } : {}),
    ...overrides
  };
}

export function createDatabasePool(database) {
  return mysql.createPool(createDatabaseConnectionOptions(database, {
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    decimalNumbers: false,
    timezone: 'Z'
  }));
}

export async function checkDatabaseReady(pool) {
  await pool.query('SELECT 1');
  return { ready: true };
}
