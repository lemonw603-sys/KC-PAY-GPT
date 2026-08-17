ALTER TABLE orders
  ADD COLUMN card_type_id VARCHAR(128) NULL AFTER plan_type,
  ADD COLUMN open_card_amount DECIMAL(18,6) NULL AFTER card_type_id;
