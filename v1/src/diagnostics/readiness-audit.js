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
     WHERE setting_key IN ('accept_new_orders', 'dispatch_new_recharges', 'recharge_dispatch_mode', 'worker_heartbeat_at')`
  );
  const settings = Object.fromEntries(settingsRows.map((row) => [row.setting_key, row.setting_value]));

  const [activeTasks, expiredLeases, uncertainCalls, orphanRechargeCreateCalls,
    attemptsWithoutCreateIntent, duplicateCreateIntents, activeAuthorizations,
    riskyAttempts, activeCardStockJobs, openReconciliation, deadNotifications,
    generatedFenceColumns, uniqueFenceIndexes, migrationRows] = await Promise.all([
    scalar(pool, `SELECT COUNT(*) AS count FROM tasks WHERE status IN ('PENDING', 'RUNNING')`),
    scalar(pool, `SELECT COUNT(*) AS count FROM tasks
      WHERE status = 'RUNNING' AND leased_until < CURRENT_TIMESTAMP(3)`),
    scalar(pool, `SELECT COUNT(*) AS count FROM provider_calls
      WHERE outcome = 'UNKNOWN'
         OR (finished_at IS NULL AND operation IN ('purchase_card', 'create_direct'))`),
    scalar(pool, `SELECT COUNT(*) AS count FROM provider_calls
      WHERE operation = 'create_direct' AND recharge_attempt_id IS NULL`),
    scalar(pool, `SELECT COUNT(*) AS count FROM recharge_attempts rat
      WHERE rat.submit_intent_at IS NOT NULL
        AND rat.executor_kind = 'API'
        AND NOT EXISTS (
          SELECT 1 FROM provider_calls pc
          WHERE pc.recharge_attempt_id = rat.id AND pc.operation = 'create_direct'
        )`),
    scalar(pool, `SELECT COUNT(*) AS count FROM (
      SELECT recharge_attempt_id FROM provider_calls
      WHERE operation = 'create_direct' AND recharge_attempt_id IS NOT NULL
      GROUP BY recharge_attempt_id HAVING COUNT(*) > 1
    ) duplicate_create_intents`),
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
    scalar(pool, `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'provider_calls'
        AND COLUMN_NAME = 'recharge_create_attempt_id'
        AND EXTRA LIKE '%STORED GENERATED%'
        AND GENERATION_EXPRESSION LIKE '%operation%'
        AND GENERATION_EXPRESSION LIKE '%create_direct%'
        AND GENERATION_EXPRESSION LIKE '%recharge_attempt_id%'`),
    scalar(pool, `SELECT COUNT(*) AS count FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'provider_calls'
        AND INDEX_NAME = 'uq_provider_calls_recharge_create_attempt'
        AND NON_UNIQUE = 0
        AND SEQ_IN_INDEX = 1
        AND COLUMN_NAME = 'recharge_create_attempt_id'`),
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
  if (orphanRechargeCreateCalls > 0) blockers.push('orphan_recharge_create_calls');
  if (attemptsWithoutCreateIntent > 0) blockers.push('recharge_attempts_without_create_intent');
  if (duplicateCreateIntents > 0) blockers.push('duplicate_recharge_create_intents');
  if (activeAuthorizations > 0) blockers.push('active_recharge_authorizations');
  if (riskyAttempts > 0) blockers.push('active_or_unknown_funds_risk');
  if (activeCardStockJobs > 0) blockers.push('active_card_stock_jobs');
  if (openReconciliation > 0) blockers.push('open_reconciliation_cases');
  if (deadNotifications > 0) blockers.push('dead_bark_notifications');
  if (!['AUTOMATIC', 'MANUAL'].includes(settings.recharge_dispatch_mode)) {
    blockers.push('recharge_dispatch_mode_invalid');
  }
  if (heartbeatAgeSeconds == null || heartbeatAgeSeconds > 120) blockers.push('worker_heartbeat_stale');
  if (latestMigrationNumber < 26 || generatedFenceColumns !== 1 || uniqueFenceIndexes !== 1) {
    blockers.push('schema_not_current');
  }

  return {
    ok: blockers.length === 0,
    mode: 'read-only',
    checkedAt: now.toISOString(),
    settings: {
      acceptNewOrders: settings.accept_new_orders === 'true',
      dispatchNewRecharges: settings.dispatch_new_recharges === 'true',
      rechargeDispatchMode: settings.recharge_dispatch_mode || null
    },
    counts: {
      activeTasks,
      expiredLeases,
      uncertainProviderCalls: uncertainCalls,
      orphanRechargeCreateCalls,
      rechargeAttemptsWithoutCreateIntent: attemptsWithoutCreateIntent,
      duplicateRechargeCreateIntents: duplicateCreateIntents,
      rechargeCreateFenceColumns: generatedFenceColumns,
      rechargeCreateFenceIndexes: uniqueFenceIndexes,
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
