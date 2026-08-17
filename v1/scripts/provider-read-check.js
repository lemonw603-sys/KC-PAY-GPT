import { HnskjCardProvider, ZzshuRechargeProvider } from '../src/providers/index.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeError(error) {
  return {
    name: error?.name || 'Error',
    provider: error?.provider || null,
    kind: error?.kind || null,
    status: error?.status || null,
    code: error?.businessCode || error?.code || null
  };
}

export async function runReadOnlyChecks({ hnskj, zzshu }) {
  const profile = await hnskj.accountProfile();
  const balance = await hnskj.accountBalance();
  const cardTypes = await hnskj.cardTypes();
  const cards = await hnskj.cards({ page: 1, pageSize: 1 });
  await zzshu.checkConnection();
  return {
    hnskj: {
      accountId: profile.data.id,
      balanceCurrency: balance.data.currency,
      cardTypeCount: cardTypes.data.cardTypes.length,
      visibleCardCount: cards.data.total
    },
    zzshu: { connection: 'ok' }
  };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.PROVIDER_WRITES_ENABLED === 'true') {
    throw new Error('Read-only check refuses to run while PROVIDER_WRITES_ENABLED=true');
  }
  const hnskj = new HnskjCardProvider({
    baseUrl: process.env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
    apiKey: required('HNSKJ_API_KEY')
  });
  const zzshu = new ZzshuRechargeProvider({
    baseUrl: process.env.ZZSHU_API_BASE_URL || 'https://card.zzshu.pro/api/v1',
    apiKey: required('ZZSHU_API_KEY')
  });
  try {
    const result = await runReadOnlyChecks({ hnskj, zzshu });
    console.log(JSON.stringify({ ok: true, checks: result }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: safeError(error) }));
    process.exitCode = 1;
  }
}
