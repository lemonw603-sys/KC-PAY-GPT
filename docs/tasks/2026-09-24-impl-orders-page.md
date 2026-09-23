# 任务书：订单页 v3 实现（D-357，块 5）

## 目标
把冻结原型 `design/prototypes/step6-orders-v3.html`（契约 `design/parity/orders-page.json`）做成正式后台订单页，替换生产上的 D-350 版。完成标准＝旧实现已删除、入口文件已更新、契约几何一致、隔离库集成与真实浏览器验收通过。

## 范围（白名单）
- 后端：`v1/src/services/admin-read-service.js`（listOrders 加 groupByCdk / planType / executorKind / 桶筛选与桶计数、路线与历史数投影、行内动作资格）；新 `v1/src/services/manual-fulfillment-service.js`（从 `scripts/close-manually-fulfilled-order.mjs` 移植守卫与写入，脚本改为薄调用）；`v1/src/app/create-app.js` 加 `GET /orders/:publicNo/attempts`、`POST /orders/:publicNo/manual-fulfilled`；`v1/src/services/admin-read-service.js` 加 `listOrderAttempts`。
- 前端：新 `v1/public/admin/assets/orders.css`、`orders.js`；`index.html` 订单视图改为 od-page 骨架 + 确认框；`admin.js` 删除旧订单列表实现（orderRow / renderOrderSummary / loadOrders / 摘要点击）、订单抽屉按原型分区重排（此刻可做 → 进度 → 客户与卡密 → 卡与钱三问 → 技术证据折叠）、`openOrder(publicNo, { focus })`、工作台/CDK 页跳转改接新控制器。
- 不动：付款链路、状态机、资金栅栏、既有动作端点的守卫语义；全局令牌（对比度问题另议）。

## 验收
1. 单测：groupByCdk SQL 契约（最新一单谓词、桶筛选、产品/路线过滤、summary 口径）；manual-fulfillment 守卫（有付款痕迹拒、RECHARGE_FAILED 重绑码、CDK 被占拒）；attempts 投影。
2. 隔离库集成：3 单 2 码 → 分组结果与历史；manual-fulfilled 真库走一遍。
3. 真实浏览器（本地后台 8803 + 隔离库造数）：原型验收脚本的 30 项改成对实现跑；四态（有数据 / 空 / 接口 500 / 401）。
4. `visual-parity.mjs` 对 `orders-page.json` 一致；`ui-copy-check`、CSS 棘轮、wrapup 全绿。
5. 生产：prepare → 复核 → Lemon 确认 → switch → 只读复验（列表查询对 80 单实跑）。
