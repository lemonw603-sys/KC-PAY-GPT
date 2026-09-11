-- D-162: record each card's BIN (issuing product prefix) so decline history can be
-- attributed to a card segment. A BIN is shared by millions of cards and identifies
-- the issuing product, not the cardholder or the card — it is not PAN material and is
-- already visible in the card platform's own segment list.
ALTER TABLE cards ADD COLUMN card_bin VARCHAR(8) NULL AFTER last4;
CREATE INDEX idx_cards_card_bin ON cards (card_bin);
