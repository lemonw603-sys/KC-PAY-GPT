// Releases the card held by an order that ended before any payment action.
// Used by the Browser pre-payment abort (RECHARGE_FAILED target) and by the
// one-off repair script for orders that failed before this release existed.
// Mirrors the operator cancellation path, except that manually imported cards
// keep their MANUAL_IMPORT sync tier (they have no API to re-sync against).

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export async function releaseCardForFailedOrderInTransaction(connection, {
  orderId, releasedBy, reason, now = new Date()
}) {
  const order = required(orderId, 'orderId');
  const actor = required(releasedBy, 'releasedBy').slice(0, 128);
  const text = required(reason, 'reason').slice(0, 255);
  const [[setting]] = await connection.query(
    `SELECT setting_value FROM app_settings
     WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1 FOR SHARE`
  );
  const [[orderRow]] = await connection.query(
    'SELECT minimum_required_card_balance FROM orders WHERE id = ? LIMIT 1 FOR UPDATE', [order]
  );
  const minimumBalance = Number(setting?.setting_value ?? orderRow?.minimum_required_card_balance ?? 0);
  const [assignments] = await connection.query(
    `UPDATE card_assignment_history
     SET status = 'RELEASED', released_by = ?, release_reason = ?, released_at = ?, updated_at = ?
     WHERE order_id = ? AND status = 'ACTIVE'`,
    [actor, text, now, now, order]
  );
  // Only cards with no other live assignment go back to the pool; balance decides
  // AVAILABLE vs DEPLETED exactly like the cancellation path.
  const [cards] = await connection.query(
    `UPDATE cards c
     INNER JOIN orders o ON (c.id = o.assigned_card_id OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
     SET c.next_sync_at = CASE WHEN c.sync_tier = 'MANUAL_IMPORT' THEN c.next_sync_at
                               WHEN c.current_balance >= ? THEN ? ELSE c.next_sync_at END,
         c.sync_tier = CASE WHEN c.sync_tier = 'MANUAL_IMPORT' THEN c.sync_tier
                            WHEN c.current_balance >= ? THEN 'AVAILABLE' ELSE c.sync_tier END,
         c.inventory_status = CASE WHEN c.current_balance >= ? THEN 'AVAILABLE' ELSE 'DEPLETED' END,
         c.assigned_at = NULL,
         c.order_id = CASE WHEN c.order_id = o.id THEN NULL ELSE c.order_id END,
         c.updated_at = ?
     WHERE o.id = ? AND c.inventory_status = 'ASSIGNED'
       AND NOT EXISTS (SELECT 1 FROM card_assignment_history other
                       WHERE other.card_id = c.id AND other.status = 'ACTIVE')`,
    [minimumBalance, now, minimumBalance, minimumBalance, now, order]
  );
  return {
    releasedAssignments: Number(assignments.affectedRows || 0),
    resetCards: Number(cards.affectedRows || 0),
    minimumBalance
  };
}
