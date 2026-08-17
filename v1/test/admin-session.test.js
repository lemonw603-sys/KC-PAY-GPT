import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminSessionAuth, hashAdminPassword } from '../src/security/admin-session.js';

test('admin session verifies a strong password and rejects tampered or expired tokens', async () => {
  const passwordHash = await hashAdminPassword('correct horse battery staple', {
    salt: Buffer.alloc(16, 3)
  });
  let nowMs = Date.parse('2026-08-17T00:00:00.000Z');
  const auth = createAdminSessionAuth({
    passwordHash,
    sessionSecret: Buffer.alloc(32, 8),
    now: () => nowMs
  });

  assert.equal(await auth.verifyPassword('correct horse battery staple'), true);
  assert.equal(await auth.verifyPassword('wrong password'), false);

  const token = auth.issueSession();
  const request = { headers: { cookie: `other=1; pojia_admin_session=${token}` } };
  assert.equal(auth.authenticateRequest(request), true);
  assert.equal(auth.authenticateRequest({ headers: { cookie: `pojia_admin_session=${token}x` } }), false);

  nowMs += 13 * 60 * 60 * 1000;
  assert.equal(auth.authenticateRequest(request), false);
});

test('admin password hashing rejects weak operational passwords', async () => {
  await assert.rejects(() => hashAdminPassword('short'), /12 to 256/);
});
