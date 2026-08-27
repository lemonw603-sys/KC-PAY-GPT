-- Auditable manual switching of the active fulfillment route.
CREATE TABLE IF NOT EXISTS provider_route_switch_events (
  id CHAR(36) PRIMARY KEY,
  route_id CHAR(36) NOT NULL,
  previous_route_id CHAR(36) NULL,
  actor_id VARCHAR(128) NOT NULL,
  operator_note VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_route_switch_created (created_at),
  CONSTRAINT fk_route_switch_route FOREIGN KEY (route_id) REFERENCES fulfillment_routes(id),
  CONSTRAINT fk_route_switch_previous FOREIGN KEY (previous_route_id) REFERENCES fulfillment_routes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
