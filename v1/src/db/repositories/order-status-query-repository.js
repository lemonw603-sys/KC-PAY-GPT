const SELECT_ORDER = `
  SELECT o.public_no, o.status, o.updated_at,
         COALESCE(o.customer_action_code,
           CASE WHEN o.status IN ('RECHARGE_FAILED','SUBMIT_UNKNOWN')
             AND EXISTS (SELECT 1 FROM provider_calls pc
               WHERE pc.order_id = o.id AND pc.provider = 'zzshu'
                 AND pc.operation = 'create_direct' AND pc.business_code = '40030')
             THEN 'ACCOUNT_ALREADY_PLUS' END) AS customer_action_code,
         o.session_replacement_count, o.session_repair_expires_at,
         COALESCE(
           CASE WHEN o.status = 'CLOSED' THEN (
             CASE WHEN o.failure_code = 'CANCELLED_PRE_SUBMISSION' THEN 'CARD_FAILED'
             WHEN EXISTS (
               SELECT 1 FROM order_compensations oc WHERE oc.original_order_id = o.id
             ) THEN 'CARD_FAILED' ELSE (
               SELECT oe.to_status FROM order_events oe
               WHERE oe.order_id = o.id AND oe.to_status <> 'CLOSED'
               ORDER BY oe.id DESC LIMIT 1
             ) END
           ) END,
           o.status
         ) AS effective_status,
         o.customer_email, o.finished_at, o.id AS internal_order_id
  FROM orders o`;

export async function findCustomerOrder(pool, lookup) {
  let sql;
  let parameter;
  if (lookup.publicNo) {
    sql = `${SELECT_ORDER} WHERE BINARY o.public_no = ? LIMIT 1`;
    parameter = lookup.publicNo;
  } else {
    sql = `${SELECT_ORDER}
      INNER JOIN cdks c ON c.id = o.cdk_id
      WHERE (c.hash_version = ? AND c.code_hash = ?)
         OR (c.hash_version = ? AND c.code_hash = ?)
      LIMIT 1`;
    parameter = [
      lookup.cdkLookup.current.version, lookup.cdkLookup.current.hash,
      lookup.cdkLookup.legacy.version, lookup.cdkLookup.legacy.hash
    ];
  }
  const [rows] = await pool.query(sql, Array.isArray(parameter) ? parameter : [parameter]);
  const order = rows[0];
  if (!order) return null;
  const [events] = await pool.query(
    `SELECT to_status, created_at FROM order_events WHERE order_id = ? ORDER BY id ASC`,
    [order.internal_order_id]
  );
  return { ...order, events };
}
