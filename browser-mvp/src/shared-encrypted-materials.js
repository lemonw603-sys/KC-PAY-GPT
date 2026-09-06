import { decryptSecret } from '../../v1/src/security/secret-box.js';
import { validateChatGptSession } from '../../v1/src/domain/session-validation.js';
import { assertRef, ContractError } from './contracts.js';

const RUN_REF_PREFIX = 'browser-run:';

export const SHARED_SESSION_BY_RUN_SQL = `
SELECT br.status AS run_status, br.payment_state,
       br.executor_profile_id AS run_profile_id,
       rat.status AS attempt_status, rat.funds_risk_state,
       rat.executor_kind, rat.executor_profile_id AS attempt_profile_id,
       rat.fulfillment_route_id AS attempt_route_id,
       o.status AS order_status, o.fulfillment_route_id AS order_route_id,
       o.session_ciphertext, fr.id AS route_id, fr.executor_kind AS route_executor_kind
FROM browser_runs br
INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
INNER JOIN orders o ON o.id = rat.order_id
INNER JOIN fulfillment_routes fr ON fr.id = rat.fulfillment_route_id
WHERE br.id = ?`;

export const SHARED_CARD_MATERIAL_BY_RUN_SQL = `
SELECT br.status AS run_status, br.payment_state,
       br.executor_profile_id AS run_profile_id,
       rat.id AS attempt_id, rat.status AS attempt_status,
       rat.funds_risk_state, rat.executor_kind,
       rat.executor_profile_id AS attempt_profile_id,
       rat.fulfillment_route_id AS attempt_route_id,
       o.id AS order_id, o.status AS order_status,
       o.fulfillment_route_id AS order_route_id,
       o.frozen_card_provider_account_id,
       c.id AS card_id, c.provider_account_id AS card_provider_account_id,
       c.sync_tier,
       c.card_credentials_ciphertext,
       ccl.status AS consumption_status,
       ccl.recharge_attempt_id AS consumption_attempt_id,
       ccl.order_id AS consumption_order_id,
       ccl.card_id AS consumption_card_id,
       fr.id AS route_id, fr.executor_kind AS route_executor_kind,
       fr.card_provider_account_id AS route_card_provider_account_id
FROM browser_runs br
INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
INNER JOIN orders o ON o.id = rat.order_id
INNER JOIN cards c ON (c.id = o.assigned_card_id
  OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
INNER JOIN card_consumption_ledger ccl ON ccl.recharge_attempt_id = rat.id
INNER JOIN fulfillment_routes fr ON fr.id = rat.fulfillment_route_id
WHERE br.id = ?`;

export class SharedEncryptedMaterialError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SharedEncryptedMaterialError';
    this.code = code;
  }
}

function key32(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new TypeError('shared material encryptionKey must be a 32-byte Buffer');
  }
  return Buffer.from(value);
}

function runIdFromRef(runRef) {
  assertRef(runRef, 'runRef');
  if (!runRef.startsWith(RUN_REF_PREFIX)) {
    throw new ContractError(`runRef must use the ${RUN_REF_PREFIX} namespace`);
  }
  const runId = runRef.slice(RUN_REF_PREFIX.length);
  assertRef(runId, 'runId');
  return runId;
}

function queryRunner(db) {
  if (!db || (typeof db.execute !== 'function' && typeof db.query !== 'function')) {
    throw new TypeError('db must expose execute(sql, params) or query(sql, params)');
  }
  return db.execute?.bind(db) || db.query.bind(db);
}

async function exactlyOne(runQuery, sql, runId, unavailableCode) {
  const [rows] = await runQuery(sql, [runId]);
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new SharedEncryptedMaterialError('shared Browser material context is unavailable', unavailableCode);
  }
  return rows[0];
}

function assertPrePaymentContext(row, unavailableCode) {
  if (row.run_status !== 'RUNNING' || row.payment_state !== 'NOT_STARTED'
    || row.attempt_status !== 'PREPARED' || row.funds_risk_state !== 'ACTIVE'
    || row.order_status !== 'RECHARGE_PROCESSING'
    || row.executor_kind !== 'BROWSER' || row.route_executor_kind !== 'BROWSER'
    || !row.run_profile_id || row.run_profile_id !== row.attempt_profile_id
    || !row.route_id || row.attempt_route_id !== row.route_id
    || row.order_route_id !== row.route_id) {
    throw new SharedEncryptedMaterialError(
      'shared Browser material context is not active before payment',
      unavailableCode,
    );
  }
}

function assertPostPaymentContext(row, unavailableCode) {
  const paymentUnknown = row.run_status === 'RECONCILE_ONLY'
    && row.payment_state === 'PAYMENT_UNKNOWN'
    && row.attempt_status === 'SUBMIT_UNKNOWN'
    && row.funds_risk_state === 'UNKNOWN'
    && row.order_status === 'SUBMIT_UNKNOWN';
  const paymentConfirmed = row.run_status === 'RUNNING'
    && row.payment_state === 'PAYMENT_CONFIRMED'
    && row.attempt_status === 'SUBMITTING'
    && row.funds_risk_state === 'ACTIVE'
    && row.order_status === 'RECHARGE_PROCESSING';
  if ((!paymentUnknown && !paymentConfirmed)
    || row.executor_kind !== 'BROWSER' || row.route_executor_kind !== 'BROWSER'
    || !row.run_profile_id || row.run_profile_id !== row.attempt_profile_id
    || !row.route_id || row.attempt_route_id !== row.route_id
    || row.order_route_id !== row.route_id) {
    throw new SharedEncryptedMaterialError(
      'shared Browser Session context is not awaiting post-payment verification',
      unavailableCode,
    );
  }
}

function normalizeStoredCardCredentials(value) {
  const pan = String(value?.cardNumber ?? value?.pan ?? '').trim();
  const cvc = String(value?.cvv ?? value?.cvc ?? '').trim();
  const expMonth = Number(value?.expMonth ?? value?.expiryMonth);
  const expYear = Number(value?.expYear ?? value?.expiryYear);
  const current = new Date();
  const expiryIndex = expYear * 12 + expMonth;
  const currentIndex = current.getUTCFullYear() * 12 + current.getUTCMonth() + 1;
  if (!/^[0-9]{12,19}$/.test(pan) || !/^[0-9]{3,4}$/.test(cvc)
    || !Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12
    || !Number.isInteger(expYear) || expiryIndex < currentIndex) {
    throw new SharedEncryptedMaterialError('stored card material is invalid', 'CARD_NOT_READY');
  }
  const material = { pan, expMonth, expYear, cvc };
  if (value?.billingAddress != null) {
    const address = value.billingAddress;
    const billingAddress = {
      name: String(address?.name || '').trim(),
      country: String(address?.country || '').trim().toUpperCase(),
      state: String(address?.state || '').trim().toUpperCase(),
      line1: String(address?.line1 || '').trim(),
      city: String(address?.city || '').trim(),
      postalCode: String(address?.postalCode || '').trim(),
    };
    if (billingAddress.country !== 'US' || !/^[A-Z]{2}$/.test(billingAddress.state)
      || !billingAddress.name || !billingAddress.line1 || !billingAddress.city
      || !billingAddress.postalCode) {
      throw new SharedEncryptedMaterialError('stored billing address is invalid', 'CARD_NOT_READY');
    }
    material.billingAddress = billingAddress;
  }
  return material;
}

/**
 * Reads the current order Session through the authoritative browser_run.
 * The returned object is consumed immediately by CookieSessionBootstrapAdapter
 * and never enters dispatch, run metadata, WAL or ordinary logs.
 */
export class SharedEncryptedSessionSource {
  constructor({ db, encryptionKey, now = () => Date.now() } = {}) {
    this.runQuery = queryRunner(db);
    this.encryptionKey = key32(encryptionKey);
    this.now = now;
  }

  async load(runRef) {
    const runId = runIdFromRef(runRef);
    try {
      const row = await exactlyOne(
        this.runQuery,
        SHARED_SESSION_BY_RUN_SQL,
        runId,
        'SESSION_INVALID',
      );
      assertPrePaymentContext(row, 'SESSION_INVALID');
      if (!row.session_ciphertext) {
        throw new SharedEncryptedMaterialError('stored Session is unavailable', 'SESSION_INVALID');
      }
      const stored = JSON.parse(decryptSecret(row.session_ciphertext, this.encryptionKey));
      const validated = validateChatGptSession(stored, { now: this.now });
      return { sessionToken: validated.session.sessionToken };
    } catch (error) {
      if (error instanceof SharedEncryptedMaterialError || error instanceof ContractError) throw error;
      throw new SharedEncryptedMaterialError('stored Session could not be opened', 'SESSION_INVALID');
    }
  }
}

/** Read-only Session source for an already-submitted Browser payment. */
export class SharedPostPaymentSessionSource {
  constructor({ db, encryptionKey, now = () => Date.now() } = {}) {
    this.runQuery = queryRunner(db);
    this.encryptionKey = key32(encryptionKey);
    this.now = now;
  }

  async load(runRef) {
    const runId = runIdFromRef(runRef);
    try {
      const row = await exactlyOne(this.runQuery, SHARED_SESSION_BY_RUN_SQL, runId, 'SESSION_INVALID');
      assertPostPaymentContext(row, 'SESSION_INVALID');
      if (!row.session_ciphertext) {
        throw new SharedEncryptedMaterialError('stored Session is unavailable', 'SESSION_INVALID');
      }
      const stored = JSON.parse(decryptSecret(row.session_ciphertext, this.encryptionKey));
      const validated = validateChatGptSession(stored, { now: this.now });
      return { sessionToken: validated.session.sessionToken };
    } catch (error) {
      if (error instanceof SharedEncryptedMaterialError || error instanceof ContractError) throw error;
      throw new SharedEncryptedMaterialError('stored Session could not be opened', 'SESSION_INVALID');
    }
  }
}

/**
 * Reads one card credential record already bound to the active Browser attempt.
 * It never calls the card Provider and exposes no write operation.
 */
export class SharedEncryptedCardMaterialSource {
  constructor({ db, encryptionKey } = {}) {
    this.runQuery = queryRunner(db);
    this.encryptionKey = key32(encryptionKey);
  }

  async load(runRef) {
    const runId = runIdFromRef(runRef);
    try {
      const row = await exactlyOne(
        this.runQuery,
        SHARED_CARD_MATERIAL_BY_RUN_SQL,
        runId,
        'CARD_NOT_READY',
      );
      assertPrePaymentContext(row, 'CARD_NOT_READY');
      if (!row.card_id || !row.attempt_id || !row.order_id
        || !row.card_provider_account_id
        || !row.frozen_card_provider_account_id
        || row.card_provider_account_id !== row.frozen_card_provider_account_id
        || row.consumption_status !== 'RESERVED'
        || row.consumption_attempt_id !== row.attempt_id
        || row.consumption_order_id !== row.order_id
        || row.consumption_card_id !== row.card_id
        || !row.card_credentials_ciphertext) {
        throw new SharedEncryptedMaterialError(
          'shared card material is not reserved for this Browser attempt',
          'CARD_NOT_READY',
        );
      }
      const stored = JSON.parse(decryptSecret(row.card_credentials_ciphertext, this.encryptionKey));
      return normalizeStoredCardCredentials(stored);
    } catch (error) {
      if (error instanceof SharedEncryptedMaterialError || error instanceof ContractError) throw error;
      throw new SharedEncryptedMaterialError('stored card material could not be opened', 'CARD_NOT_READY');
    }
  }
}

export function browserRunMaterialRef(runId) {
  assertRef(runId, 'runId');
  return `${RUN_REF_PREFIX}${runId}`;
}
