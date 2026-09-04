ALTER TABLE card_sync_jobs
  ADD COLUMN priority TINYINT UNSIGNED NOT NULL DEFAULT 100 AFTER requested_by,
  ADD KEY idx_card_sync_jobs_priority_claim (status, available_at, priority, created_at);

-- Existing rows retain safe normal priority; only new demand-driven jobs are urgent.
