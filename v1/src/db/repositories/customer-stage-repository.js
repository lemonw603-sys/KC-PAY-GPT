/**
 * The execution evidence behind the nine customer-visible stages.
 *
 * Read-only, and deliberately two separate queries rather than one UNION: the
 * two tables carry different collations (browser_run_events is
 * utf8mb4_0900_ai_ci, orders is utf8mb4_unicode_ci), and joining them in one
 * statement fails at runtime rather than at review time.
 *
 * Both are bounded — a single order's run produces single-digit rows (the
 * 2026-09-11 delivery produced 7 events and 4 operations).
 */
export async function findStageEvidence(pool, internalOrderId) {
  const orderId = String(internalOrderId || '').trim();
  if (!orderId) return [];
  const [runEvents, operations] = await Promise.all([
    pool.query(
      `SELECT action, created_at FROM browser_run_events
        WHERE order_id = ? AND action IS NOT NULL
        ORDER BY created_at ASC, sequence_no ASC
        LIMIT 200`,
      [orderId]
    ),
    pool.query(
      `SELECT bo.operation_type, bo.created_at
         FROM browser_operations bo
         INNER JOIN browser_runs br ON br.id = bo.browser_run_id
         INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
        WHERE rat.order_id = ?
        ORDER BY bo.created_at ASC
        LIMIT 200`,
      [orderId]
    )
  ]);
  return [
    ...(runEvents[0] || []).map((row) => ({ kind: 'event', token: row.action, at: row.created_at })),
    ...(operations[0] || []).map((row) => ({ kind: 'operation', token: row.operation_type, at: row.created_at }))
  ];
}
