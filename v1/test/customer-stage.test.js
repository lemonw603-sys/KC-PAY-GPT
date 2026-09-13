import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOMER_STAGES,
  resolveCustomerStage,
  stagePercent
} from '../src/domain/customer-stage.js';

/**
 * The real delivery of 2026-09-11 (order PJV1-ztS9FZ3Qcw…), read out of
 * production on 2026-09-12. Using the actual timeline as the fixture is the
 * point: a fixture I invent proves only that my invention is self-consistent.
 */
const REAL_ORDER_EVENTS = [
  { kind: 'order', token: 'CREATED', at: '2026-09-11T11:10:03.646Z' },
  { kind: 'order', token: 'CARD_READY', at: '2026-09-11T11:10:04.196Z' },
  { kind: 'order', token: 'CARD_READY', at: '2026-09-11T11:10:04.231Z' },
  { kind: 'order', token: 'RECHARGE_PROCESSING', at: '2026-09-11T11:10:04.256Z' },
  { kind: 'order', token: 'SUBMIT_UNKNOWN', at: '2026-09-11T11:14:53.139Z' },
  { kind: 'order', token: 'RECHARGE_PROCESSING', at: '2026-09-11T11:15:15.961Z' },
  { kind: 'order', token: 'RECHARGE_SUCCESS', at: '2026-09-11T11:15:15.961Z' }
];
const REAL_RUN_EVENTS = [
  { kind: 'event', token: 'observe-page', at: '2026-09-11T11:12:39.734Z' },
  { kind: 'event', token: 'session-bootstrap', at: '2026-09-11T11:12:46.022Z' },
  { kind: 'event', token: 'page-reset', at: '2026-09-11T11:12:50.211Z' },
  { kind: 'event', token: 'account-readonly-probe', at: '2026-09-11T11:13:00.210Z' },
  { kind: 'event', token: 'page-signature', at: '2026-09-11T11:13:00.566Z' },
  { kind: 'event', token: 'card-material-preflight', at: '2026-09-11T11:13:03.616Z' },
  { kind: 'event', token: 'checkout-navigation', at: '2026-09-11T11:13:36.882Z' }
];

/**
 * 同一单的 browser_operations 轨迹。之前的夹具只有订单事件和执行器检查点，
 * 缺了这一段，于是第 6 到第 8 阶段的真实推进从来没被测到——而取这段数据的
 * SQL 正好写错了列名（用了不存在的 created_at），生产上必然抛错，九阶段会
 * 整个失效，测试却全绿。补上。
 */
const REAL_OPERATIONS = [
  { kind: 'operation', token: 'BEGIN_RUN', at: '2026-09-11T11:12:33.412Z' },
  { kind: 'operation', token: 'PAYMENT_SUBMIT', at: '2026-09-11T11:14:09.889Z' },
  { kind: 'operation', token: 'PAYMENT_UNKNOWN', at: '2026-09-11T11:14:53.139Z' },
  { kind: 'operation', token: 'PAYMENT_VERIFICATION', at: '2026-09-11T11:14:58.362Z' },
  { kind: 'operation', token: 'PAYMENT_CONFIRMED', at: '2026-09-11T11:15:15.961Z' },
  { kind: 'operation', token: 'PLUS_ACTIVATED', at: '2026-09-11T11:15:15.961Z' },
  { kind: 'operation', token: 'CANCELLATION_CONFIRMED', at: '2026-09-11T11:15:15.961Z' }
];

test('nine stages, numbered and capped in order', () => {
  assert.equal(CUSTOMER_STAGES.length, 9);
  assert.deepEqual(CUSTOMER_STAGES.map((s) => s.index), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(CUSTOMER_STAGES.at(-1).label, '订阅成功');
  let previous = 0;
  for (const stage of CUSTOMER_STAGES) {
    assert.ok(stage.ceiling > previous, `${stage.code} ceiling must rise`);
    previous = stage.ceiling;
  }
  assert.equal(CUSTOMER_STAGES.at(-1).ceiling, 100);
});

test('a brand new order is stage 1, and an order with nothing on file still is', () => {
  assert.equal(resolveCustomerStage({ orderStatus: 'CREATED' }).stage.index, 1);
  assert.equal(resolveCustomerStage({}).stage.index, 1);
  assert.equal(resolveCustomerStage({ orderStatus: 'SOMETHING_NEW' }).stage.index, 1);
});

test('the card steps, the queue, and the run are distinct stages', () => {
  for (const status of ['WAITING_FOR_CARD', 'CARD_PURCHASING', 'CARD_PROVISIONING']) {
    assert.equal(resolveCustomerStage({ orderStatus: status }).stage.index, 2, status);
  }
  // Card ready but the executor has not logged anything: the order is queued.
  assert.equal(resolveCustomerStage({
    orderStatus: 'RECHARGE_PROCESSING',
    evidence: REAL_ORDER_EVENTS.slice(0, 4)
  }).stage.index, 3);
});

test('replays the real delivery and never walks backwards', () => {
  const merged = [...REAL_ORDER_EVENTS, ...REAL_RUN_EVENTS, ...REAL_OPERATIONS]
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  let last = 0;
  const seen = [];
  for (let i = 1; i <= merged.length; i += 1) {
    const slice = merged.slice(0, i);
    const status = [...slice].reverse().find((row) => row.kind === 'order')?.token || 'CREATED';
    const { stage } = resolveCustomerStage({ orderStatus: status, evidence: slice });
    assert.ok(stage.index >= last, `stage went back at row ${i}: ${last} → ${stage.index}`);
    last = stage.index;
    seen.push(stage.index);
  }
  // The SUBMIT_UNKNOWN → RECHARGE_PROCESSING hop is exactly the case that would
  // drop a status-only reading from 7 back to 3, twenty seconds before delivery.
  assert.equal(seen.at(-1), 9);
  // 这一单真实走过的每一步都要出现。缺任何一个都说明那一档的证据没被认出来。
  for (const step of [1, 3, 4, 5, 6, 7, 9]) {
    assert.ok(seen.includes(step), `第 ${step} 阶段在真实回放里没有出现`);
  }
  // 第 2 阶段（准备支付卡）这一单没经过：卡是现成的，0.5 秒就 CARD_READY。
  assert.equal(seen.includes(2), false);
  // 第 8 阶段（正在确认订阅）在这一单里一闪而过：PAYMENT_CONFIRMED、
  // PLUS_ACTIVATED、CANCELLATION_CONFIRMED 和订单转成功都落在同一毫秒
  // （11:15:15.961），交付那一刻客户直接看到成功。第 8 阶段本身能不能被
  // 认出来，由上面那条 payment operations 的用例单独守着。
});

test('the executor checkpoints carry stages 4 and 5', () => {
  const verifying = REAL_RUN_EVENTS.slice(0, 5);
  assert.equal(resolveCustomerStage({ orderStatus: 'RECHARGE_PROCESSING', evidence: verifying }).stage.index, 4);
  assert.equal(resolveCustomerStage({ orderStatus: 'RECHARGE_PROCESSING', evidence: REAL_RUN_EVENTS }).stage.index, 5);
});

test('payment operations carry stages 6 through 8', () => {
  const at = '2026-09-11T11:14:00.000Z';
  const cases = [
    ['PAYMENT_SUBMIT', 6],
    ['PAYMENT_UNKNOWN', 7],
    ['PAYMENT_VERIFICATION', 7],
    ['PAYMENT_VERIFICATION_ESCALATED', 7],
    ['MANUAL_VERIFICATION_RESOLVED', 7],
    ['PAYMENT_CONFIRMED', 8],
    ['MANUAL_PAYMENT_CONFIRMED', 8],
    ['PLUS_ACTIVATED', 8],
    ['CANCELLATION_CONFIRMED', 8]
  ];
  for (const [token, expected] of cases) {
    const { stage } = resolveCustomerStage({
      orderStatus: 'RECHARGE_PROCESSING',
      evidence: [{ kind: 'operation', token, at }]
    });
    assert.equal(stage.index, expected, token);
  }
});

test('an abort or a human takeover is not progress', () => {
  for (const token of ['PRE_PAYMENT_ABORT', 'MANUAL_CONTROL']) {
    const { stage } = resolveCustomerStage({
      orderStatus: 'RECHARGE_PROCESSING',
      evidence: [
        { kind: 'event', token: 'checkout-navigation', at: '2026-09-11T11:13:36.882Z' },
        { kind: 'operation', token, at: '2026-09-11T11:14:00.000Z' }
      ]
    });
    assert.equal(stage.index, 5, token);
  }
});

test('delivery is stage 9 whatever else is on file', () => {
  const { stage } = resolveCustomerStage({
    orderStatus: 'RECHARGE_SUCCESS',
    evidence: [{ kind: 'event', token: 'session-bootstrap', at: '2026-09-11T11:12:46.022Z' }]
  });
  assert.equal(stage.index, 9);
  assert.equal(stage.label, '订阅成功');
});

test('the stage timestamp is when that stage began, not when it was last touched', () => {
  const { since } = resolveCustomerStage({
    orderStatus: 'RECHARGE_PROCESSING',
    evidence: REAL_RUN_EVENTS.slice(0, 5)
  });
  // Five stage-4 checkpoints; the stage started at the first of them.
  assert.equal(since.toISOString(), '2026-09-11T11:12:39.734Z');
});

test('unknown tokens are ignored rather than guessed at', () => {
  const { stage } = resolveCustomerStage({
    orderStatus: 'RECHARGE_PROCESSING',
    evidence: [
      { kind: 'event', token: 'some-future-checkpoint', at: '2026-09-11T11:13:00.000Z' },
      { kind: 'operation', token: 'SOME_FUTURE_OPERATION', at: '2026-09-11T11:13:00.000Z' },
      { kind: 'nonsense', token: 'PAYMENT_CONFIRMED', at: '2026-09-11T11:13:00.000Z' }
    ]
  });
  assert.equal(stage.index, 3);
});

test('the percentage moves at a steady rate inside a stage and never reaches its ceiling', () => {
  const stage = CUSTOMER_STAGES[4];           // 正在获取支付信息, 20 → 62, typical 82.5s
  const floor = CUSTOMER_STAGES[3].ceiling;
  assert.equal(Math.round(stagePercent(stage, 0)), floor);
  const quarter = stagePercent(stage, stage.typicalMs / 4);
  const half = stagePercent(stage, stage.typicalMs / 2);
  const threeQuarters = stagePercent(stage, (stage.typicalMs * 3) / 4);
  const oneHour = stagePercent(stage, 3_600_000);
  const oneDay = stagePercent(stage, 86_400_000);
  // 匀速：等长的时间片推进等长的距离（2026-09-13 D-193）。指数曲线下第一片会走掉近一半。
  const first = quarter - floor;
  const second = half - quarter;
  const third = threeQuarters - half;
  assert.ok(Math.abs(first - second) < 0.01 && Math.abs(second - third) < 0.01,
    `equal time slices must advance equally: ${first} / ${second} / ${third}`);
  assert.ok(half > floor && half < stage.ceiling);
  assert.ok(oneHour >= threeQuarters && oneHour < stage.ceiling);
  // Rounded, not just raw: half a point would render as the next stage's floor.
  assert.ok(Math.round(oneDay) < stage.ceiling, 'a stuck stage must never reach the next stage floor');
});

test('only a real subscription is 100', () => {
  assert.equal(stagePercent(CUSTOMER_STAGES[8], 0), 100);
  for (const stage of CUSTOMER_STAGES.slice(0, 8)) {
    assert.ok(stagePercent(stage, 86_400_000) < 100, stage.code);
  }
});

test('the percentage rises monotonically across a stage and across stages', () => {
  let previous = -1;
  for (const stage of CUSTOMER_STAGES) {
    for (const elapsed of [0, 5_000, 26_000, 120_000]) {
      const value = stagePercent(stage, elapsed);
      assert.ok(value >= previous, `${stage.code}@${elapsed} fell from ${previous} to ${value}`);
      previous = value;
    }
  }
});
