-- D-411 / D-412 / D-413（2026-09-29～30 Lemon 定）：一卡三单、第 2、3 单付款前按单往这张卡补 $16。
--   1. 补钱登记表：每次补钱一行，状态机 PREPARED → SENDING → SUBMITTED → CONFIRMED，
--      或 REJECTED（钱没动）/ UNKNOWN（发出去了但结果不明，卡锁住、不重补，等自动核对或人工）。
--      「只发一次」靠这一行：发请求前先落 SENDING，重跑时看到 SENDING 一律按 UNKNOWN 处理，绝不重发。
--   2. highvcc（备用卡台 A，103）标记为支持补钱。能不能补 = 这个能力位 **且** 代码里有该卡台的补钱适配器
--      （目前只有 highvcc_api_v1）；hnskj 的能力位是旧补余额线留下的 1，没有适配器，不会被用上。
-- 只加不删，可直接退回上一版 release（新表 / 能力位对旧代码无害）。

CREATE TABLE IF NOT EXISTS card_top_ups (
  id CHAR(36) NOT NULL,
  card_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  provider_account_id CHAR(36) NOT NULL,
  amount DECIMAL(18,6) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(24) NOT NULL,
  -- 补钱前从卡详情读到的余额（分辨到账用）；补钱后读到的余额
  balance_before DECIMAL(18,6) NULL,
  balance_after DECIMAL(18,6) NULL,
  -- 卡台原样返回的 code / msg / data（不含卡号、token）
  provider_response_json JSON NULL,
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(255) NULL,
  -- 这一单是否还挂在这张卡上：结果不明时订单会先换卡走，卡留在这里等核对
  order_detached TINYINT(1) NOT NULL DEFAULT 0,
  check_count INT UNSIGNED NOT NULL DEFAULT 0,
  sending_at TIMESTAMP(3) NULL,
  submitted_at TIMESTAMP(3) NULL,
  finished_at TIMESTAMP(3) NULL,
  resolved_by VARCHAR(128) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_card_top_ups_order_card (order_id, card_id),
  KEY idx_card_top_ups_card_status (card_id, status),
  KEY idx_card_top_ups_status (status, updated_at),
  CONSTRAINT fk_card_top_ups_card FOREIGN KEY (card_id) REFERENCES cards(id),
  CONSTRAINT fk_card_top_ups_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_card_top_ups_account FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE provider_accounts
SET supports_auto_funding = 1
WHERE id = '00000000-0000-4000-8000-000000000103' AND purpose = 'CARD';
