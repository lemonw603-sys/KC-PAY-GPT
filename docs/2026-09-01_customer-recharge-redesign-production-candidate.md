# 客户充值页重设计｜正式部署与验证

日期：2026-09-01
状态：**已部署生产并完成只读验收**；真实成功结果态待下一笔自然发生的成功订单验收

## 范围

- 将 `docs/design/customer-recharge-redesign/` 的单列三步设计移植到正式客户页；
- 删除旧左侧固定展示区；
- 第一步只在浏览器本地解析 Session JSON 并读取 `user.email`；
- 客户在第二步确认邮箱前，不调用 `/api/v1/orders`；
- 确认后才创建订单，随后在页面内持续展示状态、时间线、邮箱与完成时间；
- 成功状态就地展示，不弹出第二个完成弹窗；
- 保留订单查询、Session 更换、防重复提交、30 分钟生产轮询和 `sessionStorage` 查询码恢复；
- 增加 Session 获取教程；教程保留两个 ChatGPT 官方直达入口，成功状态提供“去 ChatGPT 官网确认订阅状态”的轻量外链，均不新增后端调用或远程运行依赖。
- 文案与合同复核已修正两项事实错误：教程示例补齐后端实际必需的 `account/sessionToken` 字段；失败状态不再虚假承诺“已转入/已由人工接手”，改为明确引导联系客服。
- `REVIEWING/ACTION_REQUIRED` 轮询恢复为原生产 30 秒，避免原型移植误改为 100 秒；轮询提示不再承诺不准确的“每隔几秒”。

## 未改变

- 未修改 Provider、卡台、自动补给、Browser、资金、付款、对账或 CDK 管理后台；
- 未修改客户 API 的业务语义或数据库 migration；
- 部署和验收未创建订单、未开卡/补余额、未付款；只对既有订单执行一次状态查询。

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

## 生产部署与复验

- 用户已确认本地视觉候选并批准部署；生产 release：`/opt/pojia/releases/20260901-customer-ui-b4cc5ea`，回滚点：`/opt/pojia/releases/20260831-supply-sync-3f23aa3`。
- 归档 SHA-256：`42967d32adb0be0034a21aa00c4756b6664357f057f202edaef0e1b75e72d6a4`；部署前加密数据库备份：`/var/backups/pojia/pojia-20260901T020107Z.sql.gz.enc`，完整性通过。
- 公网 `plus/ops` live/ready 均 HTTP 200；生产 readiness `ok=true`、`blockers=[]`、Worker heartbeat 1 秒，活动任务/资金风险/UNKNOWN Provider call/开放对账均为 0。
- 生产 HTML 已出现教程、邮箱确认、订阅确认和完整 Session 示例；JS/CSS 与本地候选 SHA-256 一致，浏览器 Console 0 error/0 warning。
- Playwright 已核对 1440px 与 390px 输入页、教程弹层；390px `scrollWidth=innerWidth=390`。教程弹层在移动端采用内部纵向滚动，不横向溢出。
- 用既有订单 `PJV1-HfAEiq8dBpDLXzt4t96e` 只读查询得到 `ACTION_REQUIRED`，页面正确展示三段时间线、更换 Session 入口、剩余次数和截止时间；Network 只有一次 `POST /api/v1/orders/status`，没有建单或资金写入。

## 尚未验证

- 尚未用部署后的下一笔真实成功订单验证成功状态返回的客户邮箱、完成时间与完整时间线；该项随下一笔自然订单验收，不单独创建测试订单。
