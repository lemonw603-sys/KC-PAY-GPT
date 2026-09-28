import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALERT_TYPES, clearProviderTokenExpired, clearSupplyFault,
  markProviderTokenExpired, markSupplyFault, supplyFaultAlertKey,
  tokenExpiredAlertKey, walletPreflight
} from '../src/services/card-supply-scheduler-service.js';
import { persistCardTransactions } from '../src/db/repositories/card-transaction-repository.js';

const ACCOUNT = '00000000-0000-4000-8000-000000000103';

function fakeQueryable({ updateAffected = 1, accountRow = { display_name: '备用卡台 A', provider_code: 'manual_excel' } } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      if (/SELECT provider_code FROM provider_accounts/.test(flat)) return [[accountRow], []];
      if (/^SELECT last4/.test(flat)) return [[{ last4: '1652', provider_card_id: '4458' }], []];
      if (/^SELECT/i.test(flat)) return [[], []];
      return [{ affectedRows: updateAffected }, []];
    }
  };
}

// 类型可能在 params 里（upsertSupplyAlert 走 ?），也可能是 SQL 里的字面量（拒付那处）。
const alertsOf = (queryable, type) => queryable.calls
  .filter((call) => /INSERT INTO operator_alerts/.test(call.sql)
    && (call.params.includes(type) || call.sql.includes(`'${type}'`)));

test('卡台故障现在会产生告警（以前只改 supply_fault_state，一声不吭）', async () => {
  const db = fakeQueryable();
  await markSupplyFault(db, { providerAccountId: ACCOUNT, reason: 'HIGHVCC_RECONCILE_NOT_READY' });
  const alerts = alertsOf(db, ALERT_TYPES.FAULT);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].params.includes(supplyFaultAlertKey(ACCOUNT)), true);
  assert.match(String(alerts[0].params.at(-1)), /HIGHVCC_RECONCILE_NOT_READY/);
  assert.equal(alerts[0].params.includes('critical'), true);
});

test('故障恢复时 RESOLVE，下次再坏才会重新推', async () => {
  const db = fakeQueryable();
  await clearSupplyFault(db, { providerAccountId: ACCOUNT });
  const resolves = db.calls.filter((call) => /UPDATE operator_alerts SET status = 'RESOLVED'/.test(call.sql));
  assert.equal(resolves.length, 1);
  assert.deepEqual(resolves[0].params, [supplyFaultAlertKey(ACCOUNT)]);
});

test('账户已经是 FAULT（本次没改动行）就不再重复写告警', async () => {
  const db = fakeQueryable({ updateAffected: 0 });
  await markSupplyFault(db, { providerAccountId: ACCOUNT, reason: 'WALLET_READ_FAILED' });
  assert.equal(alertsOf(db, ALERT_TYPES.FAULT).length, 0);
});

test('token 失效产生一条 critical 告警，一段失效期只有这一行（dedupe_key 固定）', async () => {
  const first = fakeQueryable();
  await markProviderTokenExpired(first, { providerAccountId: ACCOUNT, code: 'HIGHVCC_TOKEN_EXPIRED' });
  const second = fakeQueryable();
  await markProviderTokenExpired(second, { providerAccountId: ACCOUNT, code: 'HIGHVCC_TOKEN_EXPIRED' });

  const a = alertsOf(first, ALERT_TYPES.TOKEN_EXPIRED);
  const b = alertsOf(second, ALERT_TYPES.TOKEN_EXPIRED);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  // 同一个 dedupe_key + ON DUPLICATE KEY UPDATE ⇒ operator_alerts 只有一行；
  // alert_notifications 的 (alert_id, channel) 唯一约束 ⇒ 这一行只入队一次 ⇒ 只推一次。
  assert.equal(a[0].params[0], b[0].params[0]);
  assert.equal(a[0].params.includes(tokenExpiredAlertKey(ACCOUNT)), true);
  assert.match(a[0].sql, /ON DUPLICATE KEY UPDATE/);
});

test('贴回 token 后 RESOLVE', async () => {
  const db = fakeQueryable();
  await clearProviderTokenExpired(db, { providerAccountId: ACCOUNT });
  const resolves = db.calls.filter((call) => /UPDATE operator_alerts SET status = 'RESOLVED'/.test(call.sql));
  assert.deepEqual(resolves[0].params, [tokenExpiredAlertKey(ACCOUNT)]);
});

test('拒付必推：新流水里的 chargeback 产生 CARD_CHARGEBACK（按类型判，不看 status 文案）', async () => {
  const db = fakeQueryable();
  await persistCardTransactions(db, {
    cardId: 'card-1',
    transactions: [{
      id: 'cb-1', type: 'chargeback',
      // hnskj 真实形状：status 是中文串，上一版判据要求 'success'，所以一条都没推过。
      status: '平台监控已登记拒付',
      amount: '76.000000', currency: 'USD', merchantName: 'OPENAI *CHATGPT SUBSCR',
      tradeTime: '2026-09-14 23:10:41', rawHash: 'h1'
    }]
  });
  const alerts = alertsOf(db, 'CARD_CHARGEBACK');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].params[0], 'card-chargeback:card-1:cb-1');
  assert.match(String(alerts[0].params.at(-1)), /尾号 1652/);
  assert.match(String(alerts[0].params.at(-1)), /76\.000000 USD/);
});

test('同一笔拒付再同步一次不再推（只对新插入的行告警）', async () => {
  const db = fakeQueryable({ updateAffected: 2 }); // 2 = ON DUPLICATE KEY 命中既有行
  await persistCardTransactions(db, {
    cardId: 'card-1',
    transactions: [{ id: 'cb-1', type: 'chargeback', status: '平台监控已登记拒付', amount: '76.000000', currency: 'USD', rawHash: 'h1' }]
  });
  assert.equal(alertsOf(db, 'CARD_CHARGEBACK').length, 0);
});

test('正常购买流水不会被当成拒付', async () => {
  const db = fakeQueryable();
  await persistCardTransactions(db, {
    cardId: 'card-1',
    transactions: [{ id: 'p-1', type: 'PURCHASE', status: 'COMPLETE', amount: '15.750000', currency: 'USD', rawHash: 'h2' }]
  });
  assert.equal(alertsOf(db, 'CARD_CHARGEBACK').length, 0);
});

// 钱包预检：**硬底线（wallet_floor）就是卡台要求留在账户里不能动的那笔钱**。
// 备用卡台 A = 20，hnskj = 30。D-272 ② 曾在公式里又按 `usdDeposit` 扣一遍「押金」——
// 押金扣两次，等于把底线悄悄翻成 40，而且那个字段跟押金本来也没关系（D-273 已整套删除）。
// **要调那笔留存，改 wallet_floor 这一个地方。**
test('硬底线已经表达了「要留的那笔钱」，公式里不该再有第二个扣减项', () => {
  const p = walletPreflight({ availableBalance: '100.00', amount: '50', feeCents: 50, floor: '20' });
  assert.equal(p.ok, true);
  assert.equal(p.projected, '49.50');
  assert.equal(p.held, undefined, '公式里不该再有「押金」这一项');
  assert.equal(p.spendable, undefined);
});

test('刚好落到底线上放行、差一分就拒开', () => {
  const edge = walletPreflight({ availableBalance: '70.50', amount: '50', feeCents: 50, floor: '20' });
  assert.equal(edge.projected, '20.00');
  assert.equal(edge.ok, true);
  const justBelow = walletPreflight({ availableBalance: '70.49', amount: '50', feeCents: 50, floor: '20' });
  assert.equal(justBelow.ok, false);
});

test('生产真实钱包数：41.49 开一张 $50 的卡，按硬底线 20 就该拒开', () => {
  const p = walletPreflight({ availableBalance: '41.49', amount: '50', feeCents: 50, floor: '20' });
  assert.equal(p.ok, false);
  assert.equal(p.projected, '-9.01');  // 与生产 06:54 那条告警文案里的数字一致
});

test('D-406：token 失效与卡台故障的推送说 highvcc，不说库里的「备用卡台 A」', async () => {
  const db = fakeQueryable();
  await markProviderTokenExpired(db, { providerAccountId: ACCOUNT });
  await markSupplyFault(db, { providerAccountId: ACCOUNT, reason: 'CARD_STOCK_PURCHASE_DISABLED' });
  const token = alertsOf(db, ALERT_TYPES.TOKEN_EXPIRED)[0].params;
  const fault = alertsOf(db, ALERT_TYPES.FAULT)[0].params;
  assert.equal(token[4], 'highvcc 登录失效');
  assert.match(String(fault.at(-1)), /^highvcc 供卡故障/);
  assert.equal([token, fault].flat().some((text) => /备用卡台/.test(String(text))), false);
});

test('D-409：token 失效推送是批过的原文——几点起失效、新卡开不出、去「卡片」页贴 token，不带内部代码', async () => {
  const db = fakeQueryable();
  await markProviderTokenExpired(db, { providerAccountId: ACCOUNT, now: new Date('2026-09-28T08:22:40Z') });
  const [call] = alertsOf(db, ALERT_TYPES.TOKEN_EXPIRED);
  assert.deepEqual(call.params.slice(2), [null, 'critical', 'highvcc 登录失效', '16:22 起失效，新卡开不出。到后台「卡片」页贴新 token 就好。'],
    '北京时间；不带 HIGHVCC_TOKEN_EXPIRED、D-249 这类内部代码');
  // 告警已开着时每小时再撞一次不改原文，「几点起」才不会跟着往后走
  assert.match(call.sql, /message = IF\(status = 'OPEN', message, VALUES\(message\)\)/);
});

test('D-409：开卡撞上 token 失效不另推「卡台故障」，只确保 token 那条开着（欠账 31）；别的原因照旧推故障', async () => {
  for (const reason of ['HIGHVCC_TOKEN_EXPIRED', 'HIGHVCC_TOKEN_MISSING']) {
    const db = fakeQueryable();
    await markSupplyFault(db, { providerAccountId: ACCOUNT, reason, now: new Date('2026-09-28T15:56:11Z') });
    assert.equal(alertsOf(db, ALERT_TYPES.FAULT).length, 0, `${reason}：不开卡台故障`);
    assert.equal(alertsOf(db, ALERT_TYPES.TOKEN_EXPIRED).length, 1, `${reason}：token 那条开着`);
    assert.ok(db.calls.some((call) => /supply_fault_state = 'FAULT'/.test(call.sql)), '故障态照记，调度器照样不用它开卡');
  }
  const other = fakeQueryable();
  await markSupplyFault(other, { providerAccountId: ACCOUNT, reason: 'WALLET_READ_FAILED' });
  assert.equal(alertsOf(other, ALERT_TYPES.FAULT).length, 1);
  assert.equal(alertsOf(other, ALERT_TYPES.TOKEN_EXPIRED).length, 0);
});

test('D-406：推送金额写法 $20.26 / $33 / $0.50 / -$1.20；非美元带币种', async () => {
  const { usd } = await import('../src/services/card-supply-scheduler-service.js');
  assert.equal(usd('20.26'), '$20.26');
  assert.equal(usd('33.000000'), '$33');
  assert.equal(usd('0.50'), '$0.50');
  assert.equal(usd('-1.20'), '-$1.20');
  assert.equal(usd('10.00', 'PHP'), '10 PHP');
  assert.equal(usd('abc'), 'abc');
});
