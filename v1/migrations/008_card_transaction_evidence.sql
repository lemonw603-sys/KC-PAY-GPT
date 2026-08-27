ALTER TABLE card_transactions
  ADD COLUMN fee DECIMAL(18,6) NULL AFTER currency,
  ADD COLUMN trade_time_raw VARCHAR(64) NULL AFTER fee,
  ADD COLUMN related_txn_id VARCHAR(191) NULL AFTER trade_time_raw,
  ADD COLUMN settlement_status VARCHAR(64) NULL AFTER related_txn_id,
  ADD COLUMN original_amount DECIMAL(18,6) NULL AFTER settlement_status,
  ADD COLUMN original_currency CHAR(3) NULL AFTER original_amount,
  ADD KEY idx_card_transactions_related (related_txn_id);
