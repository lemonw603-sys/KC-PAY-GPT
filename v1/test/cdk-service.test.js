import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateCdks,
  normalizeBatchNo,
  normalizeImportedCdks,
  normalizePlanType,
  validateBatchCount
} from '../src/services/cdk-service.js';
import { GENERATED_CDK_PATTERN } from '../src/security/cdk-code.js';

test('generates unique high-entropy-shaped CDKs without ambiguous characters', () => {
  const codes = generateCdks(250);
  assert.equal(new Set(codes).size, 250);
  for (const code of codes) {
    assert.match(code, /^PJ-[A-HJ-KM-NP-Z2-9]{5}(?:-[A-HJ-KM-NP-Z2-9]{5}){3}$/);
    assert.doesNotMatch(code, /[01ILO]/);
  }
});

test('normalizes line imports and reports duplicates without changing case', () => {
  const first = 'PJ-ABCDEFGHJKMNPQRST234';
  const second = 'PJ-23456789ABCDEFGHJKMN';
  const result = normalizeImportedCdks(`\uFEFF${first}\r\n${second}\n${first}\n\n`);
  assert.deepEqual(result, {
    codes: [first, second],
    inputCount: 3,
    duplicateInputCount: 1
  });
  assert.throws(() => normalizeImportedCdks('bad code'), (error) => error.code === 'INVALID_CDK');
});

test('accepts both grouped new codes and legacy ungrouped codes', () => {
  const grouped = 'PJ-ABCDE-FGHJK-MNPQR-ST234';
  const legacy = 'PJ-ABCDEFGHJKMNPQRST234';
  assert.deepEqual(normalizeImportedCdks(`${grouped}\n${legacy}`), {
    codes: [grouped, legacy], inputCount: 2, duplicateInputCount: 0
  });
});

test('validates count and creates traceable bounded batch identifiers', () => {
  assert.equal(validateBatchCount('100'), 100);
  assert.throws(() => validateBatchCount(0), (error) => error.code === 'INVALID_COUNT');
  assert.throws(() => validateBatchCount(10_001), (error) => error.code === 'INVALID_COUNT');
  assert.equal(normalizeBatchNo('batch_20260817'), 'batch_20260817');
  assert.equal(normalizeBatchNo(null, {
    now: () => new Date('2026-08-17T10:20:30.123Z'),
    randomSuffix: () => 'A1B2C3'
  }), 'B-20260817102030123-A1B2C3');
});

test('accepts Plus and the two Pro tiers, nothing else', () => {
  assert.equal(normalizePlanType(), 'plus');
  assert.equal(normalizePlanType('PLUS'), 'plus');
  assert.equal(normalizePlanType('pro_5x'), 'pro_5x');
  assert.equal(normalizePlanType(' PRO_20X '), 'pro_20x');
  assert.throws(() => normalizePlanType('team'), (error) => error.code === 'INVALID_PLAN_TYPE');
  assert.throws(() => normalizePlanType('20x'), (error) => error.code === 'INVALID_PLAN_TYPE');
});

// ——— D-279 ②：码前缀按产品，旧 PJ- 必须继续收 ———
// 这条改动唯一会咬人的地方是「前缀」和「校验正则」脱节：
// 前缀改了正则没跟上 → 新码发得出、导不进；正则收窄了 → 旧 PJ- 码导入即非法。
// 所以每个产品都断言「前缀对」且「能通过正式正则」，再单独锁住旧码仍合法。
test('D-279②: 三个产品各出各的前缀，且都能通过正式校验正则', () => {
  const cases = [['plus', 'PLUS-'], ['pro_5x', '5X-'], ['pro_20x', '20X-']];
  for (const [planType, prefix] of cases) {
    const [code] = generateCdks(1, { planType });
    assert.ok(code.startsWith(prefix), `${planType} 应出 ${prefix} 前缀，实际 ${code}`);
    assert.ok(GENERATED_CDK_PATTERN.test(code), `${planType} 生成的码必须被正式正则接受：${code}`);
  }
});

test('D-279②: 旧 PJ- 码继续合法（库里已有大量在客户手上，收窄会让它们导入即非法）', () => {
  assert.ok(GENERATED_CDK_PATTERN.test('PJ-3GBKE-ZHDCJ-A3UCK-MRMWR'), '旧分组格式必须仍合法');
  assert.ok(GENERATED_CDK_PATTERN.test('PJ-3GBKEZHDCJA3UCKMRMWR'), '旧不分组格式必须仍合法');
});

test('D-279②: planType 缺省或未知时回退旧前缀，绝不拼出正则不收的码', () => {
  for (const planType of [undefined, null, '', 'unknown_plan']) {
    const [code] = generateCdks(1, { planType });
    assert.ok(GENERATED_CDK_PATTERN.test(code), `planType=${String(planType)} 时仍须合法：${code}`);
  }
});

test('D-279②: 新前缀的码也能被导入校验接受（同一个正则两处用）', () => {
  const [plus] = generateCdks(1, { planType: 'plus' });
  const [pro20] = generateCdks(1, { planType: 'pro_20x' });
  const parsed = normalizeImportedCdks([plus, pro20, 'PJ-3GBKE-ZHDCJ-A3UCK-MRMWR'].join('\n'));
  const codes = Array.isArray(parsed) ? parsed : parsed.codes;
  assert.equal(codes.length, 3, '新旧前缀混在一批里都应被接受');
});
