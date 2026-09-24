-- 块 7 删表第二批：补余额整条线（面二⑪；D-367，Lemon 2026-09-24「以上同意」）。
-- 同一提交已删执行器 / 对账 / 后台服务与端点 / 分卡补余额分支 / 资格规则与等卡谓词里的补余额条件 /
-- 取消订单里的补余额收尾 / 概览与准备情况里的「要补余额」；两个 timer 已于 04:42 UTC 停用。
-- 删前：card_funding_attempts 6 行（全 FAILED，风险 CLEARED×5 / NONE×1，最新 2026-09-14）、
-- card_funding_manual_actions 1 行，与 provider_calls 里 7 行带 card_funding_attempt_id 的调用，已导出留底。
--
-- provider_calls.card_funding_attempt_id 保留（只拆外键）：历史调用仍能与留底记录对上，列本身无人再写。
-- 可重跑写法（同 026）：DDL 不能回滚，中途失败重跑时外键可能已不在。
SET @drop_card_funding_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'provider_calls'
      AND CONSTRAINT_NAME = 'fk_provider_calls_card_funding'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'ALTER TABLE provider_calls DROP FOREIGN KEY fk_provider_calls_card_funding',
  'DO 0'
);
PREPARE drop_card_funding_stmt FROM @drop_card_funding_ddl;
EXECUTE drop_card_funding_stmt;
DEALLOCATE PREPARE drop_card_funding_stmt;
DROP TABLE IF EXISTS card_funding_manual_actions;
DROP TABLE IF EXISTS card_funding_attempts;
-- 开关已无代码读取；审计历史留在 admin_setting_events。
DELETE FROM app_settings WHERE setting_key = 'card_balance_recharge_enabled';
