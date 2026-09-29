import assert from 'node:assert/strict';
import test from 'node:test';
import { hasManualUseMarker, MANUAL_USE_REASON_REGEXP, reasonKeepingManualUse } from '../src/domain/manual-use-marker.js';
import { MANUAL_USE_REASON_REGEXP as RECONCILIATION_REGEXP } from '../src/services/daily-reconciliation-service.js';

// 欠账 36（D-412 补记三）：改写停用原因时，「手动用过」的标记不能丢。

test('日对账与改写原因的两处用的是同一个判据（不是抄一份）', () => {
  assert.equal(RECONCILIATION_REGEXP, MANUAL_USE_REASON_REGEXP);
});

test('hasManualUseMarker: 页面原因码、旧脚本写法、英文句子都认；其他停用原因不认', () => {
  for (const reason of ['MANUAL_USED: 09-21 手动补差价', 'retired confirmed (retire-legacy-cards:highvcc-manual-used): x',
    'manual used by operator', 'card was manually used', 'OTHER: x｜manual-used']) {
    assert.equal(hasManualUseMarker(reason), true, reason);
  }
  for (const reason of ['OTHER: 其他', 'PROVIDER_VOIDED: 卡台作废', 'retired confirmed (admin): deleted', '', null, undefined]) {
    assert.equal(hasManualUseMarker(reason), false, String(reason));
  }
});

test('reasonKeepingManualUse: 原来带标记、新原因没带 → 末尾补标记，开头的原因码不动', () => {
  assert.equal(reasonKeepingManualUse('MANUAL_USED: 自用期', 'retired confirmed (admin): 已在卡台删'),
    'retired confirmed (admin): 已在卡台删｜manual-used');
  const other = reasonKeepingManualUse('MANUAL_USED: 自用期', 'OTHER: 重新停用');
  assert.equal(other.split(':')[0], 'OTHER', '后台按第一个冒号前解析原因码，不能被标记挤掉');
  assert.equal(hasManualUseMarker(other), true);
});

test('reasonKeepingManualUse: 原来没标记不凭空加；新原因已带标记不重复加', () => {
  assert.equal(reasonKeepingManualUse('OTHER: x', 'retired confirmed (admin): y'), 'retired confirmed (admin): y');
  assert.equal(reasonKeepingManualUse(null, 'OTHER: y'), 'OTHER: y');
  assert.equal(reasonKeepingManualUse('MANUAL_USED: a', 'MANUAL_USED: b'), 'MANUAL_USED: b');
});

test('reasonKeepingManualUse: 超长时截正文，标记本身留住，总长不超过列宽 500', () => {
  const long = reasonKeepingManualUse('MANUAL_USED: a', 'x'.repeat(800));
  assert.equal(long.length, 500);
  assert.equal(hasManualUseMarker(long), true);
  assert.equal(reasonKeepingManualUse('OTHER: a', 'y'.repeat(800)).length, 500);
});
