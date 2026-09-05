import { ContractError } from './contracts.js';

/**
 * Validates a live checkout quote without fixing the price to a hard-coded
 * amount. The subtotal is authoritative for the current locale/exchange rate;
 * zero tax and arithmetic consistency are the invariants.
 */
export function assertZeroTaxQuote({ subtotal, tax, total, currency, toleranceMinor = 1 } = {}) {
  const parse = (value, name) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new ContractError(`${name} quote value is invalid`);
    return n;
  };
  const sub = parse(subtotal, 'subtotal');
  const taxValue = parse(tax, 'tax');
  const due = parse(total, 'total');
  const tolerance = Number(toleranceMinor);
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 100) throw new ContractError('toleranceMinor is invalid');
  if (!String(currency || '').trim()) throw new ContractError('quote currency is missing');
  if (taxValue > tolerance / 100) throw new ContractError('checkout tax is not zero');
  if (Math.abs(due - sub - taxValue) > tolerance / 100) throw new ContractError('checkout total does not match quote');
  return { verified: true, currency: String(currency).trim(), subtotal: sub, tax: taxValue, total: due, toleranceMinor: tolerance };
}
