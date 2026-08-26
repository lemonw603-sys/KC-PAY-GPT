import { assertRef, ContractError } from './contracts.js';

function cardData(envelope) {
  return envelope?.data?.card ?? envelope?.data ?? envelope ?? {};
}

/** Normalizes the HNSKJ read response without returning the provider envelope. */
export function mapHnskjCardMaterial(envelope) {
  const data = cardData(envelope);
  const pan = String(data.cardNumber ?? data.card_number ?? data.number ?? data.pan ?? '').trim();
  const cvc = String(data.cvv ?? data.cvc ?? data.securityCode ?? data.security_code ?? '').trim();
  const expMonth = Number(data.expiryMonth ?? data.expiry_month ?? data.expMonth ?? data.exp_month);
  const expYear = Number(data.expiryYear ?? data.expiry_year ?? data.expYear ?? data.exp_year);
  const currentYear = new Date().getUTCFullYear();
  if (!/^[0-9]{12,19}$/.test(pan) || !/^[0-9]{3,4}$/.test(cvc) || !Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12 || !Number.isInteger(expYear) || expYear < currentYear) {
    throw new ContractError('HNSKJ card material response is incomplete or invalid');
  }
  return { pan, cvc, expMonth, expYear };
}

/**
 * Read-only HNSKJ source. The caller must pass the provider card ID, not a
 * local inventory/card reference; no write method exists on this boundary.
 */
export class HnskjCardMaterialSource {
  constructor({ provider } = {}) {
    if (!provider || typeof provider.card !== 'function') throw new TypeError('provider.card is required');
    this.provider = provider;
    this.requiresProviderCardRef = true;
  }

  async load(providerCardRef) {
    assertRef(providerCardRef, 'providerCardRef');
    try {
      return mapHnskjCardMaterial(await this.provider.card(providerCardRef));
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError('HNSKJ card material read failed');
    }
  }
}
