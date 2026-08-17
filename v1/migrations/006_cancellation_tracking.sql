ALTER TABLE orders
  ADD COLUMN subscription_cancelled TINYINT UNSIGNED NULL AFTER recharge_card_key,
  ADD COLUMN cancellation_checked_at TIMESTAMP(3) NULL AFTER subscription_cancelled,
  ADD COLUMN cancellation_review_required TINYINT(1) NOT NULL DEFAULT 0 AFTER cancellation_checked_at;
