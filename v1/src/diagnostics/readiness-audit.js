function number(value) {
  return Number(value || 0);
}

async function scalar(pool, sql, values = []) {
  const [rows] = await pool.query(sql, values);
  return number(rows[0]?.count);
}

export async function runReadinessAudit(pool, { now = new Date() } = {}) {
  const [settingsRows] = await pool.query(
    `SELECT setting_key, setting_value FROM app_settings
     WHERE setting_key IN ('accept_new_orders', 'dispatch_new_recharges', 'worker_heartbeat_at')`
  );
  const settings = Object.fromEntries(settingsRows.map((row) => [row.setting_key, row.setting_value]));

  const [activeTasks, expiredLeases, uncertainCalls, activeAuthorizations,
    riskyAttempts, activeCardStockJobs, openReconciliation, deadNotifications, migrationRows] = await Promise.all([
    scalar(pool, `SELECT COUNT(*) AS count FROM tasks WHERE status IN ('PENDING', 'RUNNING')`),
    scalar(pool, `SELECT COUNT(*) AS count FROM tasks
      WHERE status = 'RUNNING' AND leased_until < CURRENT_TIMESTAMP(3)`),
    scalar(pool, `SELECT COUNT(*) AS count FROM provider_calls
      WHERE outcome = 'UNKNOWN'
         OR (finished_at IS NULL AND operation IN ('purchase_card', 'create_direct'))`),
    scalar(pool, `SELECT COUNT(*) AS count FROM recharge_authorizations
      WHERE status = 'ACTIVE' AND expires_at > CURRENT_TIMESTAMP(3)`),
    scalar(pool, `SELECT COUNT(*) AS count FROM recharge_attempts
      WHERE funds_risk_state IN ('ACTIVE', 'UNKNOWN')`),
    scalar(pool, `SELECT COUNT(*) AS count FROM card_stock_jobs
      WHERE status IN ('PENDING', 'RUNNING')`),
    scalar(pool, `SELECT COUNT(*) AS count FROM reconciliation_cases
      WHERE status = 'OPEN' AND severity IN ('critical', 'warning')`),
    scalar(pool, `SELECT COUNT(*) AS count FROM alert_notifications
      WHERE channel = 'BARK' AND status = 'DEAD'`),
    pool.query(`SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`)
  ]);

  const heartbeat = settings.worker_heartbeat_at ? new Date(settings.worker_heartbeat_at) : null;
  const heartbeatAgeSeconds = heartbeat && !Number.isNaN(heartbeat.getTime())
    ? Math.max(0, Math.floor((now.getTime() - heartbeat.getTime()) / 1_000))
    : null;
  const latestMigration = migrationRows[0][0]?.version || null;
  const latestMigrationNumber = latestMigration ? Number(String(latestMigration).match(/^\d+/)?.[0] || 0) : 0;
  const blockers = [];
  if (expiredLeases > 0) blockers.push('expired_task_leases');
  if (uncertainCalls > 0) blockers.push('uncertain_provider_calls');
  if (activeAuthorizations > 0) blockers.push('active_recharge_authorizations');
  if (riskyAttempts > 0) blockers.push('active_or_unknown_funds_risk');
  if (activeCardStockJobs > 0) blockers.push('active_card_stock_jobs');
  if (openReconciliation > 0) blockers.push('open_reconciliation_cases');
  if (deadNotifications > 0) blockers.push('dead_bark_notifications');
  if (heartbeatAgeSeconds == null || heartbeatAgeSeconds > 120) blockers.push('worker_heartbeat_stale');
  if (latestMigrationNumber < 23) blockers.push('schema_not_current');

  return {
    ok: blockers.length === 0,
    mode: 'read-only',
    checkedAt: now.toISOString(),
    settings: {
      acceptNewOrders: settings.accept_new_orders === 'true',
      dispatchNewRecharges: settings.dispatch_new_recharges === 'true'
    },
    counts: {
      activeTasks,
      expiredLeases,
      uncertainProviderCalls: uncertainCalls,
      activeRechargeAuthorizations: activeAuthorizations,
      activeOrUnknownFundsRisk: riskyAttempts,
      activeCardStockJobs,
      openReconciliationCases: openReconciliation,
      deadBarkNotifications: deadNotifications
    },
    workerHeartbeatAgeSeconds: heartbeatAgeSeconds,
    latestMigration,
    latestMigrationNumber,
    blockers
  };
}
