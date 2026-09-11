/**
 * A card's BIN — the issuing product prefix (D-162).
 *
 * The card platform lists its segments as 6- or 8-digit prefixes ("513989",
 * "53211304"), so we store 8 digits and match a segment by prefix. A BIN is
 * shared by millions of cards and identifies the issuing product, not the card
 * or its holder: it is not PAN material, and the platform already shows it in
 * its own segment picker. It is what lets a decline be attributed to a segment
 * instead of to a single card.
 */
export const CARD_BIN_LENGTH = 8;

/** Returns the 8-digit BIN of a PAN, or null when the input is not a usable PAN. */
export function cardBin(pan) {
  const digits = String(pan ?? '').replace(/\D/g, '');
  return digits.length >= CARD_BIN_LENGTH ? digits.slice(0, CARD_BIN_LENGTH) : null;
}

/** True when `bin` belongs to the platform segment `segment` (6- or 8-digit prefix). */
export function binMatchesSegment(bin, segment) {
  const b = String(bin ?? '').replace(/\D/g, '');
  const s = String(segment ?? '').replace(/\D/g, '');
  if (!b || !s || s.length > b.length) return false;
  return b.startsWith(s);
}
