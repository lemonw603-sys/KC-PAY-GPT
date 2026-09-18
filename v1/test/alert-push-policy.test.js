import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NON_PUSH_REASONS, PHONE_PUSH_TYPES,
  PushCategory, phonePushTypes, pushCategoryOf, shouldPushToPhone
} from '../src/domain/alert-push-policy.js';
import { createAlertNotificationRepository } from '../src/db/repositories/alert-notification-repository.js';

// 验收（任务书第⑤步）：四类各一推、其余不推、ORDER_CANCELLATION_UNCONFIRMED 推。
test('whitelist pushes one representative of each of the four categories', () => {
  const representatives = {
    [PushCategory.HUMAN]: 'BROWSER_HUMAN_VERIFICATION',
    [PushCategory.SUPPLY]: 'CARD_STOCK_LOW',
    [PushCategory.MONEY]: 'CARD_CHARGEBACK',
    [PushCategory.CUSTOMER]: 'BROWSER_ORDER_SUBMITTED'
  };
  for (const [category, type] of Object.entries(representatives)) {
    assert.equal(shouldPushToPhone(type), true, `${type} should push`);
    assert.equal(pushCategoryOf(type), category);
  }
});

test('缝 g: ORDER_CANCELLATION_UNCONFIRMED counts as 资金类 and pushes', () => {
  assert.equal(shouldPushToPhone('ORDER_CANCELLATION_UNCONFIRMED'), true);
  assert.equal(pushCategoryOf('ORDER_CANCELLATION_UNCONFIRMED'), PushCategory.MONEY);
});

test('everything outside the whitelist stays off the phone', () => {
  for (const type of Object.keys(NON_PUSH_REASONS)) {
    assert.equal(shouldPushToPhone(type), false, `${type} must not push`);
    assert.equal(pushCategoryOf(type), null);
  }
  // 白名单外的未知类型同样不推——这正是白名单相对排除法的意义：新类型默认静默。
  assert.equal(shouldPushToPhone('SOME_BRAND_NEW_ALERT_TYPE'), false);
});

test('the two D-176 silent types are still silent under the whitelist', () => {
  assert.equal(shouldPushToPhone('BROWSER_PAYMENT_UNKNOWN'), false);
  assert.equal(shouldPushToPhone('BROWSER_PAYMENT_CONFIRMED'), false);
});

test('every whitelisted type has a category and no type is in both tables', () => {
  for (const [type, category] of Object.entries(PHONE_PUSH_TYPES)) {
    assert.ok(Object.values(PushCategory).includes(category), `${type} has an unknown category`);
    assert.equal(NON_PUSH_REASONS[type], undefined, `${type} is in both tables`);
  }
});

test('phonePushTypes 返回全部白名单类型（D-275 ④：不再有 DAILY_DIGEST 摘除分支）', () => {
  assert.equal(phonePushTypes().length, Object.keys(PHONE_PUSH_TYPES).length);
  assert.equal(phonePushTypes().includes('PROVIDER_BALANCE_CHANGED'), true, '余额变化恢复为每笔必推');
});

function recordingPool(settingValue = null) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (/FROM app_settings/.test(sql)) return [settingValue == null ? [] : [{ setting_value: settingValue }], []];
      if (/^SELECT/i.test(String(sql).trim())) return [[], []];
      return [{ affectedRows: 0 }, []];
    },
    async getConnection() {
      const connection = {
        query: this.query.bind(this),
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {}
      };
      return connection;
    }
  };
}

test('enqueue filters by whitelist on both the insert and the CANCELLED revive path', async () => {
  const pool = recordingPool();
  await createAlertNotificationRepository(pool).enqueueOpenAlerts();
  const inserts = pool.calls.filter((call) => /INSERT IGNORE INTO alert_notifications/.test(call.sql));
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].sql, /alert_type IN \(\?\)/);
  assert.equal(inserts[0].params[0].includes('BROWSER_HUMAN_REQUIRED'), true);
  assert.equal(inserts[0].params[0].includes('BROWSER_PAYMENT_UNKNOWN'), false);

  // 复活路径以前没有类型过滤：白名单外的类型只要历史上推过一次就能靠它一直复活。
  const revive = pool.calls.find((call) => /n\.status = 'CANCELLED'/.test(call.sql));
  assert.match(revive.sql, /a\.alert_type IN \(\?\)/);
  assert.equal(revive.params[0].includes('BROWSER_PAYMENT_CONFIRMED'), false);
});

test('claimNext refuses rows whose type left the whitelist', async () => {
  const pool = recordingPool();
  await createAlertNotificationRepository(pool).claimNext();
  const claim = pool.calls.find((call) => /FOR UPDATE SKIP LOCKED/.test(call.sql));
  assert.match(claim.sql, /a\.alert_type IN \(\?\)/);
  assert.equal(claim.params[0].includes('BROWSER_ORDER_SUBMITTED'), true);
});

test('enqueue 不再读 provider_balance_change_push_mode 设置，直接用白名单（D-275 ④）', async () => {
  const pool = recordingPool();
  await createAlertNotificationRepository(pool).enqueueOpenAlerts();
  const settingReads = pool.calls.filter((call) => /provider_balance_change_push_mode/.test(call.sql));
  assert.equal(settingReads.length, 0);
  const insert = pool.calls.find((call) => /INSERT IGNORE INTO alert_notifications/.test(call.sql));
  assert.equal(insert.params[0].includes('PROVIDER_BALANCE_CHANGED'), true, '余额变化在白名单里、照推');
});

test('countAlertInstancesByType（F-55 改名）：统计告警实例、按 sent_at，不承诺发送次数', async () => {
  const pool = recordingPool();
  await createAlertNotificationRepository(pool)
    .countAlertInstancesByType({ sinceUtc: '2026-09-18 00:00:00', untilUtc: '2026-09-19 00:00:00' });
  const query = pool.calls.find((call) => /GROUP BY a\.alert_type/.test(call.sql));
  assert.match(query.sql, /n\.sent_at IS NOT NULL/);
  assert.match(query.sql, /n\.sent_at >= \? AND n\.sent_at < \?/);
});
