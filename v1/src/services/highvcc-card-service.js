import crypto from 'node:crypto';
import { encryptSecret, decryptSecret } from '../security/secret-box.js';
import { PublicApiError } from '../domain/public-api-error.js';
import { createHighvccCardProvider, HighvccProviderError } from '../providers/highvcc-card.js';
// Reused as-is rather than re-implemented: the deterministic per-state row picker and the
// collision-avoiding assignment store already exist, are tested, and already back the same
// tax-free-address concern for the Browser payment path against the same production table
// (browser_billing_address_assignments, migration 047). Re-implementing this to avoid a
// cross-package import would risk a subtly different collision-avoidance guarantee.
import {
  MockAddressBillingAddressSource,
  MysqlBillingAddressAssignmentStore,
} from '../../../browser-mvp/src/mockaddress-billing-address-source.js';

const TOKEN_SETTING_KEY = 'highvcc_access_token_ciphertext';
const MAX_SETTING_VALUE_LENGTH = 255; // app_settings.setting_value is VARCHAR(255) — see migration 001.
// 513989 / MasterCard, backup card platform A's existing provider_accounts row (migration 048).
// Cards opened here land in the exact same inventory pool as its manual-excel-imported cards.
export const HIGHVCC_DEFAULT_VID = '708';
export const BACKUP_A_PROVIDER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000103';

function requirePositiveAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) {
    throw new PublicApiError('Invalid amount', { code: 'HIGHVCC_INVALID_AMOUNT', status: 400 });
  }
  return n;
}

function requireVid(vid) {
  const v = String(vid ?? HIGHVCC_DEFAULT_VID).trim();
  if (!/^\d{1,10}$/.test(v)) throw new PublicApiError('Invalid card segment', { code: 'HIGHVCC_INVALID_VID', status: 400 });
  return v;
}

function panHmac(pan, key) {
  return crypto.createHmac('sha256', key).update(pan).digest('hex');
}

function mapProviderError(error) {
  if (error instanceof HighvccProviderError) {
    const status = error.code === 'HIGHVCC_TOKEN_MISSING' || error.code === 'HIGHVCC_TOKEN_EXPIRED' ? 409 : 502;
    const mapped = new PublicApiError(error.message, { code: error.code, status });
    // The platform's own clean business-reason text (e.g. "美元账户可用余额不足"), so the
    // admin UI can show the operator the real reason instead of a generic fallback.
    mapped.detail = error.providerMessage || null;
    return mapped;
  }
  return error;
}

export function createHighvccCardService({
  pool, encryptionKey, panHmacKey, fetchImpl = fetch, addressState = 'OR',
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!pool?.getConnection) throw new TypeError('pool is required');
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) throw new TypeError('encryptionKey must be 32 bytes');
  if (!Buffer.isBuffer(panHmacKey) || panHmacKey.length !== 32) throw new TypeError('panHmacKey must be 32 bytes');

  const addressSource = new MockAddressBillingAddressSource({
    state: addressState,
    name: 'highvcc-open', // per-call name is overwritten below; MockAddress needs a non-empty constructor value
    assignmentStore: new MysqlBillingAddressAssignmentStore({ pool }),
  });

  async function readTokenRow(queryable) {
    const [rows] = await queryable.query(
      `SELECT setting_value, updated_at FROM app_settings WHERE setting_key = ? LIMIT 1`,
      [TOKEN_SETTING_KEY]
    );
    return rows[0] || null;
  }

  async function getAccessToken() {
    const row = await readTokenRow(pool);
    if (!row?.setting_value) return null;
    try {
      return decryptSecret(Buffer.from(row.setting_value, 'base64'), encryptionKey);
    } catch {
      return null; // corrupt/foreign-key-rotated ciphertext reads as "no token", never throws into a card-open flow
    }
  }

  async function tokenStatus() {
    const row = await readTokenRow(pool);
    return {
      configured: Boolean(row?.setting_value),
      updatedAt: row?.updated_at instanceof Date ? row.updated_at.toISOString() : (row?.updated_at || null),
    };
  }

  async function setToken({ token, requestedBy = 'admin' } = {}) {
    const value = String(token || '').trim();
    if (value.length < 16 || value.length > 4096 || /\s/.test(value)) {
      throw new PublicApiError('token does not look like a highvcc access token', { code: 'HIGHVCC_TOKEN_INVALID', status: 400 });
    }
    const encoded = encryptSecret(value, encryptionKey).toString('base64');
    if (encoded.length > MAX_SETTING_VALUE_LENGTH) {
      // Would silently truncate in app_settings.setting_value (VARCHAR(255)); refuse instead of corrupting it.
      throw new PublicApiError('encrypted token is too long for storage; widen app_settings.setting_value first', {
        code: 'HIGHVCC_TOKEN_TOO_LONG', status: 500
      });
    }
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [TOKEN_SETTING_KEY, encoded]
    );
    return tokenStatus();
  }

  const provider = createHighvccCardProvider({ getAccessToken, fetchImpl, sleep });

  async function quote({ vid, amount } = {}) {
    const v = requireVid(vid);
    const a = requirePositiveAmount(amount);
    try {
      const feeInfo = await provider.cost({ vid: v, amount: a });
      return { vid: v, amount: a, feeDetail: feeInfo?.feeDetail ?? null, popMsg: feeInfo?.popMsg ?? null };
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  // Shared by openCard() (fresh spend) and recordExistingCard() (reconciling a card that the
  // platform already created — e.g. openCard() got HIGHVCC_OPEN_NO_PAN once and the operator
  // is now finishing the recording by hand with the card id from that error's .detail).
  // `opened` is the provider's { feeInfo, holder, requestedAddress, cardId, detail } shape.
  async function recordOpenedCard({ opened, requestedBy, amountForFallback }) {
    const card = opened.detail?.card || {};
    const pan = String(card.number || '').replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(pan)) {
      const err = new PublicApiError(
        `opened card ${opened.cardId} did not return a usable card number after retrying`,
        { code: 'HIGHVCC_OPEN_NO_PAN', status: 502 }
      );
      // Money is already spent at this point (newCard succeeded) — this is never "maybe
      // charged", so say so plainly and hand back the exact id needed to finish recording it.
      err.detail = `卡台已经开出这张卡（ID ${opened.cardId}），钱已经扣了，但暂时还没能拿到完整卡号入库；`
        + `请稍等几秒后用 v1/scripts/reconcile-highvcc-card.mjs ${opened.cardId} 补记，不要重新开卡。`;
      throw err;
    }
    const balanceDollars = Number.isFinite(Number(card.balance)) ? Number(card.balance) / 100 : (amountForFallback ?? 0);
    const address = opened.detail?.adress || opened.detail?.address || opened.requestedAddress;
    const credentials = {
      cardNumber: pan, cvv: card.cvc, cvc: card.cvc, expMonth: card.expMonth, expYear: card.expYear,
      billingAddress: {
        name: `${card.firstName || opened.holder.first} ${card.lastName || opened.holder.last}`.trim(),
        country: 'US', state: address?.state, city: address?.city, line1: address?.street, postalCode: address?.zipCode,
      },
    };
    const encryptedCredentials = encryptSecret(JSON.stringify(credentials), encryptionKey);
    const encryptedPan = encryptSecret(pan, encryptionKey);
    const hmac = panHmac(pan, panHmacKey);
    const cardUuid = crypto.randomUUID();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [conflict] = await connection.query(`SELECT id FROM cards WHERE pan_hmac = ? LIMIT 1 FOR UPDATE`, [hmac]);
      if (conflict.length) {
        // Already recorded (a prior attempt succeeded, or this is a reconciliation replay) —
        // never insert a duplicate row for the same physical card.
        throw new PublicApiError('this card already exists in inventory', {
          code: 'HIGHVCC_OPEN_DUPLICATE_CARD', status: 409
        });
      }
      await connection.query(
        `INSERT INTO cards
         (id, order_id, inventory_status, provider_card_id, card_type_id, last4, status,
          funded_amount, current_balance, currency, refund_status, card_credentials_ciphertext,
          card_number_ciphertext, pan_hmac, pan_hmac_version, provider_account_id, external_card_id,
          intake_status, sync_tier, source_present, source_operational_status, last_synced_at)
         VALUES (?,NULL,'AVAILABLE',?,?,?, 'active', ?,?,'USD','MONITORING',?,?,?,1,?,?,
                 'ACCEPTED','MANUAL_IMPORT',1,'ACTIVE',CURRENT_TIMESTAMP(3))`,
        [cardUuid, opened.cardId, 'MANUAL_BACKUP', pan.slice(-4), balanceDollars, balanceDollars,
          encryptedCredentials, encryptedPan, hmac, BACKUP_A_PROVIDER_ACCOUNT_ID, opened.cardId]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return {
      cardUuid, cardId: opened.cardId, last4: pan.slice(-4),
      expires: card.expMonth ? `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}` : null,
      holder: credentials.billingAddress.name, address: credentials.billingAddress,
      balance: balanceDollars.toFixed(2), feeDetail: opened.feeInfo?.feeDetail ?? null, requestedBy,
    };
  }

  async function openCard({ vid, amount, confirmation, requestedBy = 'admin', firstName, lastName } = {}) {
    const v = requireVid(vid);
    const a = requirePositiveAmount(amount);
    const expected = `开卡 ${v} ${a}`;
    if (confirmation !== expected) {
      throw new PublicApiError('Confirmation mismatch', { code: 'HIGHVCC_OPEN_CONFIRMATION_REQUIRED', status: 400 });
    }
    const cardRef = crypto.randomUUID();
    let opened;
    try {
      // Name isn't known until the provider call (autoCard) unless the caller supplied one;
      // MockAddress only needs *a* non-empty name up front, so resolve the address with a
      // placeholder and let the returned holder name be the one actually printed on the card
      // (the address itself doesn't carry the name into the API payload).
      const address = await addressSource.load(`highvcc:${cardRef}`);
      opened = await provider.open({ vid: v, amount: a, firstName, lastName, address });
    } catch (error) {
      throw mapProviderError(error);
    }
    const recorded = await recordOpenedCard({ opened, requestedBy, amountForFallback: a });
    return { ...recorded, vid: v, amountRequested: a };
  }

  // Reconciliation: the platform already created this card (a prior openCard() call spent the
  // money but failed to record it — its error carries this exact card id) — fetch full detail
  // now and finish recording it. Never spends money; refuses if nothing highvcc-side is found.
  async function recordExistingCard({ cardId, requestedBy = 'admin' } = {}) {
    const id = String(cardId || '').trim();
    if (!id) throw new PublicApiError('cardId is required', { code: 'HIGHVCC_RECONCILE_CARD_ID_REQUIRED', status: 400 });
    let openedDetail;
    try {
      openedDetail = await provider.detail(id);
    } catch (error) {
      throw mapProviderError(error);
    }
    if (!openedDetail?.card?.number) {
      throw new PublicApiError(`highvcc has no complete detail for card ${id} yet`, {
        code: 'HIGHVCC_RECONCILE_NOT_READY', status: 409
      });
    }
    const opened = {
      feeInfo: null,
      holder: { first: openedDetail.card.firstName || '', last: openedDetail.card.lastName || '' },
      requestedAddress: openedDetail.adress || openedDetail.address || null,
      cardId: id,
      detail: openedDetail,
    };
    return recordOpenedCard({ opened, requestedBy });
  }

  return { tokenStatus, setToken, quote, openCard, recordExistingCard };
}
