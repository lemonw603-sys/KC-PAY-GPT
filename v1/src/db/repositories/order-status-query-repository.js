const SELECT_ORDER = `
  SELECT o.public_no, o.status, o.updated_at,
         COALESCE(
           CASE WHEN o.status = 'CLOSED' THEN (
             SELECT oe.to_status FROM order_events oe
             WHERE oe.order_id = o.id AND oe.to_status <> 'CLOSED'
             ORDER BY oe.id DESC LIMIT 1
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
      WHERE c.code_hash = ? LIMIT 1`;
    parameter = lookup.cdkHash;
  }
  const [rows] = await pool.query(sql, [parameter]);
  return rows[0] || null;
}
