import { z } from 'zod';
import { OrderIntakeError } from './order-intake-error.js';

const sessionSchema = z.object({
  user: z.object({
    id: z.string().min(1).max(191).refine((value) => value.trim().length > 0),
    email: z.string().email().max(320)
  }).passthrough(),
  account: z.object({
    id: z.string().min(1).max(191).refine((value) => value.trim().length > 0)
  }).passthrough(),
  accessToken: z.string().min(1).max(16_384),
  sessionToken: z.string().min(1).max(16_384),
  expires: z.string().min(1).max(128)
}).passthrough();

function fail(code) {
  throw new OrderIntakeError('Submitted ChatGPT Session is invalid', {
    code,
    status: 400
  });
}

function parseJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) fail('INVALID_ACCESS_TOKEN');
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      fail('INVALID_ACCESS_TOKEN');
    }
    return payload;
  } catch (error) {
    if (error instanceof OrderIntakeError) throw error;
    fail('INVALID_ACCESS_TOKEN');
  }
}

export function validateChatGptSession(value, {
  now = () => Date.now(),
  minimumAccessTokenLifetimeSeconds = 300
} = {}) {
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success) fail('INCOMPLETE_SESSION');
  const session = parsed.data;

  const sessionExpiresAt = Date.parse(session.expires);
  if (!Number.isFinite(sessionExpiresAt)) fail('INVALID_SESSION_EXPIRY');
  if (sessionExpiresAt <= now()) fail('SESSION_EXPIRED');

  const sessionTokenParts = session.sessionToken.split('.');
  const requiredJweParts = [0, 2, 3, 4];
  if (
    sessionTokenParts.length !== 5
    || requiredJweParts.some((index) => !sessionTokenParts[index])
  ) {
    fail('INVALID_SESSION_TOKEN');
  }

  const payload = parseJwtPayload(session.accessToken);
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    fail('INVALID_ACCESS_TOKEN_CLAIMS');
  }
  const nowSeconds = Math.floor(now() / 1_000);
  if (payload.iat > nowSeconds + 300) fail('INVALID_ACCESS_TOKEN_CLAIMS');
  if (payload.exp <= nowSeconds) fail('ACCESS_TOKEN_EXPIRED');
  if (payload.exp - nowSeconds < minimumAccessTokenLifetimeSeconds) {
    fail('ACCESS_TOKEN_NEAR_EXPIRY');
  }

  return {
    session: value,
    customerEmail: session.user.email,
    chatgptAccountId: session.account.id.trim(),
    accessTokenExpiresAt: new Date(payload.exp * 1_000)
  };
}
