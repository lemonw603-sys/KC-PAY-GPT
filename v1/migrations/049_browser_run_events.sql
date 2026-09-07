-- Per-order Browser stage timeline (spec §7): every executor evidence event
-- (intent / checkpoint / freeze ...) lands in the production database instead
-- of only in a worker's local WAL. Summaries carry digests and counts only.

CREATE TABLE IF NOT EXISTS browser_run_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(191) NOT NULL,
  order_id CHAR(36) NULL,
  browser_run_id CHAR(36) NULL,
  sequence_no INT UNSIGNED NOT NULL,
  event_type VARCHAR(16) NOT NULL,
  action VARCHAR(64) NULL,
  summary_json JSON NULL,
  payload_digest CHAR(64) NOT NULL,
  worker_id VARCHAR(96) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_browser_run_events_job_sequence (job_id, sequence_no),
  KEY idx_browser_run_events_order_time (order_id, created_at),
  KEY idx_browser_run_events_run (browser_run_id),
  KEY idx_browser_run_events_action_time (action, created_at)
);
