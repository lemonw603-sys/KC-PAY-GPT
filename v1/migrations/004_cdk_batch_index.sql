ALTER TABLE cdks
  ADD INDEX idx_cdks_batch_created (batch_no, created_at);
