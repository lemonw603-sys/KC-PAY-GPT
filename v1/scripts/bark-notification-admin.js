import { loadRuntimeDatabaseConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';

const [command, selector] = process.argv.slice(2);
if (command !== 'retry-dead' || (!selector && selector !== '--all')) {
  console.error('Usage: node scripts/bark-notification-admin.js retry-dead <notification-id|--all>');
  process.exit(2);
}
if (process.env.BARK_RETRY_CONFIRM !== 'RETRY-DEAD-BARK') {
  throw new Error('Set BARK_RETRY_CONFIRM=RETRY-DEAD-BARK to confirm a DEAD notification retry');
}

const pool = createDatabasePool(loadRuntimeDatabaseConfig());
try {
  const [result] = selector === '--all'
    ? await pool.query(
      `UPDATE alert_notifications SET status = 'PENDING', attempt_count = 0,
         next_attempt_at = NULL, locked_at = NULL, sent_at = NULL, last_error = NULL
       WHERE channel = 'BARK' AND status = 'DEAD'`
    )
    : await pool.query(
      `UPDATE alert_notifications SET status = 'PENDING', attempt_count = 0,
         next_attempt_at = NULL, locked_at = NULL, sent_at = NULL, last_error = NULL
       WHERE id = ? AND channel = 'BARK' AND status = 'DEAD'`,
      [selector]
    );
  console.log(JSON.stringify({ ok: true, retried: result.affectedRows }));
} finally {
  await pool.end();
}
