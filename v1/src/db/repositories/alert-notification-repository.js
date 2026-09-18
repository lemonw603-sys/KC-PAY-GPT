import { redactSensitiveText } from '../../security/redaction.js';
import {
  BALANCE_CHANGE_PUSH_MODE_SETTING, PUSH_MODE_EACH, phonePushTypes
} from '../../domain/alert-push-policy.js';

export function createAlertNotificationRepository(pool) {
  // 第⑤步（面四①，D-249）：排除法 → 白名单。谁该响手机由 `alert-push-policy.js` 一处说了算，
  // 理由逐条写在那里；这里只负责按当前清单入队。旧的 `PHONE_SILENT_TYPES` 已删。
  //
  // D-271：这段代码在生产上「写了没生效」了五天——不是它错，是 pojia-bark-notifications 这个
  // 常驻进程不在发布重启名单里，一直跑旧 release。**改完这里若不重启该服务，照样不生效。**
  async function currentPushTypes() {
    const [rows] = await pool.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
      [BALANCE_CHANGE_PUSH_MODE_SETTING]
    );
    return phonePushTypes({ balanceChangePushMode: rows[0]?.setting_value || PUSH_MODE_EACH });
  }

  async function enqueueOpenAlerts() {
    const pushTypes = await currentPushTypes();
    await pool.query(
      `INSERT IGNORE INTO alert_notifications (alert_id, channel, status, source_updated_at)
       SELECT id, 'BARK', 'PENDING', updated_at FROM operator_alerts
        WHERE status = 'OPEN' AND alert_type IN (?)`,
      [pushTypes]
    );
    // 告警 RESOLVED→OPEN 翻回来时，原先被 CANCELLED 的通知行要复活重推（例如 token 再次失效）。
    // 这一段以前**没有类型过滤**：白名单外的类型只要在历史上推过一次，就能靠这条路一直复活。
    await pool.query(
      `UPDATE alert_notifications n
       JOIN operator_alerts a ON a.id = n.alert_id
       SET n.status = 'PENDING', n.attempt_count = 0, n.next_attempt_at = NULL,
           n.locked_at = NULL, n.sent_at = NULL, n.last_error = NULL,
           n.source_updated_at = a.updated_at
         WHERE n.channel = 'BARK' AND a.status = 'OPEN'
         AND n.status = 'CANCELLED' AND a.alert_type IN (?)`,
      [pushTypes]
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
    const pushTypes = await currentPushTypes();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // 白名单在这里再判一次：入队时白、领取时也要白。否则白名单收窄之前遗留的 PENDING/RETRY 行
      // 会在改动上线后继续被推出去——那正是「改了没生效」的另一种形态。
      const [rows] = await connection.query(
        `SELECT n.id, n.alert_id, n.attempt_count,
                a.alert_type, a.severity, a.title, a.message
         FROM alert_notifications n
         JOIN operator_alerts a ON a.id = n.alert_id AND a.status = 'OPEN'
         WHERE n.channel = 'BARK' AND a.alert_type IN (?)
           AND (
             (n.status IN ('PENDING', 'RETRY') AND (n.next_attempt_at IS NULL OR n.next_attempt_at <= CURRENT_TIMESTAMP(3)))
             OR (n.status = 'SENDING' AND n.locked_at < CURRENT_TIMESTAMP(3) - INTERVAL 5 MINUTE)
           )
         ORDER BY FIELD(a.severity, 'critical', 'warning', 'info'), n.id
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [pushTypes]
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

  /**
   * 缝 d：「今天叫了几次、为什么」——按 `alert_notifications.sent_at` 统计，不是按 operator_alerts。
   * 只有真推到手机的才算「叫」。第⑥块看板的数据源；本块的每日汇总也用它。
   * `sinceUtc` / `untilUtc` 是半开区间 [since, until)。
   */
  async function countPushesByType({ sinceUtc, untilUtc }) {
    const [rows] = await pool.query(
      `SELECT a.alert_type, a.severity, COUNT(*) AS pushes, MAX(n.sent_at) AS last_sent_at
         FROM alert_notifications n JOIN operator_alerts a ON a.id = n.alert_id
        WHERE n.channel = 'BARK' AND n.sent_at IS NOT NULL
          AND n.sent_at >= ? AND n.sent_at < ?
        GROUP BY a.alert_type, a.severity
        ORDER BY pushes DESC, a.alert_type`,
      [sinceUtc, untilUtc]
    );
    return rows.map((row) => ({
      alertType: row.alert_type,
      severity: row.severity,
      pushes: Number(row.pushes) || 0,
      lastSentAt: row.last_sent_at
    }));
  }

  return { enqueueOpenAlerts, claimNext, markSent, markFailed, countPushesByType };
}
