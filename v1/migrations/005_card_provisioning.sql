ALTER TABLE cards
  ADD COLUMN card_credentials_ciphertext MEDIUMBLOB NULL AFTER refund_status;
