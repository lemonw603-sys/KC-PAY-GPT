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
- 重新启动本地 8803 隔离后台并用临时本地密码登录后，真实浏览器打开订单页：摘要显示 24 条总记录、9 条处理中、3 条需要处理、0 条付款待核实；点击“处理中”后标题变为“自动处理中的订单”、列表变为 9 条，摘要选中态同步。
- 真实浏览器打开卡片页看到卡台摘要与卡片列表显示 highvcc。

## 尚未验证

- 本地 8803 已使用一次性隔离测试密码完成登录验收；密码不写入仓库。订单样本没有已分配卡，因此没有现场点击付款卡行；跳转代码由单测和既有 `openCard` 接线覆盖。
- 未部署生产，未连接生产数据库，未触发卡片同步、付款或任何写操作。
- 卡片页高级区的 highvcc ranges 请求在隔离库返回 HTTP 409（无真实 token），属于已有隔离环境边界；未重试、未写 token、未连接外部卡台。
- Demo 中“在 CDK 页定位”仍是提示文本，不把它计为正式双向跳转完成；正式订单→卡片详情已接入，CDK双向定位仍待单独任务。

## 现场

已提交并推送：`141c0dd`（功能接线）与`97c6420`（CSS token收敛）。`git diff --check`、全量测试和CSS漂移检查均通过；生产发布仍需另行确认。
