const SELECT_ORDER = `
  SELECT o.public_no, o.status, o.updated_at,
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
         ) AS effective_status
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
  return rows[0] || null;
}
