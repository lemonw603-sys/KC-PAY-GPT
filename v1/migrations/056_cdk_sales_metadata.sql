-- Additive only. Legacy rows remain unclassified: absence of a note is not stock.
ALTER TABLE cdk_batches
  ADD COLUMN channel_note VARCHAR(200) NULL,
  ADD COLUMN sale_amount DECIMAL(12,2) NULL,
  ADD COLUMN sale_currency CHAR(3) NULL,
  ADD COLUMN issued_at TIMESTAMP(3) NULL,
  ADD COLUMN generation_fingerprint CHAR(64) NULL;
ALTER TABLE cdks
  ADD COLUMN issuance_kind VARCHAR(16) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN admin_updated_at TIMESTAMP(3) NULL,
  ADD KEY idx_cdks_kind_status (issuance_kind, status);
