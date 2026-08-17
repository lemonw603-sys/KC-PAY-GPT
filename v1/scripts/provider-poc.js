import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateChatGptSession } from '../src/domain/session-validation.js';
import { HnskjCardProvider } from '../src/providers/hnskj-card.js';
import { ZzshuRechargeProvider } from '../src/providers/zzshu-recharge.js';

function valueAt(object, paths) {
  for (const path of paths) {
    let value = object;
    for (const key of path) value = value?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

export function mapPurchasedCard(envelope) {
  const data = envelope?.data;
  const providerCardId = valueAt(data, [
    ['card', 'id'], ['card', 'cardId'], ['card', 'card_id'],
    ['id'], ['cardId'], ['card_id']
  ]);
  if (providerCardId === null) throw new Error('卡台开卡成功，但响应中没有可识别的卡片 ID；禁止自动重试');
  return String(providerCardId);
}

export function mapCardCredentials(envelope) {
  const data = envelope?.data?.card ?? envelope?.data;
  const cardNumber = valueAt(data, [['cardNumber'], ['card_number'], ['number'], ['pan']]);
  const expMonth = Number(valueAt(data, [['expMonth'], ['exp_month'], ['expiryMonth'], ['expiry_month']]));
  const expYear = Number(valueAt(data, [['expYear'], ['exp_year'], ['expiryYear'], ['expiry_year']]));
  const cvv = valueAt(data, [['cvv'], ['cvc'], ['securityCode'], ['security_code']]);
  if (!cardNumber || !Number.isInteger(expMonth) || !Number.isInteger(expYear) || !cvv) {
    throw new Error('卡片详情字段与已知格式不一致；已停止，未提交直充');
  }
  return { cardNumber: String(cardNumber), expMonth, expYear, cvv: String(cvv) };
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('参数必须使用 --名称 值');
    values.set(key.slice(2), value);
  }
  return values;
}

function safeError(error) {
  return {
    name: error?.name || 'Error',
    provider: error?.provider || null,
    kind: error?.kind || null,
    status: error?.status || null,
    businessCode: error?.businessCode || null,
    retryable: Boolean(error?.retryable),
    uncertain: Boolean(error?.uncertain),
    message: String(error?.message || 'unknown error')
      .replace(/\b\d{12,19}\b/g, '[REDACTED]')
      .replace(/\b(?:cvv|cvc|token|session|api.?key)\b\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
  };
}

export async function runProviderPoc({
  hnskj,
  zzshu,
  session,
  cardTypeId,
  amount,
  idempotencyKey = `pojia-poc-${crypto.randomUUID()}`
}) {
  validateChatGptSession(session);
  const cardTypes = await hnskj.cardTypes();
  const selected = cardTypes.data.cardTypes.find((item) => String(item.id) === String(cardTypeId));
  if (!selected) throw new Error(`卡类型 ${cardTypeId} 不存在；未执行开卡`);
  if (!cardTypes.data.purchaseEnabled) throw new Error('卡台当前禁止开卡；未执行开卡');
  const numericAmount = Number(amount);
  const minimum = Number(selected.minAmount);
  const maximum = Number(selected.maxAmount);
  if (!Number.isInteger(numericAmount) || numericAmount < minimum || numericAmount > maximum) {
    throw new Error(`开卡金额必须是 ${minimum}-${maximum} 之间的整数；未执行开卡`);
  }

  const balanceBefore = await hnskj.accountBalance();
  const purchase = await hnskj.purchaseCard({
    cardTypeId: Number(cardTypeId),
    openCardAmount: numericAmount,
    idempotencyKey,
    remark: `POC-${new Date().toISOString().slice(0, 10)}`
  });
  const providerCardId = mapPurchasedCard(purchase);
  const details = await hnskj.card(providerCardId);
  const credentials = mapCardCredentials(details);
  const recharge = await zzshu.createDirectOrder({
    ...credentials,
    token: session,
    planType: 'plus'
  });
  const status = await zzshu.queryStatus(recharge.cardKey);
  const balanceAfter = await hnskj.accountBalance();

  return {
    idempotencyKey,
    providerCardId,
    cardLast4: credentials.cardNumber.slice(-4),
    cardTypeId: Number(cardTypeId),
    amount: numericAmount,
    cardPlatformBalanceBefore: balanceBefore.data.balance,
    cardPlatformBalanceAfter: balanceAfter.data.balance,
    rechargeOrderNo: recharge.orderNo,
    rechargeStatus: Array.isArray(status) ? status[0]?.status ?? null : status.status,
    subscriptionCancelled: Array.isArray(status)
      ? status[0]?.isSubscriptionCancelled ?? null
      : status.isSubscriptionCancelled
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionFile = args.get('session-file');
  const cardTypeId = args.get('card-type-id');
  const amount = args.get('amount');
  if (!sessionFile || !cardTypeId || !amount) {
    throw new Error('必须提供 --session-file、--card-type-id 和 --amount');
  }
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const hnskj = new HnskjCardProvider({
    baseUrl: process.env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
    apiKey: process.env.HNSKJ_API_KEY
  });
  const zzshu = new ZzshuRechargeProvider({
    baseUrl: process.env.ZZSHU_API_BASE_URL || 'https://card.zzshu.pro/api/v1',
    apiKey: process.env.ZZSHU_API_KEY
  });
  const result = await runProviderPoc({ hnskj, zzshu, session, cardTypeId, amount });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify(safeError(error), null, 2));
    process.exitCode = 1;
  });
}
