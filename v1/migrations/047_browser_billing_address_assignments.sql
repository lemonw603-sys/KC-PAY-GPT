CREATE TABLE IF NOT EXISTS browser_billing_address_assignments (
  binding_ref VARCHAR(191) NOT NULL,
  state CHAR(2) NOT NULL,
  row_index INT UNSIGNED NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (binding_ref),
  KEY idx_browser_billing_address_slot (state, row_index)
) ENGINE=InnoDB;
