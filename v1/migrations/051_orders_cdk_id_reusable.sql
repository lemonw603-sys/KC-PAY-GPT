-- A CDK handed back after a no-payment ending (RECHARGE_FAILED / CLOSED, see
-- cdk-return-repository.js) can bind a later order. The closed order keeps its
-- cdk_id for history, so orders.cdk_id is no longer one-to-one: replace the
-- unique key with a plain index. "At most one live order per CDK" is enforced
-- by cdks.order_id (uq_cdks_order_id) plus the AVAILABLE check at intake.
ALTER TABLE orders ADD INDEX idx_orders_cdk_id (cdk_id);
ALTER TABLE orders DROP INDEX uq_orders_cdk_id;
