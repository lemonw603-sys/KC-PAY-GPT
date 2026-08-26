import mysql from 'mysql2/promise';

const pool = mysql.createPool({ uri: process.env.TEST_DATABASE_URL, connectionLimit: 2 });
const connection = await pool.getConnection();
const [[identity]] = await connection.query('SELECT CONNECTION_ID() AS connectionId');
process.stdout.write(`${JSON.stringify({ connectionId: identity.connectionId })}\n`);
process.on('SIGUSR1', async () => {
  try {
    await connection.query('SELECT 1 AS stillAlive');
  } catch (error) {
    process.stdout.write(`FIRST_ERROR:${error.code || error.message}\n`);
  } finally {
    connection.release();
  }
  try {
    const [rows] = await pool.query('SELECT 1 AS reconnected');
    process.stdout.write(`RECONNECTED:${rows[0].reconnected}\n`);
    await pool.end();
    process.exit(0);
  } catch (error) {
    process.stdout.write(`RECONNECT_ERROR:${error.code || error.message}\n`);
    await pool.end();
    process.exit(1);
  }
});
setInterval(() => {}, 1000);
