# 订单页最小正式接线本地验收

## 范围

依据 D-350。本轮只读接线：订单列表付款卡跳现有 V1 卡片详情、统一 highvcc 显示、摘要卡片唯一状态筛选、搜索/时间范围摘要、轻量桌面/手机样式；不改付款、CDK、卡分配、资金账本和订单状态机。

## 已验证

- `node --check v1/src/services/admin-read-service.js` 通过。
- `node --check v1/public/admin/assets/admin.js` 通过。
- `npm --prefix v1 test`：1084 tests，1014 pass，0 fail，70 skipped。
- 新增 `v1/test/order-summary-contract.test.js` 通过：
  - 未请求摘要时保持旧调用形状，不额外聚合；
  - 付款未知列表与摘要使用同一付款未知谓词，不混入普通 reconciliation case；
  - 摘要保留搜索/时间条件，不把当前状态筛选带入摘要分母；
- `admin-read-service` 订单行补齐 providerAccountId/providerCardId/providerLabel，前端使用既有 `openCard()` 弹窗；卡片详情 V1 未改。
- 用户可见备用卡台文案统一为 highvcc；内部 `manual_excel` 仅保留数据层映射。

## 尚未验证

- 本机 8803 后台可访问但停在登录页；本轮没有猜测或输入凭据，因此未完成真实后台登录后的截图/点击验收。
- 未部署生产，未连接生产数据库，未触发卡片同步、付款或任何写操作。
- Demo 中“在 CDK 页定位”仍是提示文本，不把它计为正式双向跳转完成；正式订单→卡片详情已接入，CDK双向定位仍待单独任务。

## 现场

工作区变更尚未提交。提交前需再跑 `git diff --check` 和全量测试；生产发布需另行确认。
