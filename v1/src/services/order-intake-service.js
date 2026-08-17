import crypto from 'node:crypto';
import { createOrderFromCdk } from '../db/repositories/order-intake-repository.js';
import { OrderIntakeError } from '../domain/order-intake-error.js';
import { validateChatGptSession } from '../domain/session-validation.js';
import { encryptSecret } from '../security/secret-box.js';

function normalizeCdk(value) {
  if (typeof value !== 'string') {
    throw new OrderIntakeError('CDK is invalid or unavailable', {
      code: 'CDK_UNAVAILABLE',
      status: 409
    });
  }
  const cdk = value.trim();
  if (cdk.length < 8 || cdk.length > 256) {
    throw new OrderIntakeError('CDK is invalid or unavailable', {
      code: 'CDK_UNAVAILABLE',
      status: 409
    });
  }
  return cdk;
}

export function createOrderIntakeService({
  pool,
  sessionEncryptionKey,
  now = () => Date.now(),
  repository = { createOrderFromCdk }
}) {
  return async function createCustomerOrder(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new OrderIntakeError('Order request must be a JSON object', {
        code: 'INVALID_ORDER_REQUEST',
        status: 400
      });
    }
    const cdk = normalizeCdk(input.cdk);
    const validated = validateChatGptSession(input.session, { now });
    const orderId = crypto.randomUUID();
    const publicNo = `PJV1-${crypto.randomBytes(15).toString('base64url')}`;
    const cardPurchaseIdempotencyKey = `purchase-${orderId}`;
    const sessionCiphertext = encryptSecret(
      JSON.stringify(validated.session),
      sessionEncryptionKey
    );
    return repository.createOrderFromCdk(pool, {
      orderId,
      publicNo,
      cdkHash: crypto.createHash('sha256').update(cdk, 'utf8').digest('hex'),
      customerEmail: validated.customerEmail,
      chatgptAccountId: validated.chatgptAccountId,
      sessionCiphertext,
      cardPurchaseIdempotencyKey
    });
  };
}
