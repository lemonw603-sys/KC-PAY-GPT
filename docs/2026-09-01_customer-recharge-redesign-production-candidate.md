# 客户充值页重设计｜正式代码候选

日期：2026-09-01
状态：代码候选已完成并验证，**尚未部署生产**

## 范围

- 将 `docs/design/customer-recharge-redesign/` 的单列三步设计移植到正式客户页；
- 删除旧左侧固定展示区；
- 第一步只在浏览器本地解析 Session JSON 并读取 `user.email`；
- 客户在第二步确认邮箱前，不调用 `/api/v1/orders`；
- 确认后才创建订单，随后在页面内持续展示状态、时间线、邮箱与完成时间；
- 成功状态就地展示，不弹出第二个完成弹窗；
- 保留订单查询、Session 更换、防重复提交、30 分钟生产轮询和 `sessionStorage` 查询码恢复；
- 增加 Session 获取教程；教程保留两个 ChatGPT 官方直达入口，成功状态提供“去 ChatGPT 官网确认订阅状态”的轻量外链，均不新增后端调用或远程运行依赖。

## 未改变

- 未修改 Provider、卡台、自动补给、Browser、资金、付款、对账或 CDK 管理后台；
- 未修改客户 API 的业务语义或数据库 migration；
- 未连接生产、未创建订单、未开卡/补余额、未付款。

## 真实接口

- `POST /api/v1/orders`
- `POST /api/v1/orders/session`
- `POST /api/v1/orders/status`

成功展示继续消费现有客户合同字段：`customerEmail`、`finishedAt`、`timeline`。

## 验证

- `node --check v1/public/assets/customer.js`：通过；
- v1 全量：466 通过、42 跳过、0 失败；
- Playwright 本地真实静态候选 + mock Network：
  - 邮箱确认前 `/api/v1/orders` 调用 0 次；
  - 客户勾选并确认后创建请求恰好 1 次；
  - Session 在建单成功后清空；
  - 查询接口状态可渲染 SUCCESS 的邮箱、完成时间和时间线；
  - SUCCESS 没有打开 `dialog`；
  - 390px 移动端横向溢出为 0。

预览截图（不纳入 Git）：

`/Users/lemon/code/AI充值业务/output/customer-page-final-candidate/`

## 尚未验证

- 尚未部署后的生产 CSP / 公网页面复验；
- 尚未用真实订单验证生产返回的时间线和成功邮箱；
- 尚未由用户最终确认正式候选视觉后批准部署。
