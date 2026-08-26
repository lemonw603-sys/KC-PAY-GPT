import { randomUUID } from 'node:crypto';

import { assertRef, ContractError } from './contracts.js';

function key(value, label) { return assertRef(value, label); }

/**
 * Write-path guard kept separate from the read-only executor. It is useful in
 * F0 even while allowWrites remains false: UNKNOWN and stop conditions are
 * defined before the first real payment is enabled.
 */
export class PaymentSafetyGate {
  constructor() {
    this.stopped = { global: false, orders: new Set(), cards: new Set() };
    this.attempts = new Map();
  }

  stop(scope, ref = null) {
    if (scope === 'global') this.stopped.global = true;
    else if (scope === 'order') this.stopped.orders.add(key(ref, 'orderRef'));
    else if (scope === 'card') this.stopped.cards.add(key(ref, 'cardRef'));
    else throw new ContractError('stop scope must be global, order, or card');
  }

  resume(scope, ref = null) {
    if (scope === 'global') this.stopped.global = false;
    else if (scope === 'order') this.stopped.orders.delete(key(ref, 'orderRef'));
    else if (scope === 'card') this.stopped.cards.delete(key(ref, 'cardRef'));
    else throw new ContractError('resume scope must be global, order, or card');
  }

  stopOnFundsDifference({ expectedMinor, actualMinor } = {}) {
    if (!Number.isSafeInteger(expectedMinor) || !Number.isSafeInteger(actualMinor)) {
      throw new TypeError('expectedMinor and actualMinor must be safe integers');
    }
    if (expectedMinor === actualMinor) return { stopped: false, differenceMinor: 0 };
    this.stopped.global = true;
    return { stopped: true, differenceMinor: actualMinor - expectedMinor };
  }

  prepare({ orderRef, attemptRef, cardRef }) {
    orderRef = key(orderRef, 'orderRef'); attemptRef = key(attemptRef, 'attemptRef'); cardRef = key(cardRef, 'cardRef');
    this._assertAllowed(orderRef, cardRef);
    const permit = { permitId: `payment-permit:${randomUUID()}`, orderRef, attemptRef, cardRef, state: 'PREPARED' };
    this.attempts.set(permit.permitId, permit);
    return { ...permit };
  }

  markSubmitted(permit, providerCallRef) {
    const entry = this._entry(permit);
    if (entry.state !== 'PREPARED') throw new ContractError('payment permit is not prepared');
    entry.state = 'SUBMITTED'; entry.providerCallRef = key(providerCallRef, 'providerCallRef');
    return { ...entry };
  }

  markUnknown(permit, reason = 'no-terminal-observation') {
    const entry = this._entry(permit);
    if (!['PREPARED', 'SUBMITTED'].includes(entry.state)) throw new ContractError('payment permit cannot become UNKNOWN');
    entry.state = 'UNKNOWN'; entry.reason = String(reason).slice(0, 160);
    return { ...entry };
  }

  reconcileUnknown(permit, outcome) {
    const entry = this._entry(permit);
    if (entry.state !== 'UNKNOWN') throw new ContractError('only UNKNOWN permits require reconciliation');
    if (!['SETTLED', 'FAILED', 'MANUAL_REVIEW'].includes(outcome)) throw new ContractError('invalid reconciliation outcome');
    entry.state = outcome;
    return { ...entry };
  }

  canSubmit({ orderRef, cardRef }) {
    try { this._assertAllowed(key(orderRef, 'orderRef'), key(cardRef, 'cardRef')); return true; } catch { return false; }
  }

  snapshot() {
    return { globalStopped: this.stopped.global, stoppedOrders: [...this.stopped.orders], stoppedCards: [...this.stopped.cards], attempts: [...this.attempts.values()].map((entry) => ({ ...entry })) };
  }

  _entry(permit) {
    const entry = this.attempts.get(permit?.permitId);
    if (!entry) throw new ContractError('payment permit is unknown');
    return entry;
  }

  _assertAllowed(orderRef, cardRef) {
    if (this.stopped.global || this.stopped.orders.has(orderRef) || this.stopped.cards.has(cardRef)) throw new ContractError('payment submissions are stopped');
    for (const attempt of this.attempts.values()) {
      if (attempt.orderRef === orderRef && attempt.cardRef === cardRef && attempt.state === 'UNKNOWN') throw new ContractError('order/card is locked in UNKNOWN until reconciliation');
    }
  }
}
