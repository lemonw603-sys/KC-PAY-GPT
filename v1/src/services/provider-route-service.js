/**
 * Resolve the currently selected production card account from the immutable
 * fulfillment route.  Automatic inventory actions must not silently fall
 * back to a historical account when the operator switches the active route.
 */
export async function resolveCurrentCardProviderAccount(connection) {
  const [rows] = await connection.query(
    `SELECT pa.id
       FROM fulfillment_routes fr
       INNER JOIN products p ON p.id = fr.product_id
       INNER JOIN provider_accounts pa ON pa.id = fr.card_provider_account_id
      WHERE p.product_code = 'chatgpt_plus'
        AND p.status = 'ACTIVE'
        AND fr.accepts_new_orders = 1
        AND fr.retired_at IS NULL
        AND pa.provider_code = 'hnskj'
        AND pa.environment = 'PRODUCTION'
        AND pa.purpose = 'CARD'
        AND pa.read_enabled = 1
        AND pa.circuit_state = 'CLOSED'
        AND (pa.retry_after_until IS NULL OR pa.retry_after_until <= CURRENT_TIMESTAMP(3))
      ORDER BY fr.route_version DESC, fr.created_at DESC
      LIMIT 1
      FOR SHARE`
  );
  return rows[0]?.id ? String(rows[0].id) : null;
}

export async function resolveCurrentCardProviderAccountId(pool) {
  const connection = await pool.getConnection();
  try {
    return await resolveCurrentCardProviderAccount(connection);
  } finally {
    connection.release();
  }
}
