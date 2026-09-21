import { redactSensitiveText } from '../../security/redaction.js';
import { phonePushTypes } from '../../domain/alert-push-policy.js';

export function createAlertNotificationRepository(pool) {
  // 第⑤步（面四①，D-249）：排除法 → 白名单。谁该响手机由 `alert-push-policy.js` 一处说了算，
  // 理由逐条写在那里；这里只负责按当前清单入队。旧的 `PHONE_SILENT_TYPES` 已删。
  //
  // D-271：这段代码在生产上「写了没生效」了五天——不是它错，是 pojia-bark-notifications 这个
  // 常驻进程不在发布重启名单里，一直跑旧 release。**改完这里若不重启该服务，照样不生效。**
  // 谁该响手机由 alert-push-policy.js 一处白名单说了算（D-275 ④：撤掉 DAILY_DIGEST 开关后不再读设置）。
  async function currentPushTypes() {
    return phonePushTypes();
  }

  async function enqueueOpenAlerts() {
    const pushTypes = await currentPushTypes();
    await pool.query(
      `INSERT IGNORE INTO alert_notifications (alert_id, channel, status, source_updated_at, incident_version)
       SELECT id, 'BARK', 'PENDING', updated_at, incident_version FROM operator_alerts
        WHERE status = 'OPEN' AND alert_type IN (?)`,
      [pushTypes]
    );
    // The DB records the incident edge; polling need not observe RESOLVED.
    // Mere message/updated_at changes cannot reopen a sent or exhausted delivery.
    await pool.query(
      `UPDATE alert_notifications n
       JOIN operator_alerts a ON a.id = n.alert_id
       SET n.status = 'PENDING', n.attempt_count = 0, n.next_attempt_at = NULL,
           n.locked_at = NULL, n.sent_at = NULL, n.last_error = NULL,
           n.source_updated_at = a.updated_at, n.incident_version = a.incident_version
         WHERE n.channel = 'BARK' AND a.status = 'OPEN'
         AND (n.status = 'CANCELLED' OR n.incident_version < a.incident_version)
         AND a.alert_type IN (?)`,
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
        `SELECT n.id, n.alert_id, n.attempt_count, n.incident_version,
                a.alert_type, a.severity, a.title, a.message, a.order_id
         FROM alert_notifications n
         JOIN operator_alerts a ON a.id = n.alert_id AND a.status = 'OPEN'
         WHERE n.channel = 'BARK' AND a.alert_type IN (?)
           AND n.incident_version = a.incident_version
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
      // Read identity after releasing the outbox locks; do not add orders to the
      // FOR UPDATE join or make an optional display lookup block critical delivery.
      let identity = null;
      if (row.order_id) {
        try {
          const [orders] = await connection.query({
            sql: 'SELECT public_no, customer_email FROM orders WHERE id = ? LIMIT 1', timeout: 1500
          }, [row.order_id]);
          identity = orders[0] || null;
        } catch { /* Keep the original order-number fallback. */ }
      }
      return {
        id: row.id,
        alertId: row.alert_id,
        attemptCount: Number(row.attempt_count) + 1,
        incidentVersion: Number(row.incident_version),
        type: row.alert_type,
        severity: row.severity,
        title: row.title,
        message: row.message,
        customerEmail: identity?.customer_email || null,
        publicNo: identity?.public_no || null
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  function requireIncidentVersion(value) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('incidentVersion is required');
    return value;
  }

  async function markSent(id, { incidentVersion } = {}) {
    const version = requireIncidentVersion(incidentVersion);
    const [result] = await pool.query(
      `UPDATE alert_notifications n JOIN operator_alerts a ON a.id = n.alert_id
       SET n.status = 'SENT', n.sent_at = CURRENT_TIMESTAMP(3),
         n.locked_at = NULL, n.next_attempt_at = NULL, n.last_error = NULL,
         n.source_updated_at = a.updated_at
       WHERE n.id = ? AND n.status = 'SENDING' AND a.status = 'OPEN'
         AND n.incident_version = ? AND a.incident_version = ?`,
      [id, version, version]
    );
    return Number(result.affectedRows) === 1;
  }

  async function markFailed(id, { incidentVersion, error, retryable, attemptCount, maxAttempts }) {
    const version = requireIncidentVersion(incidentVersion);
    const exhausted = !retryable || attemptCount >= maxAttempts;
    const delaySeconds = Math.min(3_600, 15 * (2 ** Math.max(0, attemptCount - 1)));
    const [result] = await pool.query(
      `UPDATE alert_notifications n JOIN operator_alerts a ON a.id = n.alert_id
       SET n.status = ?, n.locked_at = NULL,
         n.next_attempt_at = ${exhausted ? 'NULL' : 'CURRENT_TIMESTAMP(3) + INTERVAL ? SECOND'},
         n.last_error = ? WHERE n.id = ? AND n.status = 'SENDING' AND a.status = 'OPEN'
         AND n.incident_version = ? AND a.incident_version = ?`,
      exhausted
        ? ['DEAD', redactSensitiveText(error?.message || 'Bark delivery failed'), id, version, version]
        : ['RETRY', delaySeconds, redactSensitiveText(error?.message || 'Bark delivery failed'), id, version, version]
    );
    return { exhausted, delaySeconds: exhausted ? null : delaySeconds, recorded: Number(result.affectedRows) === 1 };
  }

  /**
   * 按类型统计一段时间内**保留下来的告警通知行数**——F-55：这**不是**精确的「发送次数」。
   * `alert_notifications` 每类通知一行、复活时 `sent_at` 被清空覆盖，所以同一 dedupe_key 的告警
   * 一天里失效→恢复→再失效，最后只留最后一次的行——真实推了两次，这里只数得到一次。要精确的
   * 发送次数得按不可覆盖的投递事件另存（本块不做）。函数名点明数的是「告警实例」，不承诺发送次数
   * （D-275 ⑤）。`sinceUtc` / `untilUtc` 是半开区间 [since, until)。
   */
  async function countAlertInstancesByType({ sinceUtc, untilUtc }) {
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

  return { enqueueOpenAlerts, claimNext, markSent, markFailed, countAlertInstancesByType };
}
