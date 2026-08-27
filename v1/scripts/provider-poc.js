import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateChatGptSession } from '../src/domain/session-validation.js';
import {
  HnskjCardProvider,
  mapCardProvisioning,
  mapPurchasedCard
} from '../src/providers/hnskj-card.js';
import { ZzshuRechargeProvider } from '../src/providers/zzshu-recharge.js';
import { buildDirectOrderRequest } from '../src/providers/zzshu-recharge.js';
import { redactSensitiveText } from '../src/security/redaction.js';

function valueAt(object, paths) {
  for (const path of paths) {
    let value = object;
    for (const key of path) value = value?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

export { mapPurchasedCard };

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
    message: redactSensitiveText(error?.message || 'unknown error')
  };
}

function cardIdFromListRecord(record) {
  const value = record?.id ?? record?.cardId ?? record?.card_id;
  return value == null || String(value).trim() === '' ? null : String(value).trim();
}

function cardTypeMatches(record, selected) {
  const typeId = record?.cardTypeId ?? record?.card_type_id;
  const typeName = record?.cardType ?? record?.card_type;
  return (typeId != null && String(typeId) === String(selected.id))
    || (typeName != null && String(typeName) === String(selected.cardType));
}

async function recoverCardIdAfterMissingPurchaseId({
  hnskj,
  existingIds,
  selected,
  wait,
  recoveryPolls = 120,
  recoveryDelayMs = 5_000
}) {
  for (let attempt = 1; attempt <= recoveryPolls; attempt += 1) {
    const listed = await hnskj.cards({ page: 1, pageSize: 50 });
    const candidates = listed.data.cards
      .filter((record) => cardTypeMatches(record, selected))
      .map(cardIdFromListRecord)
      .filter((id) => id && !existingIds.has(id));
    const unique = [...new Set(candidates)];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) {
      throw new Error('开卡响应缺少卡片 ID，且新增卡片无法唯一匹配；已停止，禁止自动重开');
    }
    if (attempt < recoveryPolls) await wait(recoveryDelayMs);
  }
  throw new Error('开卡响应缺少卡片 ID，限定时间内无法从卡片列表恢复；已停止，禁止自动重开');
}

async function waitForPurchasedCardReady({
  hnskj,
  providerCardId,
  minimumRequiredBalance,
  checkpoint,
  wait,
  maxPolls = 120,
  pollDelayMs = 5_000
}) {
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    const details = await hnskj.card(providerCardId);
    const snapshot = mapCardProvisioning(details, minimumRequiredBalance);
    await checkpoint({
      phase: 'CARD_PROVISIONING',
      providerCardId,
      pollAttempt: attempt,
      status: snapshot.status,
      state: snapshot.state,
      currentBalance: snapshot.currentBalance,
      cardLast4: snapshot.last4
    });
    if (snapshot.state === 'ready') {
      return { details, snapshot, credentials: mapCardCredentials(details) };
    }
    if (snapshot.state === 'failed') {
      throw new Error(`卡台明确开卡失败：${snapshot.status}；未提交直充`);
    }
    if (attempt < maxPolls) await wait(pollDelayMs);
  }
  throw new Error('卡片在限定时间内没有进入可用状态；已停止，禁止自动重开或提交直充');
}

function writeState(file, state) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export async function runProviderPoc({
  hnskj,
  zzshu,
  session,
  cardTypeId,
  amount,
  minimumCardBalance,
  idempotencyKey = `pojia-poc-${crypto.randomUUID()}`,
  checkpoint = () => {},
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollDelayMs = 5_000,
  cancellationDelayMs = 60_000,
  maxPolls = 240,
  recoveryPolls = 120,
  allowRechargeSubmission = false
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
  const numericMinimumBalance = Number(minimumCardBalance);
  if (
    !Number.isFinite(numericMinimumBalance)
    || numericMinimumBalance <= 0
    || numericMinimumBalance > numericAmount
    || !/^\d+(?:\.\d{1,6})?$/.test(String(minimumCardBalance || '').trim())
  ) {
    throw new Error('最低卡余额必须是正数且不能超过开卡金额；未执行开卡');
  }

  const balanceBefore = await hnskj.accountBalance();
  const cardsBefore = await hnskj.cards({ page: 1, pageSize: 50 });
  const existingIds = new Set(cardsBefore.data.cards.map(cardIdFromListRecord).filter(Boolean));
  await checkpoint({
    phase: 'PURCHASE_STARTING',
    idempotencyKey,
    cardTypeId: Number(cardTypeId),
    amount: numericAmount,
    minimumCardBalance: numericMinimumBalance,
    cardPlatformBalanceBefore: balanceBefore.data.balance
  });
  const purchase = await hnskj.purchaseCard({
    cardTypeId: Number(cardTypeId),
    openCardAmount: numericAmount,
    idempotencyKey,
    remark: `POC-${new Date().toISOString().slice(0, 10)}`
  });
  let providerCardId;
  try {
    providerCardId = mapPurchasedCard(purchase);
  } catch (error) {
    if (!error?.uncertain || error?.provider !== 'hnskj') throw error;
    providerCardId = await recoverCardIdAfterMissingPurchaseId({
      hnskj,
      existingIds,
      selected,
      wait,
      recoveryPolls,
      recoveryDelayMs: pollDelayMs
    });
  }
  await checkpoint({
    phase: 'CARD_IDENTIFIED',
    idempotencyKey,
    providerCardId,
    cardTypeId: Number(cardTypeId),
    amount: numericAmount,
    minimumCardBalance: numericMinimumBalance,
    cardPlatformBalanceBefore: balanceBefore.data.balance
  });
  const { credentials } = await waitForPurchasedCardReady({
    hnskj,
    providerCardId,
    minimumRequiredBalance: numericMinimumBalance,
    checkpoint,
    wait,
    maxPolls: recoveryPolls,
    pollDelayMs
  });
  const request = buildDirectOrderRequest({
    ...credentials,
    token: session,
    planType: 'plus'
  });
  if (!allowRechargeSubmission) {
    const prepayment = {
      phase: 'PREPAYMENT_READY',
      idempotencyKey,
      providerCardId,
      cardTypeId: Number(cardTypeId),
      amount: numericAmount,
      minimumCardBalance: numericMinimumBalance,
      cardLast4: credentials.cardNumber.slice(-4),
      requestMethod: request.method,
      requestPath: request.path,
      planType: 'plus',
      submitted: false,
      cardPlatformBalanceBefore: balanceBefore.data.balance
    };
    await checkpoint(prepayment);
    return {
      idempotencyKey,
      providerCardId,
      cardLast4: credentials.cardNumber.slice(-4),
      cardTypeId: Number(cardTypeId),
      amount: numericAmount,
      minimumCardBalance: numericMinimumBalance,
      cardPlatformBalanceBefore: balanceBefore.data.balance,
      rechargeStatus: 'PREPAYMENT_STOPPED',
      submitted: false
    };
  }
  const recharge = await zzshu.createDirectOrder({
    ...credentials,
    token: session,
    planType: 'plus'
  });
  const durable = {
    phase: 'RECHARGE_CREATED',
    idempotencyKey,
    providerCardId,
    cardTypeId: Number(cardTypeId),
    amount: numericAmount,
    minimumCardBalance: numericMinimumBalance,
    cardLast4: credentials.cardNumber.slice(-4),
    rechargeOrderNo: recharge.orderNo,
    rechargeCardKey: recharge.cardKey,
    cardPlatformBalanceBefore: balanceBefore.data.balance
  };
  await checkpoint(durable);

  let status = null;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    status = await zzshu.queryStatus(recharge.cardKey);
    if (Array.isArray(status)) [status] = status;
    await checkpoint({ ...durable, phase: 'RECHARGE_POLLING', pollAttempt: attempt, status });
    if (status.status === 'success' || status.status === 'failed') break;
    await wait(pollDelayMs);
  }
  if (!status || !['success', 'failed'].includes(status.status)) {
    throw new Error('直充在限定时间内没有最终状态；已保存查询凭据，禁止重新创建订单');
  }
  if (status.status === 'failed') {
    await wait(2_500);
    let confirmed = await zzshu.queryStatus(recharge.cardKey);
    if (Array.isArray(confirmed)) [confirmed] = confirmed;
    status = confirmed;
  } else if (status.isSubscriptionCancelled !== 1) {
    await wait(cancellationDelayMs);
    let cancellation = await zzshu.queryStatus(recharge.cardKey);
    if (Array.isArray(cancellation)) [cancellation] = cancellation;
    status = cancellation;
  }
  const balanceAfter = await hnskj.accountBalance();
  await checkpoint({
    ...durable,
    phase: 'FINISHED',
    status,
    cardPlatformBalanceAfter: balanceAfter.data.balance
  });

  return {
    idempotencyKey,
    providerCardId,
    cardLast4: credentials.cardNumber.slice(-4),
    cardTypeId: Number(cardTypeId),
    amount: numericAmount,
    minimumCardBalance: numericMinimumBalance,
    cardPlatformBalanceBefore: balanceBefore.data.balance,
    cardPlatformBalanceAfter: balanceAfter.data.balance,
    rechargeOrderNo: recharge.orderNo,
    rechargeStatus: status.status,
    actualPaymentAmount: status.paymentAmount ?? null,
    actualPaymentCurrency: status.paymentCurrency ?? null,
    subscriptionCancelled: status.isSubscriptionCancelled ?? null
  };
}

export async function runExistingCardPoc({
  hnskj,
  zzshu,
  session,
  providerCardId,
  minimumCardBalance,
  checkpoint = () => {},
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollDelayMs = 5_000,
  cancellationDelayMs = 60_000,
  maxPolls = 240,
  allowRechargeSubmission = false
}) {
  validateChatGptSession(session);
  const cardId = String(providerCardId || '').trim();
  const minimum = Number(minimumCardBalance);
  if (!cardId || cardId.length > 128) throw new Error('必须提供有效的已有卡片 ID；未提交直充');
  if (!Number.isInteger(minimum) || minimum <= 0) {
    throw new Error('最低卡余额必须是正整数 USD；未提交直充');
  }

  const balanceBefore = await hnskj.accountBalance();
  const details = await hnskj.card(cardId);
  const snapshot = mapCardProvisioning(details, minimum);
  if (snapshot.state !== 'ready') {
    throw new Error(`已有卡片尚不可用于直充：${snapshot.status}；未提交直充`);
  }
  const credentials = mapCardCredentials(details);
  await checkpoint({
    phase: 'EXISTING_CARD_VERIFIED',
    providerCardId: cardId,
    cardLast4: credentials.cardNumber.slice(-4),
    minimumCardBalance: minimum,
    cardBalanceBefore: snapshot.currentBalance,
    cardPlatformBalanceBefore: balanceBefore.data.balance
  });

  const request = buildDirectOrderRequest({
    ...credentials,
    token: session,
    planType: 'plus'
  });
  if (!allowRechargeSubmission) {
    await checkpoint({
      phase: 'PREPAYMENT_READY',
      mode: 'existing-card',
      providerCardId: cardId,
      cardLast4: credentials.cardNumber.slice(-4),
      minimumCardBalance: minimum,
      requestMethod: request.method,
      requestPath: request.path,
      planType: 'plus',
      submitted: false,
      cardPlatformBalanceBefore: balanceBefore.data.balance
    });
    return {
      mode: 'existing-card',
      providerCardId: cardId,
      cardLast4: credentials.cardNumber.slice(-4),
      rechargeStatus: 'PREPAYMENT_STOPPED',
      submitted: false
    };
  }

  const recharge = await zzshu.createDirectOrder({
    ...credentials,
    token: session,
    planType: 'plus'
  });
  const durable = {
    phase: 'RECHARGE_CREATED',
    mode: 'existing-card',
    providerCardId: cardId,
    cardLast4: credentials.cardNumber.slice(-4),
    minimumCardBalance: minimum,
    cardBalanceBefore: snapshot.currentBalance,
    cardPlatformBalanceBefore: balanceBefore.data.balance,
    rechargeOrderNo: recharge.orderNo,
    rechargeCardKey: recharge.cardKey
  };
  await checkpoint(durable);

  let status = null;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    status = await zzshu.queryStatus(recharge.cardKey);
    if (Array.isArray(status)) [status] = status;
    await checkpoint({ ...durable, phase: 'RECHARGE_POLLING', pollAttempt: attempt, status });
    if (status.status === 'success' || status.status === 'failed') break;
    await wait(pollDelayMs);
  }
  if (!status || !['success', 'failed'].includes(status.status)) {
    throw new Error('直充在限定时间内没有最终状态；已保存查询凭据，禁止重新创建订单');
  }
  if (status.status === 'failed') {
    await wait(2_500);
    let confirmed = await zzshu.queryStatus(recharge.cardKey);
    if (Array.isArray(confirmed)) [confirmed] = confirmed;
    status = confirmed;
  } else if (status.isSubscriptionCancelled !== 1) {
    await wait(cancellationDelayMs);
    let cancellation = await zzshu.queryStatus(recharge.cardKey);
    if (Array.isArray(cancellation)) [cancellation] = cancellation;
    status = cancellation;
  }
  const balanceAfter = await hnskj.accountBalance();
  await checkpoint({
    ...durable,
    phase: 'FINISHED',
    status,
    cardPlatformBalanceAfter: balanceAfter.data.balance
  });

  return {
    mode: 'existing-card',
    providerCardId: cardId,
    cardLast4: credentials.cardNumber.slice(-4),
    minimumCardBalance: minimum,
    cardBalanceBefore: snapshot.currentBalance,
    cardPlatformBalanceBefore: balanceBefore.data.balance,
    cardPlatformBalanceAfter: balanceAfter.data.balance,
    rechargeOrderNo: recharge.orderNo,
    rechargeStatus: status.status,
    actualPaymentAmount: status.paymentAmount ?? null,
    actualPaymentCurrency: status.paymentCurrency ?? null,
    subscriptionCancelled: status.isSubscriptionCancelled ?? null
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionFile = args.get('session-file');
  const stateFile = args.get('state-file');
  const providerCardId = args.get('provider-card-id');
  const minimumCardBalance = args.get('min-card-balance');
  const cardTypeId = args.get('card-type-id');
  const amount = args.get('amount');
  if (!sessionFile || !stateFile) {
    throw new Error('必须提供 --session-file 和 --state-file');
  }
  if (providerCardId ? !minimumCardBalance : (!cardTypeId || !amount || !minimumCardBalance)) {
    throw new Error('已有卡模式需要 --provider-card-id 和 --min-card-balance；开卡模式需要 --card-type-id、--amount 和 --min-card-balance');
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
  const common = {
    hnskj,
    zzshu,
    session,
    checkpoint: (state) => writeState(stateFile, state)
  };
  const result = providerCardId
    ? await runExistingCardPoc({
        ...common,
        providerCardId,
        minimumCardBalance
      })
    : await runProviderPoc({
        ...common,
        cardTypeId,
        amount,
        minimumCardBalance
      });
  console.log(JSON.stringify(result, null, 2));
}

// process.argv[1] is absent when this module is loaded through `node --input-type=module`.
// The guard must remain safe in both direct CLI and imported/interactive execution.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify(safeError(error), null, 2));
    process.exitCode = 1;
  });
}
