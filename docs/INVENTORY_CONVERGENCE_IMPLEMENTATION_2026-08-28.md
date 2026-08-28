# 库存后台收敛实施记录（2026-08-28）

## 本次改动

- 后台库存主视图收敛为四类：“可分配、使用中、暂不可用、永久停用”。
- 库存卡列表现在显示面向运营的原因，例如“余额不足，充值后可重新判定”、“等待只读同步”，不再把这些状态统称为坏卡。
- 卡片详情仍保留原始库存状态、运营覆盖、卡台余额、交易和订单关联，未删除追溯数据。
- 主视图的低价值技术数据（补卡任务、新卡接管队列、各类底层同步计数）收入可展开的详细区域，避免平时干扰运营判断。
- 资金控制、卡台只读同步、手动开卡和运营覆盖逻辑未改变。

## 实现位置

- 后台四类分类和原因：`v1/src/services/card-stock-service.js`。
- 后台主视图：`v1/public/admin/index.html` + `v1/public/admin/assets/admin.js` + `admin.css`。
- 卡详情运营覆盖字段：`v1/src/services/admin-read-service.js`。
- 测试：`v1/test/card-stock-service.test.js` 和 `v1/test/public-isolation.test.js`。

## 验收

- 定向测试：21/21 通过。
- 全量 v1：456 total / 419 pass / 0 fail / 37 skipped。
- Browser：89 total / 85 pass / 0 fail / 4 skipped。
- `git diff --check`通过，Node 语法检查通过。

## 强制边界

- 本次是后台信息收敛，不是删除数据或改变卡片分配规则。
- 生产写开关、自动补卡、Provider 写入和 Browser 付款继续关闭。
- 本次前端改动尚在主线，需通过下一步正式发布闸门后才是生产生效。
