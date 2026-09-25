// 导出给 scripts/customer-sql-probe.sh 对生产实跑同一份 SQL，不在脚本里另抄一份。
export const SELECT_ORDER = `
  SELECT o.public_no, o.status, o.updated_at,
         COALESCE(o.customer_action_code,
           CASE WHEN o.status IN ('RECHARGE_FAILED','SUBMIT_UNKNOWN')
             AND EXISTS (SELECT 1 FROM provider_calls pc
               WHERE pc.order_id = o.id AND pc.provider = 'zzshu'
                 AND pc.operation = 'create_direct' AND pc.business_code = '40030')
             THEN 'ACCOUNT_ALREADY_PLUS' END) AS customer_action_code,
         o.session_replacement_count, o.session_repair_expires_at,
         COALESCE(
           -- 关单对客户只有两种结局：关单前最后一步是成功就显示成功，其余一律显示「没有完成」
           -- （能不能重兑由 cdkReturnWouldBeBlocked 决定）。原来除 CANCELLED_PRE_SUBMISSION 外都显示
           -- 关单前的最后状态，运营判「未扣款」关单（HUMAN_VERIFIED_NOT_CHARGED）后客户页永远停在
           -- 「正在等待支付结果」（D-386 盘点，生产 4 单）。
           CASE WHEN o.status = 'CLOSED' THEN (
             CASE WHEN (
               SELECT oe.to_status FROM order_events oe
               WHERE oe.order_id = o.id AND oe.to_status <> 'CLOSED'
               ORDER BY oe.id DESC LIMIT 1
             ) = 'RECHARGE_SUCCESS' THEN 'RECHARGE_SUCCESS' ELSE 'CARD_FAILED' END
           ) END,
           o.status
         ) AS effective_status,
         o.customer_email, o.finished_at, o.id AS internal_order_id,
         o.plan_type, product.product_code, product.display_name AS product_name,
         -- 这一单的卡密现在的样子：已退回（AVAILABLE 且没绑单）就能直接重兑（D-389）。
         order_cdk.status AS cdk_status, order_cdk.order_id AS cdk_order_id
  FROM orders o
  LEFT JOIN products product ON product.id = o.product_id
  LEFT JOIN cdks order_cdk ON order_cdk.id = o.cdk_id`;

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
      -- 一张卡密可以对应多单（失败退回后重兑，迁移 051）。先取卡密当前绑定的那一单，
      -- 没有绑定（已退回）就取最新一单。原来 LIMIT 1 不排序，生产上「失败后重兑成功」的
      -- 卡密有 4/5 查出旧的失败单（D-386）。
      ORDER BY (o.id = c.order_id) DESC, o.created_at DESC, o.id DESC
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
