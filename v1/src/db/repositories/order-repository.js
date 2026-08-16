import { assertOrderTransition } from '../../domain/order-status.js';

export async function transitionOrder(pool, {
  orderId,
  toStatus,
  actorType,
  actorId = null,
  reason,
  metadata = null
}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT status, version FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (rows.length !== 1) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const fromStatus = rows[0].status;
    assertOrderTransition(fromStatus, toStatus);

    const [result] = await connection.query(
      `UPDATE orders
       SET status = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND version = ?`,
      [toStatus, orderId, rows[0].version]
    );
    if (result.affectedRows !== 1) {
      throw new Error(`Concurrent order update detected: ${orderId}`);
    }

    await connection.query(
      `INSERT INTO order_events
       (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        fromStatus,
        toStatus,
        actorType,
        actorId,
        reason,
        metadata == null ? null : JSON.stringify(metadata)
      ]
    );

    await connection.commit();
    return { orderId, fromStatus, toStatus, version: Number(rows[0].version) + 1 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
