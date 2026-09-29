import assert from 'node:assert/strict';
import test from 'node:test';
import { topUpFlowRows } from '../src/services/card-top-up-service.js';

// highvcc 账户流水（/api/account/flowPage）实测形态：initiated 是 UTC+8 的「YYYY-MM-DD HH:mm:ss」，
// 补钱行 tradeDesc 含「Add Balance To Card」、cardSeqNo 就是卡 id（2026-09-29 D-412 补记实测三条流水）。
test('topUpFlowRows keeps only this card\'s top-up rows at or after the send time (UTC+8 converted, 1 minute slack)', () => {
  const sinceMs = Date.parse('2026-09-29T08:00:00Z');   // = 16:00:00 UTC+8
  const rows = [
    { cardSeqNo: '17', tradeDesc: 'Add Balance To Card', initiated: '2026-09-29 16:00:05' },
    { cardSeqNo: '17', tradeDesc: 'Add Balance To Card', initiated: '2026-09-29 15:59:30' },   // 1 分钟宽限内
    { cardSeqNo: '17', tradeDesc: 'Add Balance To Card', initiated: '2026-09-29 15:58:00' },   // 更早：不是这一笔
    { cardSeqNo: '18', tradeDesc: 'Add Balance To Card', initiated: '2026-09-29 16:00:05' },   // 别的卡
    { cardSeqNo: '17', tradeDesc: 'Card Transaction Fee', initiated: '2026-09-29 16:00:05' },  // 不是补钱
    { cardSeqNo: '17', tradeDesc: 'Add Balance To Card', initiated: 'garbled' }                // 时间读不出：宁可当「可能是」
  ];
  assert.deepEqual(topUpFlowRows(rows, { cardId: 17, sinceMs }).map((r) => r.initiated),
    ['2026-09-29 16:00:05', '2026-09-29 15:59:30', 'garbled']);
  assert.deepEqual(topUpFlowRows(null, { cardId: 17, sinceMs }), []);
});
