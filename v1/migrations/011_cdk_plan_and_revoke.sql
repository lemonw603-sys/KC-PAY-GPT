ALTER TABLE cdks
  ADD COLUMN plan_type VARCHAR(24) NOT NULL DEFAULT 'plus' AFTER batch_no,
  ADD COLUMN revoked_at TIMESTAMP(3) NULL AFTER redeemed_at,
  ADD COLUMN revoke_reason VARCHAR(500) NULL AFTER revoked_at;

ALTER TABLE cdks
  ADD KEY idx_cdks_batch_status (batch_no, status);
