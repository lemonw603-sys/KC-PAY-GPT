import { redactSensitiveText } from '../../security/redaction.js';

export function createAlertNotificationRepository(pool) {
  // D-176：不是每个告警都值得响手机。这两类是链路的中间态，不是要运营做什么：
  //   BROWSER_PAYMENT_UNKNOWN —— 点了付款还没拿到结果。付款后核实通道经常在一分钟内
  //     自己确认成功（2026-09-11 唯一一次成功就走的这条路），立刻推等于谎报军情；
  //     真的卡住会由 BROWSER_HUMAN_REQUIRED 或排队超时告警接手。
  //   BROWSER_PAYMENT_CONFIRMED —— 与 BROWSER_ORDER_COMPLETED 相隔数秒，重复。
  // 两者仍写入 operator_alerts，后台面板照常能看到，只是不再占用手机。
  const PHONE_SILENT_TYPES = ['BROWSER_PAYMENT_UNKNOWN', 'BROWSER_PAYMENT_CONFIRMED'];

  async function enqueueOpenAlerts() {
    await pool.query(
      `INSERT IGNORE INTO alert_notifications (alert_id, channel, status, source_updated_at)
       SELECT id, 'BARK', 'PENDING', updated_at FROM operator_alerts
        WHERE status = 'OPEN' AND alert_type NOT IN (?, ?)`,
      PHONE_SILENT_TYPES
    );
    await pool.query(
      `UPDATE alert_notifications n
       JOIN operator_alerts a ON a.id = n.alert_id
       SET n.status = 'PENDING', n.attempt_count = 0, n.next_attempt_at = NULL,
           n.locked_at = NULL, n.sent_at = NULL, n.last_error = NULL,
           n.source_updated_at = a.updated_at
         WHERE n.channel = 'BARK' AND a.status = 'OPEN'
         AND n.status = 'CANCELLED'`
    );
    await pool.query(
      `UPDATE alert_notifications n
       JOIN operator_alerts a ON a.id = n.alert_id
       SET n.status = 'CANCELLED', n.locked_at = NULL, n.next_attempt_at = NULL
       WHERE n.channel = 'BARK' AND a.status <> 'OPEN'
         AND n.status IN ('PENDING', 'RETRY', 'SENDING', 'SENT', 'DEAD')`
    );
  }

  async function claimNext() {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT n.id, n.alert_id, n.attempt_count,
                a.alert_type, a.severity, a.title, a.message
         FROM alert_notifications n
         JOIN operator_alerts a ON a.id = n.alert_id AND a.status = 'OPEN'
         WHERE n.channel = 'BARK'
           AND (
             (n.status IN ('PENDING', 'RETRY') AND (n.next_attempt_at IS NULL OR n.next_attempt_at <= CURRENT_TIMESTAMP(3)))
             OR (n.status = 'SENDING' AND n.locked_at < CURRENT_TIMESTAMP(3) - INTERVAL 5 MINUTE)
           )
         ORDER BY FIELD(a.severity, 'critical', 'warning', 'info'), n.id
         LIMIT 1 FOR UPDATE SKIP LOCKED`
      );
      const row = rows[0];
      if (!row) {
        await connection.commit();
        return null;
      }
      await connection.query(
        `UPDATE alert_notifications
         SET status = 'SENDING', attempt_count = attempt_count + 1,
             locked_at = CURRENT_TIMESTAMP(3), next_attempt_at = NULL
         WHERE id = ?`,
        [row.id]
      );
      await connection.commit();
      return {
        id: row.id,
        alertId: row.alert_id,
        attemptCount: Number(row.attempt_count) + 1,
        type: row.alert_type,
        severity: row.severity,
        title: row.title,
        message: row.message
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function markSent(id) {
    await pool.query(
      `UPDATE alert_notifications n JOIN operator_alerts a ON a.id = n.alert_id
       SET n.status = 'SENT', n.sent_at = CURRENT_TIMESTAMP(3),
         n.locked_at = NULL, n.next_attempt_at = NULL, n.last_error = NULL,
         n.source_updated_at = a.updated_at WHERE n.id = ?`,
      [id]
    );
  }

  async function markFailed(id, { error, retryable, attemptCount, maxAttempts }) {
    const exhausted = !retryable || attemptCount >= maxAttempts;
    const delaySeconds = Math.min(3_600, 15 * (2 ** Math.max(0, attemptCount - 1)));
    await pool.query(
      `UPDATE alert_notifications SET status = ?, locked_at = NULL,
         next_attempt_at = ${exhausted ? 'NULL' : 'CURRENT_TIMESTAMP(3) + INTERVAL ? SECOND'},
         last_error = ? WHERE id = ?`,
      exhausted
        ? ['DEAD', redactSensitiveText(error?.message || 'Bark delivery failed'), id]
        : ['RETRY', delaySeconds, redactSensitiveText(error?.message || 'Bark delivery failed'), id]
    );
    return { exhausted, delaySeconds: exhausted ? null : delaySeconds };
  }

  return { enqueueOpenAlerts, claimNext, markSent, markFailed };
}
