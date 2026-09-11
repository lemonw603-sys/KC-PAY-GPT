import { cdkReturnBlockedBy, readCdkReturnEvidence } from './cdk-return-repository.js';

/**
 * Read-only lookup behind the customer's "check my code" step.
 *
 * It writes nothing and takes no locks. The authority on whether a code can
 * actually start an order remains the intake transaction, which re-reads every
 * row under FOR UPDATE. This one only has to answer the question a customer
 * asks before typing a Session: is this code mine to use, and does it already
 * have an order behind it?
 *
 * Returns null when the code matches nothing, so "unknown code" and "revoked
 * code" reach the caller as the same shape and leak nothing either way.
 */
export async function findCdkForVerification(pool, cdkLookup) {
  const [rows] = await pool.query(
    `SELECT c.id, c.status, c.plan_type, c.order_id,
            o.id AS internal_order_id, o.public_no, o.status AS order_status,
            product.display_name AS product_name
       FROM cdks c
       LEFT JOIN orders o ON o.id = c.order_id
       LEFT JOIN products product ON product.id = o.product_id
      WHERE (c.hash_version = ? AND c.code_hash = ?)
         OR (c.hash_version = ? AND c.code_hash = ?)
      LIMIT 2`,
    [
      cdkLookup.current.version, cdkLookup.current.hash,
      cdkLookup.legacy.version, cdkLookup.legacy.hash
    ]
  );
  // Two rows means the same code hashed under both versions — ambiguous, and
  // intake rejects it too (it requires exactly one row). Treat it as no match.
  if (rows.length !== 1) return null;
  const row = rows[0];
  return {
    status: String(row.status || ''),
    planType: row.plan_type ? String(row.plan_type) : null,
    productName: row.product_name || null,
    order: row.internal_order_id
      ? {
        internalOrderId: row.internal_order_id,
        publicNo: row.public_no,
        status: String(row.order_status || '')
      }
      : null
  };
}

/**
 * Whether intake would be able to hand this order's CDK back. Asks the same
 * question `returnCdkForOrderInTransaction` asks, through the same helper, so
 * the answer the customer sees on screen and the answer intake gives a moment
 * later cannot drift apart.
 */
export async function cdkReturnWouldBeBlocked(pool, orderId) {
  const evidence = await readCdkReturnEvidence(pool, orderId);
  return cdkReturnBlockedBy(evidence);
}
