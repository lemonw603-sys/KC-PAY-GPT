function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function sessionFixture({ nowMs = Date.now(), lifetimeSeconds = 3_600 } = {}) {
  const nowSeconds = Math.floor(nowMs / 1_000);
  return {
    WARNING_BANNER: 'fixture-only',
    user: {
      id: 'user-fixture',
      email: 'fixture@example.com',
      name: 'Fixture User'
    },
    account: {
      id: 'account-fixture',
      planType: 'free'
    },
    expires: new Date(nowMs + lifetimeSeconds * 1_000).toISOString(),
    accessToken: [
      encode({ alg: 'RS256', typ: 'JWT' }),
      encode({ iat: nowSeconds - 60, exp: nowSeconds + lifetimeSeconds }),
      'fixture-signature'
    ].join('.'),
    sessionToken: 'one..three.four.five',
    extension: { preserved: true }
  };
}
