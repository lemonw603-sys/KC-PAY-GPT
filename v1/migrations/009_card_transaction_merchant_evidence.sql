ALTER TABLE card_transactions
  ADD COLUMN merchant_name VARCHAR(255) NULL AFTER original_currency,
  ADD COLUMN merchant_country VARCHAR(64) NULL AFTER merchant_name,
  ADD COLUMN merchant_mcc VARCHAR(16) NULL AFTER merchant_country;
